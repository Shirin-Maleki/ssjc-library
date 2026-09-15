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
}

/**
 * The single entry point the UI calls — see docs/SEARCH.md for the full pipeline.
 * Filters are hard AND/OR constraints applied first; ranking (including free-text
 * intent signals) only ever orders and scores the books that already passed them.
 */
export function searchBooks({ books, query, filters }: SearchBooksInput): SearchResult[] {
  const eligible = books.filter((book) => matchesFilters(book, filters));
  const ranked = rankBooks(eligible, query);
  return ranked.map(({ book, score, reasons }) => ({
    book,
    score,
    explanation: buildMatchExplanation(reasons),
  }));
}
