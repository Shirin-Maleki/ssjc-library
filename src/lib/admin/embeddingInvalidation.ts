import { eq, inArray } from "drizzle-orm";
import { books } from "@/db/schema";
import type { Transaction } from "@/lib/intake/persistence";

/**
 * Phase 8 correction pass — Phase 5 semantic retrieval (`docs/SEARCH.md` §5)
 * considers any book with a non-null `embedding`; it does not compare the
 * current embedding-document hash against `embedding_source_hash` before
 * trusting the stored vector (that comparison only exists in the batch
 * `generateEmbeddings({mode:"stale"})` backfill path, not in the live Find
 * query). Before this fix, an admin metadata/category change rebuilt
 * `search_text` immediately but left the OLD embedding vector fully active —
 * if the fire-and-forget refresh then failed or was never configured (no
 * `GEMINI_API_KEY`), that stale vector could keep influencing semantic Find
 * results for a book whose actual content had already changed.
 *
 * The fix: clear every embedding-related column to null in the SAME
 * transaction as the searchable-content change, so a stale vector can never
 * survive even a fraction of a second past the change that invalidated it.
 * Conventional (full-text/trigram) search is completely unaffected — it reads
 * `search_text`/`search_vector`, never these columns. A book with a cleared
 * embedding simply has no semantic signal until the next successful targeted
 * refresh or backfill run — exactly the graceful degradation Phase 5 already
 * treats as a normal state (a book that was never embedded looks identical).
 */
export async function invalidateEmbedding(tx: Transaction, bookId: string): Promise<void> {
  await tx
    .update(books)
    .set({
      embedding: null,
      embeddingModel: null,
      embeddingDimension: null,
      embeddingCompositionVersion: null,
      embeddingSourceHash: null,
      embeddingGeneratedAt: null,
    })
    .where(eq(books.id, bookId));
}

/** Batch form for a category rename, which can affect many books' composed
 * embedding document (the category label) in one admin action. */
export async function invalidateEmbeddings(tx: Transaction, bookIds: string[]): Promise<void> {
  if (bookIds.length === 0) return;
  await tx
    .update(books)
    .set({
      embedding: null,
      embeddingModel: null,
      embeddingDimension: null,
      embeddingCompositionVersion: null,
      embeddingSourceHash: null,
      embeddingGeneratedAt: null,
    })
    .where(inArray(books.id, bookIds));
}
