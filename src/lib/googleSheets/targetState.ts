import { eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import { systemSettings } from "@/db/schema";

/**
 * Persists the ONE target spreadsheet's durable identity (§8 of the phase
 * brief: "Do not require the user to copy/paste the Sheet ID before every
 * sync. Do not create duplicate Sheets on reruns.") — the existing, real,
 * general-purpose `system_settings` key/value table
 * (`src/db/schema/system.ts`, present since Phase 4, never previously written
 * to by any application code) rather than a new table. `book_sheet_sync`
 * (this project's real name for what the phase brief calls
 * `google_sheet_sync_state`) is per-BOOK sync bookkeeping, a different
 * concern from "which spreadsheet is the one target" — this module and that
 * table are used together, not as alternatives to each other.
 */

const SETTINGS_KEY = "google_sheets_catalog_target";

export interface SheetsTarget {
  spreadsheetId: string;
  sheetId: number;
  url: string;
  createdAt: string;
  /** Set after every successful `syncCatalogToSheet()` run — absent on a
   * freshly-created target that has never completed a sync yet. */
  lastSyncedAt?: string;
}

export async function getSheetsTarget(db: Database): Promise<SheetsTarget | undefined> {
  const [row] = await db.select({ value: systemSettings.value }).from(systemSettings).where(eq(systemSettings.key, SETTINGS_KEY)).limit(1);
  if (!row) return undefined;
  return row.value as SheetsTarget;
}

export async function setSheetsTarget(db: Database, target: SheetsTarget): Promise<void> {
  await db
    .insert(systemSettings)
    .values({ key: SETTINGS_KEY, value: target, description: "Phase 9 — the one persistent Google Sheet the catalog syncs to. Never a secret; safe to read/log.", updatedAt: new Date() })
    .onConflictDoUpdate({ target: systemSettings.key, set: { value: target, updatedAt: new Date() } });
}
