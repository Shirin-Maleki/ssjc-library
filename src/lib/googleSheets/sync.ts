import { notInArray } from "drizzle-orm";
import { createHash } from "node:crypto";
import type { Database } from "@/db/client";
import { bookSheetSync } from "@/db/schema";
// Deliberately imported from their own files, never from `@/db/repositories`'s
// index — that index also imports `../client` (the real, `server-only`-guarded
// connection), which throws unconditionally outside Next's own build
// pipeline. `sync.ts` is called from `scripts/sheets/sync.ts` via `tsx`, the
// exact same reason `duplicateMatcher.ts`/`scripts/embeddings/generate.ts`
// import these two classes the same way.
import { DrizzleBookRepository } from "@/db/repositories/bookRepository";
import { DrizzleCategoryRepository } from "@/db/repositories/categoryRepository";
import { getCopyLocationSummaryForBooks } from "@/lib/locations/persistence";
import type { Book } from "@/lib/catalog/types";
import { CATALOG_HEADER_ROW, VISIBLE_COLUMN_COUNT, buildCatalogRow, formatLocationSummary, type CatalogRow } from "./rowBuilder";
import { getSheetsTarget, setSheetsTarget, type SheetsTarget } from "./targetState";
import type { SheetsProvider } from "./provider";

/**
 * The deterministic DB → Sheet snapshot sync (§16 of the phase brief) — for a
 * catalog of roughly 1,500 rows, a full-snapshot rewrite on every run is
 * simpler and more reliable than a fragile incremental keyed-row engine
 * (explicitly endorsed by the phase brief itself), and this project's own
 * earlier Phase 0 design note ("synchronous incremental write after every
 * relevant DB write") is superseded by this choice — see
 * `docs/DECISIONS.md`'s Phase 9 entry for the full reasoning. Triggered
 * explicitly (`npm run sheets:sync`), never automatically wired into every
 * admin/intake mutation — a queue/hook system this traffic volume doesn't
 * justify.
 */

export const SPREADSHEET_TITLE = "SSJC Library Catalog";
const CATALOG_RANGE_NAME = "Catalog";
/** Comfortably larger than any realistic real catalog size (the full
 * collection is ~1,500 books) — clearing up to this row on every sync is what
 * guarantees a shrinking catalog never leaves stale trailing rows behind,
 * without needing to track the previous sync's exact row count. */
const CLEAR_UPPER_BOUND_ROW = 3000;

export interface SyncResult {
  spreadsheetId: string;
  spreadsheetUrl: string;
  rowsWritten: number;
  target: SheetsTarget;
}

/**
 * Finds the persisted target spreadsheet and verifies it's still reachable,
 * or creates a fresh one and persists its identity — never both create AND
 * reuse in the same call, and never asks an operator to supply an id by
 * hand. A spreadsheet manually deleted out-of-band is detected here (a 404 on
 * `getSpreadsheetMeta`) and transparently replaced, logged via the returned
 * target's fresh `createdAt`.
 */
export async function findOrCreateSpreadsheet(db: Database, provider: SheetsProvider): Promise<SheetsTarget> {
  const existing = await getSheetsTarget(db);
  if (existing) {
    const meta = await provider.getSpreadsheetMeta(existing.spreadsheetId);
    if (meta) {
      // Reused as-is; `sheetId`/`url` refreshed in case either legitimately
      // changed (e.g. the Catalog tab was recreated) without losing the
      // original `createdAt`.
      const refreshed: SheetsTarget = { ...existing, sheetId: meta.sheetId, url: meta.url };
      if (refreshed.sheetId !== existing.sheetId || refreshed.url !== existing.url) {
        await setSheetsTarget(db, refreshed);
      }
      return refreshed;
    }
    // Fall through — the recorded spreadsheet is gone; create a replacement.
  }

  const created = await provider.createSpreadsheet(SPREADSHEET_TITLE);
  const target: SheetsTarget = { spreadsheetId: created.spreadsheetId, sheetId: created.sheetId, url: created.url, createdAt: new Date().toISOString() };
  await setSheetsTarget(db, target);
  return target;
}

function computeContentHash(row: CatalogRow): string {
  return createHash("sha256").update(JSON.stringify(row)).digest("hex");
}

