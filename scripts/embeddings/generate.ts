import "../../src/db/loadEnv";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import * as schema from "../../src/db/schema";
import { books } from "../../src/db/schema";
import { DrizzleBookRepository } from "../../src/db/repositories/bookRepository";
import { DrizzleCategoryRepository } from "../../src/db/repositories/categoryRepository";
import { buildEmbeddingDocument } from "../../src/lib/embeddings/document";
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
 * call per book, and must happen on a schedule/trigger a human controls.
 *
 * Modes (`--mode=`, default `missing`):
 *   missing  — only books with no stored embedding at all (the common case).
 *   stale    — only books whose stored embedding's composition version or source
 *              hash no longer matches what `buildEmbeddingDocument` would produce
 *              today (the book's data changed, or the composition itself changed).
 *   all      — every book, regardless of current state (a full, deliberate re-embed).
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
const BATCH_SIZE = 50;

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
    const bookRepository = new DrizzleBookRepository(db);
    const categoryRepository = new DrizzleCategoryRepository(db);

    const [allBooks, categories, embeddingRows] = await Promise.all([
      bookRepository.listBooks(),
      categoryRepository.listCategories(),
      db
        .select({
          id: books.id,
          hasEmbedding: books.embedding,
          embeddingCompositionVersion: books.embeddingCompositionVersion,
          embeddingSourceHash: books.embeddingSourceHash,
        })
        .from(books),
    ]);

    const categoryLabelBySlug = new Map(categories.map((c) => [c.slug, c.label]));
    const embeddingStateById = new Map(embeddingRows.map((r) => [r.id, r]));

    const candidates = allBooks
      .map((book) => {
        const document = buildEmbeddingDocument({
          title: book.title,
          subtitle: book.subtitle,
          description: book.description,
          authors: book.authors,
          illustrators: book.illustrators,
          publisher: book.publisher,
          imprint: book.imprint,
          categoryLabel: categoryLabelBySlug.get(book.physicalCategory),
          tags: book.tags,
          languageCode: book.languageCode,
          additionalLanguageCodes: book.additionalLanguageCodes,
          fictionType: book.fictionType,
          format: book.format,
          illustrationStyles: book.illustrationStyles,
          visualRealism: book.visualRealism,
          ageMinMonths: book.ageMinMonths,
          ageMaxMonths: book.ageMaxMonths,
          readAloudMinutes: book.readAloudMinutes,
        });
        return { book, document };
      })
      .filter(({ book, document }) => {
        const state = embeddingStateById.get(book.id);
        if (!state) return false;
        if (MODE === "all") return true;
        if (MODE === "missing") return state.hasEmbedding == null;
        // stale: has an embedding, but it no longer matches what we'd generate today.
        if (state.hasEmbedding == null) return false;
        return (
          state.embeddingCompositionVersion !== document.version || state.embeddingSourceHash !== document.sourceHash
        );
      });

    console.log(
      `Mode: ${MODE}. ${allBooks.length} total books, ${candidates.length} need embedding generation.`
    );
    if (DRY_RUN) {
      for (const { book } of candidates) console.log(`  would generate: ${book.title} (${book.id})`);
      return;
    }
    if (candidates.length === 0) return;

    let succeeded = 0;
    const failed: { id: string; title: string; error: string }[] = [];

    for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
      const batch = candidates.slice(i, i + BATCH_SIZE);
      try {
        const vectors = await provider.embedDocuments(batch.map((c) => c.document.text));
        await Promise.all(
          batch.map(async ({ book, document }, index) => {
            const vector = vectors[index];
            await db
              .update(books)
              .set({
                embedding: vector,
                embeddingModel: provider.modelId,
                embeddingDimension: provider.dimensions,
                embeddingCompositionVersion: document.version,
                embeddingSourceHash: document.sourceHash,
                embeddingGeneratedAt: new Date(),
              })
              .where(eq(books.id, book.id));
            succeeded += 1;
          })
        );
      } catch (error) {
        // One batch failing must never abort the whole run — every other batch still
        // gets its chance, and every failure is named in the final summary rather
        // than silently swallowed.
        for (const { book } of batch) {
          failed.push({ id: book.id, title: book.title, error: error instanceof Error ? error.message : String(error) });
        }
      }
    }

    console.log(`Done. Succeeded: ${succeeded}. Failed: ${failed.length}.`);
    if (failed.length > 0) {
      console.log("Failed books:");
      for (const f of failed) console.log(`  ${f.title} (${f.id}): ${f.error}`);
    }

    // Sanity check — every id we intended to update should be one of the ones we
    // actually touched or explicitly reported as failed, never silently dropped.
    const accountedFor = succeeded + failed.length;
    if (accountedFor !== candidates.length) {
      console.warn(`Warning: ${candidates.length} candidates but only ${accountedFor} accounted for in the summary.`);
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
