import { afterAll, afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { books, bookSheetSync, physicalCategories, systemSettings } from "@/db/schema";
import { findOrCreateSpreadsheet, syncCatalogToSheet } from "@/lib/googleSheets/sync";
import { getSheetsTarget } from "@/lib/googleSheets/targetState";
import type { CreateSpreadsheetResult, SheetsBatchUpdateRequest, SheetsProvider, SpreadsheetMeta } from "@/lib/googleSheets/provider";
import { requireTestDatabaseUrl, createTestDb } from "./testDb";

const hasTestDb = (() => {
  try {
    requireTestDatabaseUrl();
    return true;
  } catch {
    return false;
  }
})();

/** A fully in-memory fake `SheetsProvider` — records every call for assertion
 * without any real network/API call. Mirrors the "inject a fake provider"
 * pattern `smokeOrchestration.test.ts` and `bulkImport.test.ts` already use. */
function fakeSheetsProvider() {
  const spreadsheets = new Map<string, { title: string; sheetId: number; values: Map<string, (string | number)[][]>; batchUpdateCalls: SheetsBatchUpdateRequest[][] }>();
  let nextId = 1;
  let failNextUpdate = false;

  const provider: SheetsProvider & { spreadsheets: typeof spreadsheets; setFailNextUpdate: (v: boolean) => void } = {
    spreadsheets,
    setFailNextUpdate(v: boolean) {
      failNextUpdate = v;
    },
    async createSpreadsheet(title: string): Promise<CreateSpreadsheetResult> {
      const id = `fake-sheet-${nextId++}`;
      spreadsheets.set(id, { title, sheetId: 1, values: new Map(), batchUpdateCalls: [] });
      return { spreadsheetId: id, sheetId: 1, url: `https://docs.google.com/spreadsheets/d/${id}` };
    },
    async getSpreadsheetMeta(spreadsheetId: string): Promise<SpreadsheetMeta | undefined> {
      const sheet = spreadsheets.get(spreadsheetId);
      if (!sheet) return undefined;
      return { spreadsheetId, title: sheet.title, sheetId: sheet.sheetId, url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}` };
    },
    async updateValues(spreadsheetId: string, range: string, values: (string | number)[][]): Promise<void> {
      if (failNextUpdate) {
        failNextUpdate = false;
        throw new Error("simulated Sheets API failure");
      }
      const sheet = spreadsheets.get(spreadsheetId);
      if (!sheet) throw new Error("no such spreadsheet");
      sheet.values.set(range, values);
    },
    async clearValues(spreadsheetId: string, range: string): Promise<void> {
      const sheet = spreadsheets.get(spreadsheetId);
      if (!sheet) throw new Error("no such spreadsheet");
      sheet.values.set(range, []);
    },
    async batchUpdate(spreadsheetId: string, requests: SheetsBatchUpdateRequest[]): Promise<void> {
      const sheet = spreadsheets.get(spreadsheetId);
      if (!sheet) throw new Error("no such spreadsheet");
      sheet.batchUpdateCalls.push(requests);
    },
  };
  return provider;
}

describe.skipIf(!hasTestDb)("Phase 9 Google Sheets sync (against a real Postgres database)", () => {
  const { db, client } = hasTestDb ? createTestDb() : ({} as ReturnType<typeof createTestDb>);
  const createdBookIds: string[] = [];

  afterEach(async () => {
    for (const id of createdBookIds.splice(0)) {
      await db.delete(bookSheetSync).where(eq(bookSheetSync.bookId, id));
      await db.delete(books).where(eq(books.id, id));
    }
    await db.delete(systemSettings).where(eq(systemSettings.key, "google_sheets_catalog_target"));
  });

  afterAll(async () => {
    if (hasTestDb) await client.end();
  });

  async function makeActiveBook(overrides: Partial<typeof books.$inferInsert> = {}) {
    const [category] = await db.select().from(physicalCategories).where(eq(physicalCategories.slug, "stories-imagination")).limit(1);
    const [book] = await db
      .insert(books)
      .values({
        title: "Sheets Sync Test Book",
        normalizedTitle: "sheets sync test book",
        sortTitle: "Sheets Sync Test Book",
        languageCode: "en",
        physicalCategoryId: category.id,
        reviewStatus: "active",
        shortDescription: "A test description.",
        ...overrides,
      })
      .returning({ id: books.id });
    createdBookIds.push(book.id);
    return book.id;
  }

  // ---------------------------------------------------------------------
  // Target spreadsheet creation / reuse
  // ---------------------------------------------------------------------

  it("creates the spreadsheet exactly once and persists its identity in system_settings", async () => {
    const provider = fakeSheetsProvider();
    const target = await findOrCreateSpreadsheet(db, provider);
    expect(target.spreadsheetId).toBeDefined();
    expect(provider.spreadsheets.size).toBe(1);

    const persisted = await getSheetsTarget(db);
    expect(persisted?.spreadsheetId).toBe(target.spreadsheetId);
  });

  it("reuses the persisted spreadsheet on a second call — never creates a duplicate", async () => {
    const provider = fakeSheetsProvider();
    const first = await findOrCreateSpreadsheet(db, provider);
    const second = await findOrCreateSpreadsheet(db, provider);
    expect(second.spreadsheetId).toBe(first.spreadsheetId);
    expect(provider.spreadsheets.size).toBe(1); // never a second spreadsheet
  });

  it("creates a replacement spreadsheet when the recorded one is gone (a real 404), never crashing", async () => {
    const provider = fakeSheetsProvider();
    const first = await findOrCreateSpreadsheet(db, provider);
    provider.spreadsheets.delete(first.spreadsheetId); // simulate manual deletion out-of-band

    const second = await findOrCreateSpreadsheet(db, provider);
    expect(second.spreadsheetId).not.toBe(first.spreadsheetId);
    expect(provider.spreadsheets.size).toBe(1);
  });

  // ---------------------------------------------------------------------
  // Sync content / visibility / idempotency
  // ---------------------------------------------------------------------

  it("syncs only visible (active) books — excludes archived and pending_review records", async () => {
    await makeActiveBook({ title: "Visible Active Book", normalizedTitle: "visible active book", sortTitle: "Visible Active Book" });
    const archivedId = await makeActiveBook({ title: "Hidden Archived Book", normalizedTitle: "hidden archived book", sortTitle: "Hidden Archived Book", reviewStatus: "archived" });
    const pendingId = await makeActiveBook({ title: "Hidden Pending Book", normalizedTitle: "hidden pending book", sortTitle: "Hidden Pending Book", reviewStatus: "pending_review" });

    const provider = fakeSheetsProvider();
    const result = await syncCatalogToSheet(db, provider);

    const sheet = provider.spreadsheets.get(result.spreadsheetId)!;
    const dataRange = [...sheet.values.keys()].find((r) => r.includes("A1"))!;
    const values = sheet.values.get(dataRange)!;
    const titlesInSheet = values.slice(1).map((row) => row[1]);

    expect(titlesInSheet).toContain("'Visible Active Book");
    expect(titlesInSheet).not.toContain("'Hidden Archived Book");
    expect(titlesInSheet).not.toContain("'Hidden Pending Book");
    void archivedId;
    void pendingId;
  });

  it("is idempotent — rerunning sync with no data changes reuses the same spreadsheet and produces the same row count", async () => {
    await makeActiveBook();
    const provider = fakeSheetsProvider();

    const first = await syncCatalogToSheet(db, provider);
    const second = await syncCatalogToSheet(db, provider);

    expect(second.spreadsheetId).toBe(first.spreadsheetId);
    expect(second.rowsWritten).toBe(first.rowsWritten);
    expect(provider.spreadsheets.size).toBe(1);
  });

  it("reflects a metadata/category change on the next sync", async () => {
    const bookId = await makeActiveBook({ title: "Metadata Change Book", normalizedTitle: "metadata change book", sortTitle: "Metadata Change Book" });
    const provider = fakeSheetsProvider();
    await syncCatalogToSheet(db, provider);

    const [otherCategory] = await db.select().from(physicalCategories).where(eq(physicalCategories.slug, "animals-nature")).limit(1);
    await db.update(books).set({ title: "Renamed Metadata Book", physicalCategoryId: otherCategory.id }).where(eq(books.id, bookId));

    const result = await syncCatalogToSheet(db, provider);
    const sheet = provider.spreadsheets.get(result.spreadsheetId)!;
    const dataRange = [...sheet.values.keys()].find((r) => r.includes("A1"))!;
    const values = sheet.values.get(dataRange)!;
    const row = values.find((r) => r[1] === "'Renamed Metadata Book");
    expect(row).toBeDefined();
    expect(row![13]).toBe("'Animals & Nature");
  });

  it("clears stale trailing rows when the visible catalog shrinks", async () => {
    const bookId = await makeActiveBook({ title: "Soon To Archive Book", normalizedTitle: "soon to archive book", sortTitle: "Soon To Archive Book" });
    const provider = fakeSheetsProvider();
    const first = await syncCatalogToSheet(db, provider);
    expect(first.rowsWritten).toBeGreaterThanOrEqual(1);

    await db.update(books).set({ reviewStatus: "archived" }).where(eq(books.id, bookId));
    const second = await syncCatalogToSheet(db, provider);
    expect(second.rowsWritten).toBe(first.rowsWritten - 1);

    const sheet = provider.spreadsheets.get(second.spreadsheetId)!;
    const clearRange = [...sheet.values.keys()].find((r) => !r.includes("A1"));
    expect(clearRange).toBeDefined();
  });

  it("upserts book_sheet_sync rows for synced books and removes them for books no longer visible", async () => {
    const bookId = await makeActiveBook();
    const provider = fakeSheetsProvider();
    await syncCatalogToSheet(db, provider);

    const [syncRow] = await db.select().from(bookSheetSync).where(eq(bookSheetSync.bookId, bookId)).limit(1);
    expect(syncRow?.syncStatus).toBe("synced");
    expect(syncRow?.lastSyncedContentHash).toBeTruthy();

    await db.update(books).set({ reviewStatus: "archived" }).where(eq(books.id, bookId));
    await syncCatalogToSheet(db, provider);

    const rowsAfter = await db.select().from(bookSheetSync).where(eq(bookSheetSync.bookId, bookId));
    expect(rowsAfter).toHaveLength(0); // never left as a stale row for a now-hidden book
  });

  // ---------------------------------------------------------------------
  // Cover / formula safety, and failure behavior
  // ---------------------------------------------------------------------

  it("uses a real IMAGE() formula only for a trusted display cover URL, never for an untrusted or missing one", async () => {
    const trustedId = await makeActiveBook({ title: "Trusted Cover Book", normalizedTitle: "trusted cover book", sortTitle: "Trusted Cover Book", displayCoverUrl: "https://covers.openlibrary.org/b/id/1-M.jpg" });
    const noCoverId = await makeActiveBook({ title: "No Cover Book", normalizedTitle: "no cover book", sortTitle: "No Cover Book" });

    const provider = fakeSheetsProvider();
    const result = await syncCatalogToSheet(db, provider);
    const sheet = provider.spreadsheets.get(result.spreadsheetId)!;
    const dataRange = [...sheet.values.keys()].find((r) => r.includes("A1"))!;
    const values = sheet.values.get(dataRange)!;

    const trustedRow = values.find((r) => r[1] === "'Trusted Cover Book");
    const noCoverRow = values.find((r) => r[1] === "'No Cover Book");
    expect(String(trustedRow![0])).toBe('=IMAGE("https://covers.openlibrary.org/b/id/1-M.jpg")');
    expect(noCoverRow![0]).toBe("");
    void trustedId;
    void noCoverId;
  });

  it("never exposes a raw Drive source URL anywhere in the synced row data", async () => {
    await makeActiveBook({ title: "Drive Source Book", normalizedTitle: "drive source book", sortTitle: "Drive Source Book", coverDriveFileId: "some-real-drive-file-id" });
    const provider = fakeSheetsProvider();
    const result = await syncCatalogToSheet(db, provider);
    const sheet = provider.spreadsheets.get(result.spreadsheetId)!;
    const dataRange = [...sheet.values.keys()].find((r) => r.includes("A1"))!;
    const serialized = JSON.stringify(sheet.values.get(dataRange));
    expect(serialized).not.toContain("some-real-drive-file-id");
    expect(serialized).not.toContain("drive.google.com");
  });

  it("a Sheets API failure never mutates canonical book data and never corrupts sync-state bookkeeping", async () => {
    const bookId = await makeActiveBook();
    const provider = fakeSheetsProvider();
    provider.setFailNextUpdate(true);

    await expect(syncCatalogToSheet(db, provider)).rejects.toThrow();

    const [bookRow] = await db.select().from(books).where(eq(books.id, bookId)).limit(1);
    expect(bookRow.reviewStatus).toBe("active"); // canonical data completely untouched

    const syncRows = await db.select().from(bookSheetSync).where(eq(bookSheetSync.bookId, bookId));
    expect(syncRows).toHaveLength(0); // never marked "synced" for a sync that didn't actually happen
  });

  it("a failed sync can be safely retried and succeeds on the next attempt", async () => {
    const bookId = await makeActiveBook();
    const provider = fakeSheetsProvider();
    provider.setFailNextUpdate(true);
    await expect(syncCatalogToSheet(db, provider)).rejects.toThrow();

    const result = await syncCatalogToSheet(db, provider);
    expect(result.rowsWritten).toBeGreaterThanOrEqual(1);
    const [syncRow] = await db.select().from(bookSheetSync).where(eq(bookSheetSync.bookId, bookId)).limit(1);
    expect(syncRow?.syncStatus).toBe("synced");
  });
});