function columnLetter(index: number): string {
  let n = index + 1;
  let result = "";
  while (n > 0) {
    const remainder = (n - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    n = Math.floor((n - 1) / 26);
  }
  return result;
}

/** Idempotent formatting requests applied on every sync (§15) — safe to send
 * repeatedly against an already-formatted sheet; Sheets simply re-applies the
 * same state. Frozen header row, a basic filter over the real data range,
 * bold header text, wrapped description column, a sane default column-width
 * pass, and hiding the trailing `book_id` column. */
function buildFormattingRequests(sheetId: number, rowCount: number): Record<string, unknown>[] {
  const lastColumnIndex = CATALOG_HEADER_ROW.length - 1; // 0-based, includes hidden book_id column
  const descriptionColumnIndex = CATALOG_HEADER_ROW.indexOf("Short Description");

  return [
    { updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 1 } }, fields: "gridProperties.frozenRowCount" } },
    {
      setBasicFilter: {
        filter: { range: { sheetId, startRowIndex: 0, endRowIndex: Math.max(1, rowCount + 1), startColumnIndex: 0, endColumnIndex: VISIBLE_COLUMN_COUNT } },
      },
    },
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: lastColumnIndex + 1 },
        cell: { userEnteredFormat: { textFormat: { bold: true } } },
        fields: "userEnteredFormat.textFormat.bold",
      },
    },
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 1, startColumnIndex: descriptionColumnIndex, endColumnIndex: descriptionColumnIndex + 1 },
        cell: { userEnteredFormat: { wrapStrategy: "WRAP" } },
        fields: "userEnteredFormat.wrapStrategy",
      },
    },
    {
      updateDimensionProperties: {
        range: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: 1 },
        properties: { pixelSize: 72 },
        fields: "pixelSize",
      },
    },
    {
      updateDimensionProperties: {
        range: { sheetId, dimension: "COLUMNS", startIndex: descriptionColumnIndex, endIndex: descriptionColumnIndex + 1 },
        properties: { pixelSize: 320 },
        fields: "pixelSize",
      },
    },
    {
      updateDimensionProperties: {
        range: { sheetId, dimension: "COLUMNS", startIndex: lastColumnIndex, endIndex: lastColumnIndex + 1 },
        properties: { hiddenByUser: true },
        fields: "hiddenByUser",
      },
    },
  ];
}

export async function syncCatalogToSheet(db: Database, provider: SheetsProvider): Promise<SyncResult> {
  const target = await findOrCreateSpreadsheet(db, provider);

  const bookRepository = new DrizzleBookRepository(db);
  const categoryRepository = new DrizzleCategoryRepository(db);
  const [visibleBooks, categories] = await Promise.all([bookRepository.listVisibleBooks(), categoryRepository.listCategories()]);
  const categoryLabelBySlug = new Map(categories.map((c) => [c.slug, c.label]));
  // Phase 9 addendum — one batch query for every visible book's current
  // copy-location breakdown, never one query per book (§5's "Location"
  // column).
  const locationSummaryByBookId = await getCopyLocationSummaryForBooks(db, visibleBooks.map((b) => b.id));

  // Deterministic row order — sortTitle is the same stable ordering Find
  // itself uses for browse results, so the Sheet's default order reads the
  // same way the app's own catalog listing does.
  const sortedBooks = [...visibleBooks].sort((a, b) => a.sortTitle.localeCompare(b.sortTitle));
  const rows = sortedBooks.map((book) =>
    buildCatalogRow(book, categoryLabelBySlug.get(book.physicalCategory) ?? book.physicalCategory, formatLocationSummary(locationSummaryByBookId.get(book.id) ?? []))
  );

  const lastColumn = columnLetter(CATALOG_HEADER_ROW.length - 1);
  const dataRange = `'${CATALOG_RANGE_NAME}'!A1:${lastColumn}${rows.length + 1}`;
  await provider.updateValues(target.spreadsheetId, dataRange, [[...CATALOG_HEADER_ROW], ...rows.map((row) => [...row])]);

  // Wipe any stale trailing rows from a previous, larger sync.
  const clearRange = `'${CATALOG_RANGE_NAME}'!A${rows.length + 2}:${lastColumn}${CLEAR_UPPER_BOUND_ROW}`;
  await provider.clearValues(target.spreadsheetId, clearRange);

  await provider.batchUpdate(target.spreadsheetId, buildFormattingRequests(target.sheetId, rows.length));

  await recordSyncState(db, sortedBooks, rows);

  const updatedTarget: SheetsTarget = { ...target, lastSyncedAt: new Date().toISOString() };
  await setSheetsTarget(db, updatedTarget);

  return { spreadsheetId: target.spreadsheetId, spreadsheetUrl: target.url, rowsWritten: rows.length, target: updatedTarget };
}

async function recordSyncState(db: Database, books: Book[], rows: CatalogRow[]): Promise<void> {
  const now = new Date();
  const currentIds = books.map((b) => b.id);

  for (const [index, book] of books.entries()) {
    const contentHash = computeContentHash(rows[index]);
    await db
      .insert(bookSheetSync)
      .values({ bookId: book.id, sheetRowNumber: index + 2, lastSyncedAt: now, lastSyncedContentHash: contentHash, syncStatus: "synced", lastError: null })
      .onConflictDoUpdate({
        target: bookSheetSync.bookId,
        set: { sheetRowNumber: index + 2, lastSyncedAt: now, lastSyncedContentHash: contentHash, syncStatus: "synced", lastError: null, updatedAt: now },
      });
  }

  // Remove sync bookkeeping for any book that no longer belongs in the
  // export (archived, no longer active, or deleted) — never leaves a stale
  // row pointing at a book the Sheet itself no longer lists.
  if (currentIds.length > 0) {
    await db.delete(bookSheetSync).where(notInArray(bookSheetSync.bookId, currentIds));
  } else {
    await db.delete(bookSheetSync);
  }
}
