import { and, eq, ne, or, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import { books } from "@/db/schema/books";
import { DrizzleBookRepository } from "@/db/repositories/bookRepository";
import { normalizeSearchText, normalizeTitle } from "@/lib/search/normalize";
import type { LanguageCode } from "@/lib/catalog/languages";
import type { Book } from "@/lib/catalog/types";

/**
 * Dedicated existing-catalog duplicate detection (Phase 7, §17 of the phase brief) —
 * deliberately NOT a reuse of Find's teacher-facing search/ranking semantics
 * (`src/lib/search/`), which is built to surface *relevant* results, not to decide
 * bibliographic identity. Runs BEFORE a new `books` row is ever created
 * (`src/lib/intake/persistence.ts`). Never automatically merges — every non-`no_match`
 * outcome is a candidate for a human (teacher/admin) to confirm or reject.
 *
 * Candidate ids are found with two small, targeted, bounded queries (exact ISBN;
 * trigram title similarity using the `%` operator — the exact same
 * index-accelerated pattern `SearchRepository` already established, see its own
 * comment, reused here rather than reinvented), then projected into full `Book`
 * objects via the existing `DrizzleBookRepository` — never a hand-written duplicate
 * JOIN query.
 */

export type DuplicateDetectionOutcome =
  | "no_match"
  | "exact_copy_same_edition"
  | "same_title_different_edition"
  | "same_work_different_language"
  | "ambiguous_similar_title";

/** A trigram similarity below this floor is not a meaningful title match at all —
 * same principle/precedent as `src/db/repositories/searchRepository.ts`'s own
 * `TRGM_SIMILARITY_FLOOR`, but a dedicated constant here since duplicate-identity
 * matching and teacher-facing fuzzy search are different concerns with no reason to
 * share a threshold just because the underlying SQL function is the same one. */
const DUPLICATE_TITLE_SIMILARITY_FLOOR = 0.4;
/** At or above this similarity, two titles are treated as "the same title" for
 * duplicate-identity purposes (not merely "similar enough to suggest a typo," which
 * is all Find's fuzzy search needs) — deliberately stricter than the floor above. */
const SAME_TITLE_SIMILARITY_THRESHOLD = 0.7;
const MAX_CANDIDATES = 5;

export interface DuplicateIdentityInput {
  title: string;
  authors?: string[];
  languageCode?: LanguageCode;
  isbn10?: string;
  isbn13?: string;
}

export interface DuplicateCandidate {
  book: Book;
  outcome: Exclude<DuplicateDetectionOutcome, "no_match">;
  detectedBy: "isbn_match" | "title_author_match";
  titleSimilarity: number;
}

export interface DuplicateMatchResult {
  outcome: DuplicateDetectionOutcome;
  candidates: DuplicateCandidate[];
}

function classify(input: DuplicateIdentityInput, candidateBook: Book, titleSimilarity: number): Exclude<DuplicateDetectionOutcome, "no_match"> {
  const sameTitle = titleSimilarity >= SAME_TITLE_SIMILARITY_THRESHOLD || normalizeTitle(candidateBook.title) === normalizeTitle(input.title);
  const authorOverlap = hasAuthorOverlap(input.authors, candidateBook.authors);
  const sameLanguage = !input.languageCode || candidateBook.languageCode === input.languageCode;

  if (sameTitle && authorOverlap && sameLanguage) return "exact_copy_same_edition";
  if (sameTitle && authorOverlap && !sameLanguage) return "same_work_different_language";
  if (sameTitle) return "same_title_different_edition";
  return "ambiguous_similar_title";
}

function hasAuthorOverlap(inputAuthors: string[] | undefined, candidateAuthors: string[]): boolean {
  if (!inputAuthors || inputAuthors.length === 0 || candidateAuthors.length === 0) return false;
  const normalizedCandidateAuthors = new Set(candidateAuthors.map((a) => normalizeSearchText(a)));
  return inputAuthors.some((a) => normalizedCandidateAuthors.has(normalizeSearchText(a)));
}

const outcomePriority: Record<Exclude<DuplicateDetectionOutcome, "no_match">, number> = {
  exact_copy_same_edition: 4,
  same_work_different_language: 3,
  same_title_different_edition: 2,
  ambiguous_similar_title: 1,
};

export async function findDuplicateCandidates(db: Database, identity: DuplicateIdentityInput): Promise<DuplicateMatchResult> {
  const bookRepository = new DrizzleBookRepository(db);
  const notArchived = ne(books.reviewStatus, "archived");

  const normalizedIsbn10 = identity.isbn10?.replace(/[^0-9Xx]/g, "").toUpperCase();
  const normalizedIsbn13 = identity.isbn13?.replace(/[^0-9Xx]/g, "").toUpperCase();

  // Step 1 — exact ISBN match, the only signal strong enough to decide identity on
  // its own.
  if (normalizedIsbn10 || normalizedIsbn13) {
    const isbnConditions = [];
    if (normalizedIsbn10) isbnConditions.push(eq(books.isbn10, normalizedIsbn10));
    if (normalizedIsbn13) isbnConditions.push(eq(books.isbn13, normalizedIsbn13));
    const isbnRows = await db
      .select({ id: books.id })
      .from(books)
      .where(and(notArchived, or(...isbnConditions)))
      .limit(MAX_CANDIDATES);

    if (isbnRows.length > 0) {
      const matchedBooks = await bookRepository.getBooksByIds(isbnRows.map((r) => r.id));
      const candidates = matchedBooks.map((book) => ({
        book,
        outcome: "exact_copy_same_edition" as const,
        detectedBy: "isbn_match" as const,
        titleSimilarity: 1,
      }));
      return { outcome: "exact_copy_same_edition", candidates };
    }
  }

  // Step 2 — trigram title similarity, index-accelerated via the `%` operator (the
  // exact pattern `SearchRepository` already established — see its own comment for
  // why `%` rather than `similarity() > floor`), scoped to a real, bounded floor,
  // never the whole catalog.
  const titleRows = await db
    .select({ id: books.id, similarity: sql<number>`similarity(${books.title}, ${identity.title})` })
    .from(books)
    .where(and(notArchived, sql`${books.title} % ${identity.title}`))
    .orderBy(sql`similarity(${books.title}, ${identity.title}) desc`)
    .limit(MAX_CANDIDATES * 2); // headroom before the real floor filter below

  const aboveFloor = titleRows.filter((row) => row.similarity >= DUPLICATE_TITLE_SIMILARITY_FLOOR).slice(0, MAX_CANDIDATES);
  if (aboveFloor.length === 0) {
    return { outcome: "no_match", candidates: [] };
  }

  const similarityById = new Map(aboveFloor.map((row) => [row.id, row.similarity]));
  const matchedBooks = await bookRepository.getBooksByIds(aboveFloor.map((row) => row.id));

  const candidates: DuplicateCandidate[] = matchedBooks.map((book) => {
    const titleSimilarity = similarityById.get(book.id) ?? 0;
    const outcome = classify(identity, book, titleSimilarity);
    return { book, outcome, detectedBy: "title_author_match" as const, titleSimilarity };
  });

  candidates.sort((a, b) => outcomePriority[b.outcome] - outcomePriority[a.outcome] || b.titleSimilarity - a.titleSimilarity);

  return { outcome: candidates[0].outcome, candidates };
}
