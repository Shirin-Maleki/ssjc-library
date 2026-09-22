import "./loadEnv";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as schema from "./schema";
import { rebuildSearchText } from "../lib/search/searchTextMaintenance";
import { backfillPendingBookLinks } from "./backfillPendingBookLinks";

/**
 * Standalone migration runner (`npm run db:migrate`) — deliberately not the app's own
 * `src/db/client.ts` (that one is `server-only` and expects to run inside Next.js).
 * Always runs against `DATABASE_MIGRATION_URL` (a direct/session connection — a
 * transaction-mode pooler such as Supabase's port-6543 URL cannot run DDL). See
 * docs/DATABASE_SETUP.md.
 *
 * Phase 5 correction pass: migration `0001` added `books.search_text` as a nullable
 * column — correct for a from-zero migrate-then-seed database (nothing to backfill),
 * but silently wrong for an already-populated Phase 4 database, whose existing rows
 * would otherwise keep a NULL `search_text` (and therefore an empty generated
 * `search_vector`) until something happened to reseed them, disabling full-text
 * discovery for every pre-existing book with no visible error. Backfilling is
 * folded into this same `db:migrate` command — not a separate manual step someone
 * could forget — specifically *after* the schema migrations run and specifically
 * scoped to rows the schema change actually left behind (`mode: "missing"`):
 * running this against a from-zero database finds nothing to do (a fast no-op);
 * running it against a populated Phase 4 database backfills every existing book
 * using the exact same deterministic composition `buildSearchIndexText` uses
 * everywhere else, never a second reimplementation of that logic. Requires no
 * embedding API key and never touches `embedding*` columns — see
 * `src/lib/search/searchTextMaintenance.ts` and docs/SEARCH.md §3.
 */
async function main() {
  const connectionString = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_MIGRATION_URL (or DATABASE_URL) must be set. See docs/DATABASE_SETUP.md.");
  }

  const migrationClient = postgres(connectionString, { max: 1 });
  const migrationDb = drizzle(migrationClient);

  console.log("Running migrations...");
  await migrate(migrationDb, { migrationsFolder: "./drizzle" });
  console.log("Migrations complete.");

  const db = drizzle(migrationClient, { schema });
  const backfillResult = await rebuildSearchText(db, { mode: "missing" });
  if (backfillResult.considered > 0) {
    console.log(
      `Backfilled search_text for ${backfillResult.updated} existing book(s) left behind by a schema change ` +
        `(${backfillResult.considered} considered, ${backfillResult.unchanged} already correct).`
    );
  }

  const pendingBookLinkResult = await backfillPendingBookLinks(db);
  if (pendingBookLinkResult.considered > 0) {
    console.log(
      `Backfilled ingestion_items.pending_book_id for ${pendingBookLinkResult.linked} pre-existing Review Later item(s) ` +
        `(${pendingBookLinkResult.considered} considered, ${pendingBookLinkResult.skippedAmbiguous} left null as ambiguous).`
    );
  }

  await migrationClient.end();
}

main().catch((error) => {
  console.error("Migration failed:", error);
  process.exit(1);
});
