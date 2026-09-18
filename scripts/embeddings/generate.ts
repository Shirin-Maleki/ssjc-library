import "../../src/db/loadEnv";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "../../src/db/schema";
import { generateEmbeddings } from "../../src/lib/embeddings/generation";
import { GeminiEmbeddingProvider } from "../../src/lib/embeddings/geminiProvider";
import type { EmbeddingProvider } from "../../src/lib/embeddings/provider";

/**
 * Deliberately not `getConfiguredEmbeddingProvider()` from `lib/embeddings/index.ts`
 * — that module is `import "server-only"`, which unconditionally throws outside
 * Next.js' own build pipeline (there is no bundler here remapping it to a no-op, the
 * way Next's server compilation does). This script needs the exact same "no key →
 * undefined, never throw" behavior, just without importing a Next-specific guard —
 * duplicated here rather than changing the production guard for a script's sake.
 */
function getConfiguredEmbeddingProvider(): EmbeddingProvider | undefined {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return undefined;
  try {
    return new GeminiEmbeddingProvider(apiKey);
  } catch {
    return undefined;
  }
}

/**
 * Controlled, idempotent embedding generation/backfill — `npm run embeddings:generate`
 * (docs/SEARCH.md §5). This is a standalone script, never run automatically during a
 * request or a migration: generating embeddings makes a real, rate-limited network
 * call per book, and must happen on a schedule/trigger a human controls. The actual
 * generation logic lives in `lib/embeddings/generation.ts`, shared with the
 * evaluation harness (`tests/evaluation/searchEvaluation.eval.ts`) so there's one
 * implementation, not two.
 *
 * Modes (`--mode=`, default `missing`):
 *   missing  — only books with no stored embedding at all (the common case).
 *   stale    — only books whose stored embedding's composition version or source
 *              hash no longer matches what `buildEmbeddingDocument` would produce
 *              today (the book's data changed, or the composition itself changed).
 *   all      — every book, regardless of current state (a full, deliberate re-embed).
 *
 * Scoped to `review_status = 'active'` books only (validation pass correction,
 * 2026-09-17) — semantic retrieval is never used for a `pending_review`/`archived`
 * book (`docs/SEARCH.md` §1, visibility scoping), so spending a real, metered API
 * call to embed one would be pure waste, not "stored but not retrievable" by
 * design. If a book is later approved to `active`, it becomes a `missing` candidate
 * on the next run.
 *
 * `--dry-run` reports what would be generated without calling the provider or
 * writing anything.
 *
 * If no embedding provider is configured (`GEMINI_API_KEY` unset), this exits
 * cleanly with an explanatory message and a zero exit code — "no provider" is a
 * normal, expected state (docs/SEARCH.md §5), not a failure.
 */

const MODE = (() => {
  const arg = process.argv.find((a) => a.startsWith("--mode="));
  const value = arg?.split("=")[1] ?? "missing";
  if (value !== "missing" && value !== "stale" && value !== "all") {
    throw new Error(`Unknown --mode "${value}" — expected missing, stale, or all.`);
  }
  return value as "missing" | "stale" | "all";
})();
const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  const provider = getConfiguredEmbeddingProvider();
  if (!provider) {
    console.log(
      "No embedding provider configured (GEMINI_API_KEY is unset) — nothing to do. " +
        "Conventional search does not require this; see docs/SEARCH.md §5."
    );
    return;
  }

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");
  const client = postgres(url, { max: 1 });
  const db = drizzle(client, { schema });

  try {
    const result = await generateEmbeddings(db, provider, { mode: MODE, dryRun: DRY_RUN });

    if (DRY_RUN) {
      console.log(`Mode: ${MODE}. ${result.considered} book(s) would be generated.`);
      for (const book of result.candidates ?? []) console.log(`  would generate: ${book.title} (${book.id})`);
      return;
    }

    console.log(`Mode: ${MODE}. ${result.considered} book(s) needed embedding generation.`);
    console.log(`Done. Succeeded: ${result.succeeded}. Failed: ${result.failed.length}.`);
    if (result.failed.length > 0) {
      console.log("Failed books:");
      for (const f of result.failed) console.log(`  ${f.title} (${f.id}): ${f.error}`);
    }
    const accountedFor = result.succeeded + result.failed.length;
    if (accountedFor !== result.considered) {
      console.warn(`Warning: ${result.considered} candidates but only ${accountedFor} accounted for in the summary.`);
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
