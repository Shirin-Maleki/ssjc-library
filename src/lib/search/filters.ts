import type { Book } from "@/lib/catalog/types";
import { bookMatchesAgeYears } from "@/lib/catalog/age";
import { getReadDurationBand } from "@/lib/catalog/duration";

/**
 * Explicit teacher-selected constraints — AND across different groups, OR within a
 * multi-select group (docs/SEARCH.md). Every field is optional/empty by default,
 * meaning "no constraint from this group." Unlike SearchIntent (lib/search/intent.ts),
 * these actually exclude non-matching books.
 */
export interface Filters {
  ageYears?: number;
  languages?: string[];
  fictionTypes?: string[];
  categories?: string[];
  formats?: string[];
  illustrationStyles?: string[];
  visualRealism?: string[];
  durations?: string[];
  authors?: string[];
  illustrators?: string[];
  publishers?: string[];
}

export const EMPTY_FILTERS: Filters = {};

function orMatch(selected: string[] | undefined, value: string): boolean {
  if (!selected || selected.length === 0) return true;
  return selected.includes(value);
}

function orMatchAny(selected: string[] | undefined, values: string[]): boolean {
  if (!selected || selected.length === 0) return true;
  return values.some((value) => selected.includes(value));
}

export function matchesFilters(book: Book, filters: Filters): boolean {
  if (typeof filters.ageYears === "number" && !bookMatchesAgeYears(book, filters.ageYears)) {
    return false;
  }
  // A multilingual book (a primary language plus one or more `additionalLanguageCodes`)
  // must be discoverable by a teacher filtering on any one of them, not just the
  // primary — same OR-within-a-group semantics as illustrationStyles below.
  if (!orMatchAny(filters.languages, [book.languageCode, ...(book.additionalLanguageCodes ?? [])])) return false;
  if (!orMatch(filters.fictionTypes, book.fictionType)) return false;
  if (!orMatch(filters.categories, book.physicalCategory)) return false;
  if (!orMatch(filters.formats, book.format)) return false;
  if (!orMatchAny(filters.illustrationStyles, book.illustrationStyles)) return false;
  if (!orMatch(filters.visualRealism, book.visualRealism)) return false;
  if (!orMatch(filters.durations, getReadDurationBand(book.readAloudMinutes))) return false;
  if (!orMatchAny(filters.authors, book.authors)) return false;
  if (!orMatchAny(filters.illustrators, book.illustrators ?? [])) return false;
  if (!orMatch(filters.publishers, book.publisher)) return false;
  return true;
}

export function countActiveFilters(filters: Filters): number {
  let count = 0;
  if (typeof filters.ageYears === "number") count += 1;
  count += filters.languages?.length ?? 0;
  count += filters.fictionTypes?.length ?? 0;
  count += filters.categories?.length ?? 0;
  count += filters.formats?.length ?? 0;
  count += filters.illustrationStyles?.length ?? 0;
  count += filters.visualRealism?.length ?? 0;
  count += filters.durations?.length ?? 0;
  count += filters.authors?.length ?? 0;
  count += filters.illustrators?.length ?? 0;
  count += filters.publishers?.length ?? 0;
  return count;
}

export function hasActiveFilters(filters: Filters): boolean {
  return countActiveFilters(filters) > 0;
}
