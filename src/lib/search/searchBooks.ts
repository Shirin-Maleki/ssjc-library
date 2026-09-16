import type { Book } from "@/lib/catalog/types";
import { matchesFilters, type Filters } from "./filters";
import { rankBooks } from "./rank";
import { buildMatchExplanation } from "./explain";

export interface SearchResult {
  book: Book;
  score: number;
  explanation: string;
}

export interface SearchBooksInput {
  books: Book[];
  query: string;
  filters: Filters;
  /** Real category slug→label data (Phase 4 brief §15) — used only to word a
   * "Matches the X category" explanation phrase; filtering/ranking never touch this.
   * Optional (defaults to showing the raw slug) so existing callers/tests that don't
   * care about explanation wording don't need to change. */
  categoryLabelBySlug?: Map<string, string>;
}

/**
 * The single entry point the UI calls — see docs/SEARCH.md for the full pipeline.
 * Filters are hard AND/OR constraints applied first; ranking (including free-text
 * intent signals) only ever orders and scores the books that already passed them.
 */
export function searchBooks({ books, query, filters, categoryLabelBySlug }: SearchBooksInput): SearchResult[] {
  const eligible = books.filter((book) => matchesFilters(book, filters));
  const ranked = rankBooks(eligible, query);
  return ranked.map(({ book, score, reasons }) => ({
    book,
    score,
    explanation: buildMatchExplanation(reasons, categoryLabelBySlug),
  }));
}
