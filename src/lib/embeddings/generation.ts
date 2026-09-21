import { eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import { books } from "@/db/schema/books";
import { DrizzleBookRepository } from "@/db/repositories/bookRepository";
import { DrizzleCategoryRepository } from "@/db/repositories/categoryRepository";
import { TEACHER_VISIBLE_REVIEW_STATUS } from "@/lib/catalog/visibility";
import { buildEmbeddingDocument } from "./document";
import type { EmbeddingProvider } from "./provider";

const BATCH_SIZE = 50;

export interface GenerateEmbeddingsResult {
  considered: number;
  succeeded: number;
  failed: { id: string; title: string; error: string }[];
  /** Present only when `dryRun: true` was passed — the books that would have been
   * embedded, without ever calling the provider or writing anything. */
  candidates?: { id: string; title: string }[];
}

/**
 * The one place embeddings actually get generated and written — reused by both
 * `scripts/embeddings/generate.ts` (the CLI command a human runs) and
 * `tests/evaluation/searchEvaluation.eval.ts` (which needs real embeddings present
 * in its own database before it can report genuine hybrid-mode results, and can't
 * rely on running the CLI script separately since its own `globalSetup`
 * truncate-reseeds the database on every run — see that file's own comment).
 *
 * Scoped to `review_status = 'active'` books only: semantic retrieval is never used
 * for a `pending_review`/`archived` book, so embedding one would be pure waste of a
 * real, metered API call. Never run automatically outside an explicit call site —
 * this makes a real network call per batch and must always be a deliberate,
 * human-triggered (or evaluation-triggered) action, never implicit in a request
 * path or migration.
 */
export async function generateEmbeddings(
  db: Database,
  provider: EmbeddingProvider,
  options: { mode: "missing" | "stale" | "all"; dryRun?: boolean }
): Promise<GenerateEmbeddingsResult> {
  const bookRepository = new DrizzleBookRepository(db);
  const categoryRepository = new DrizzleCategoryRepository(db);

  const activeIdRows = await db.select({ id: books.id }).from(books).where(eq(books.reviewStatus, TEACHER_VISIBLE_REVIEW_STATUS));
  const activeIds = activeIdRows.map((r) => r.id);

  const [allBooks, categories, embeddingRows] = await Promise.all([
    bookRepository.getBooksByIds(activeIds),
    categoryRepository.listCategories(),
    activeIds.length > 0
      ? db
          .select({
            id: books.id,
            hasEmbedding: books.embedding,
            embeddingCompositionVersion: books.embeddingCompositionVersion,
            embeddingSourceHash: books.embeddingSourceHash,
          })
          .from(books)
          .where(eq(books.reviewStatus, TEACHER_VISIBLE_REVIEW_STATUS))
      : Promise.resolve([]),
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
      if (options.mode === "all") return true;
      if (options.mode === "missing") return state.hasEmbedding == null;
      if (state.hasEmbedding == null) return false;
      return state.embeddingCompositionVersion !== document.version || state.embeddingSourceHash !== document.sourceHash;
    });

  if (options.dryRun) {
    return {
      considered: candidates.length,
      succeeded: 0,
      failed: [],
      candidates: candidates.map(({ book }) => ({ id: book.id, title: book.title })),
    };
  }

  let succeeded = 0;
  const failed: GenerateEmbeddingsResult["failed"] = [];

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
      for (const { book } of batch) {
        failed.push({ id: book.id, title: book.title, error: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  return { considered: candidates.length, succeeded, failed };
}

export interface GenerateEmbeddingForBookResult {
  succeeded: boolean;
  error?: string;
}

/**
 * The targeted, single-book primitive Phase 7's intake save flow needs
 * (`src/lib/intake/persistence.ts`, `docs/AI_PIPELINE.md`) — deliberately NOT a call
 * into `generateEmbeddings()` above, which is designed as a broader catalog
 * backfill/evaluation helper (fetches every active book's id, every category, every
 * embedding-state row, just to decide what to do with the one book a teacher just
 * saved). Reuses the exact same building blocks that function does — embedding
 * document composition, the `EmbeddingProvider` interface, the model/dimension
 * contract, the same stale/hash metadata columns — so a book embedded through this
 * path is completely indistinguishable, to any later backfill run, from one embedded
 * through the batch path.
 *
 * Never throws on a provider failure — returns `{ succeeded: false, error }`
 * instead, so a caller (the post-save step in `persistence.ts`) can log/record the
 * outcome without it ever affecting whether the book save itself succeeded (§36 of
 * the phase brief: "BOOK CREATION STILL SUCCEEDS" regardless of embedding outcome).
 * Only scoped to `active` books, matching `generateEmbeddings()`'s own visibility
 * rule — calling this for a `pending_review` book is a caller error, not something
 * this function silently permits or silently no-ops; callers must check
 * `review_status` themselves before calling.
 */
export async function generateEmbeddingForBook(db: Database, provider: EmbeddingProvider, bookId: string): Promise<GenerateEmbeddingForBookResult> {
  const bookRepository = new DrizzleBookRepository(db);
  const categoryRepository = new DrizzleCategoryRepository(db);

  const [[book], categories] = await Promise.all([bookRepository.getBooksByIds([bookId]), categoryRepository.listCategories()]);
  if (!book) {
    return { succeeded: false, error: `Book ${bookId} not found.` };
  }

  const categoryLabelBySlug = new Map(categories.map((c) => [c.slug, c.label]));
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

  try {
    const [vector] = await provider.embedDocuments([document.text]);
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
      .where(eq(books.id, bookId));
    return { succeeded: true };
  } catch (error) {
    return { succeeded: false, error: error instanceof Error ? error.message : String(error) };
  }
}
