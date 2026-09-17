import "../../src/db/loadEnv";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "../../src/db/schema";
import { rebuildSearchText } from "../../src/lib/search/searchTextMaintenance";

/**
 * The controlled command for rebuilding `books.search_text` after future metadata
 * edits or imports — `npm run search:rebuild-text` (docs/SEARCH.md §3). Distinct
 * from `npm run embeddings:generate`: this never calls an embedding provider, needs
 * no `GEMINI_API_KEY`, and only ever touches `search_text` (conventional full-text
 * search), never `embedding*`. The migration-upgrade backfill for an existing
 * Phase 4 database happens automatically as part of `npm run db:migrate` — this
 * command is for the ongoing maintenance case: a book's metadata changed (title,
 * contributors, tags, category, description, …) through a path that didn't already
 * recompute `search_text`, and its conventional-search text is now stale.
 *
 * Modes (`--mode=`, default `missing`):
 *   missing  — only books with a NULL `search_text` (matches migrate.ts's own scope).
 *   all      — every book, unconditionally — the right choice after editing
 *              `buildSearchIndexText`'s composition itself, or after a bulk import
 *              whose write path bypassed the normal book-update flow.
 *
 * Idempotent either way: a book whose stored `search_text` already matches what
 * `buildSearchIndexText` would produce today is left unchanged (reported as
 * "unchanged", not "updated").
 *
 * Rebuilding `search_text` for a book whose data changed also makes any existing
 * stored embedding detectably stale — `buildEmbeddingDocument()`'s `sourceHash` is
 * computed from the same underlying book fields, so `npm run embeddings:generate
 * --mode=stale` will independently notice the mismatch and re-embed it. This
 * command never touches embeddings itself; the two compose, they are never
 * conflated.
 */

const MODE = (() => {
  const arg = process.argv.find((a) => a.startsWith("--mode="));
  const value = arg?.split("=")[1] ?? "missing";
  if (value !== "missing" && value !== "all") {
    throw new Error(`Unknown --mode "${value}" — expected missing or all.`);
  }
  return value as "missing" | "all";
})();

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");
  const client = postgres(url, { max: 1 });
  const db = drizzle(client, { schema });

  try {
    console.log(`Rebuilding search_text (mode: ${MODE})...`);
    const result = await rebuildSearchText(db, { mode: MODE });
    console.log(
      `Considered: ${result.considered}. Updated: ${result.updated}. Already correct: ${result.unchanged}.`
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
