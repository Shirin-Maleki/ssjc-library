import type { Book } from "@/lib/catalog/types";
import { getLanguageName } from "@/lib/catalog/languages";
import { ILLUSTRATION_STYLE_LABELS } from "@/lib/catalog/labels";
import { normalizeSearchText } from "./normalize";

export type SuggestionType =
  | "title"
  | "author"
  | "illustrator"
  | "publisher"
  | "category"
  | "topic"
  | "language"
  | "illustration_style";

export interface AutocompleteSuggestion {
  value: string;
  type: SuggestionType;
}

const SUGGESTION_TYPE_LABELS: Record<SuggestionType, string> = {
  title: "Title",
  author: "Author",
  illustrator: "Illustrator",
  publisher: "Publisher",
  category: "Category",
  topic: "Topic",
  language: "Language",
  illustration_style: "Illustration style",
};

export function getSuggestionTypeLabel(type: SuggestionType): string {
  return SUGGESTION_TYPE_LABELS[type];
}

/**
 * Suggestions are entirely derived from the catalog passed in — never a second,
 * hard-coded list (docs/SEARCH.md). Prefix matches rank above substring matches;
 * ties break alphabetically. Requires at least 2 characters, matching the UI's own
 * "don't show autocomplete when it isn't useful" rule.
 */
export function deriveAutocompleteOptions(
  books: Book[],
  query: string,
  categoryLabelBySlug: Map<string, string>,
  limit = 8
): AutocompleteSuggestion[] {
  const normalizedQuery = normalizeSearchText(query);
  if (normalizedQuery.length < 2) return [];

  const candidates = new Map<string, AutocompleteSuggestion>();
  const add = (value: string, type: SuggestionType) => {
    const key = `${type}:${value.toLowerCase()}`;
    if (!candidates.has(key)) candidates.set(key, { value, type });
  };

  for (const book of books) {
    add(book.title, "title");
    for (const author of book.authors) add(author, "author");
    for (const illustrator of book.illustrators ?? []) add(illustrator, "illustrator");
    add(book.publisher, "publisher");
    const categoryLabel = categoryLabelBySlug.get(book.physicalCategory);
    if (categoryLabel) add(categoryLabel, "category");
    for (const tag of book.tags) add(tag, "topic");
    add(getLanguageName(book.languageCode), "language");
    for (const style of book.illustrationStyles) add(ILLUSTRATION_STYLE_LABELS[style], "illustration_style");
  }

  const scored = Array.from(candidates.values())
    .map((suggestion) => {
      const normalizedValue = normalizeSearchText(suggestion.value);
      const isPrefix = normalizedValue.startsWith(normalizedQuery);
      const isMatch = isPrefix || normalizedValue.includes(normalizedQuery);
      return { suggestion, isPrefix, isMatch };
    })
    .filter((entry) => entry.isMatch);

  scored.sort((a, b) => {
    if (a.isPrefix !== b.isPrefix) return a.isPrefix ? -1 : 1;
    if (a.suggestion.value.length !== b.suggestion.value.length) {
      return a.suggestion.value.length - b.suggestion.value.length;
    }
    return a.suggestion.value.localeCompare(b.suggestion.value);
  });

  return scored.slice(0, limit).map((entry) => entry.suggestion);
}
