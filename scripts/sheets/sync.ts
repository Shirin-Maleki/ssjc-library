import "../../src/db/loadEnv";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "../../src/db/schema";
import { GoogleSheetsApiProvider } from "../../src/lib/googleSheets/googleSheetsProvider";
import { syncCatalogToSheet } from "../../src/lib/googleSheets/sync";
import { isDriveConfigured } from "../../src/lib/googleDrive/config";

/**
 * `npm run sheets:sync` — the one, explicitly-triggered command that
 * projects canonical PostgreSQL data into the persistent Google Sheet (§16 of
 * the phase brief). Never run automatically after every admin/intake
 * mutation — see `docs/DECISIONS.md`'s Phase 9 entry for why a deliberate
 * command is preferred over a synchronous per-write hook at this project's
 * real scale.
 *
 * Reuses the SAME OAuth credential Drive already uses (`isDriveConfigured()`
 * checks the identical four env vars) — Sheets has no separate credential to
 * configure.
 */
async function main() {
  if (!isDriveConfigured()) {
    console.log("Google OAuth is not configured (see docs/GOOGLE_SETUP.md) — the Sheets sync shares the same credential as Drive. Nothing to do.");
    return;
  }

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");
  const client = postgres(url, { max: 1 });
  const db = drizzle(client, { schema });

  try {
    const provider = new GoogleSheetsApiProvider();
    const result = await syncCatalogToSheet(db, provider);
    console.log(`Synced ${result.rowsWritten} book(s) to the Catalog tab.`);
    console.log(`Spreadsheet: ${result.spreadsheetUrl}`);
    console.log(`Spreadsheet id: ${result.spreadsheetId}`);
    console.log(`Last synced: ${result.target.lastSyncedAt}`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
