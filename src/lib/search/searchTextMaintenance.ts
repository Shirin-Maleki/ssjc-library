import { eq, isNull } from "drizzle-orm";
import type { Database } from "@/db/client";
import { books } from "@/db/schema/books";
import { DrizzleBookRepository } from "@/db/repositories/bookRepository";
import { DrizzleCategoryRepository } from "@/db/repositories/categoryRepository";
import { buildSearchIndexText } from "@/lib/embeddings/document";
import type { Book } from "@/lib/catalog/types";

/**
 * The one place `books.search_text` gets (re)computed for a real, already-inserted
 * book — reused by both the migration-upgrade backfill (`src/db/migrate.ts`) and the
 * standalone rebuild command (`scripts/search/rebuildSearchText.ts`), so there is
 * exactly one implementation of "how does a book's relational data become its
 * search text," not a second one duplicating `buildSearchIndexText`'s composition
 * rules in raw SQL. Reuses `DrizzleBookRepository`'s existing relational projection
 * (contributors ordered by role/sort_order, tags, primary+additional languages,
 * category label) — the same data `seed.ts` sources when it computes `search_text`
 * at insert time — rather than writing a second set of joins.
 *
 * Deterministic and idempotent by construction: `buildSearchIndexText` is a pure
 * function of a book's current data, so computing it twice for the same data always
 * produces the same string, and running this against a book whose `search_text`
 * already matches is a harmless no-op write.
 *
 * Distinct from embedding generation (`scripts/embeddings/generate.ts`): this never
 * calls an embedding provider, never touches the `embedding*` columns, and requires
 * no `GEMINI_API_KEY`. Rebuilding `search_text` for a book whose data changed *does*
 * make its stored embedding stale in the sense the embedding generation script's
 * `--mode=stale` already detects (a changed `buildEmbeddingDocument().sourceHash` no
 * longer matching `embedding_source_hash`) — the two commands compose, but are never
 * conflated. See docs/SEARCH.md §3/§5.
 */

export interface SearchTextBackfillResult {
  considered: number;
  updated: number;
  unchanged: number;
}

async function computeSearchTextForBook(db: Database, book: Book, categoryLabelBySlug: Map<string, string>): Promise<string> {
  return buildSearchIndexText({
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
}

/**
 * Rebuilds `search_text` for a specific, deliberately bounded set of books.
 * `mode: "missing"` (the migration-upgrade case — only rows a schema change left
 * NULL) or `mode: "all"` (the maintenance case — every book, e.g. after a
 * composition change to `buildSearchIndexText` itself, or a bulk metadata import
 * whose write path didn't go through the normal book-update path). Never touches
 * `review_status`-based visibility — this recomputes a column, not a filter.
 */
export async function rebuildSearchText(
  db: Database,
  options: { mode: "missing" | "all"; bookIds?: string[] } = { mode: "missing" }
): Promise<SearchTextBackfillResult> {
  const bookRepository = new DrizzleBookRepository(db);
  const categoryRepository = new DrizzleCategoryRepository(db);

  const [allBooks, categories, missingRows] = await Promise.all([
    options.bookIds ? bookRepository.getBooksByIds(options.bookIds) : bookRepository.listBooks(),
    categoryRepository.listCategories(),
    options.mode === "missing"
      ? db.select({ id: books.id }).from(books).where(isNull(books.searchText))
      : Promise.resolve(undefined),
  ]);

  const categoryLabelBySlug = new Map(categories.map((c) => [c.slug, c.label]));
  const missingIds = missingRows ? new Set(missingRows.map((r) => r.id)) : null;
  const candidates = missingIds ? allBooks.filter((b) => missingIds.has(b.id)) : allBooks;

  let updated = 0;
  let unchanged = 0;

  for (const book of candidates) {
    const searchText = await computeSearchTextForBook(db, book, categoryLabelBySlug);
    const [current] = await db.select({ searchText: books.searchText }).from(books).where(eq(books.id, book.id));
    if (current?.searchText === searchText) {
      unchanged += 1;
      continue;
    }
    await db.update(books).set({ searchText }).where(eq(books.id, book.id));
    updated += 1;
  }

  return { considered: candidates.length, updated, unchanged };
}

/** Convenience wrapper for rebuilding a known, small set of books (e.g. right after
 * an admin edits one book's metadata) — thin enough that callers don't need to
 * import `inArray` themselves just to express "these specific ids." */
export async function rebuildSearchTextForBooks(db: Database, bookIds: string[]): Promise<SearchTextBackfillResult> {
  if (bookIds.length === 0) return { considered: 0, updated: 0, unchanged: 0 };
  return rebuildSearchText(db, { mode: "all", bookIds });
}
