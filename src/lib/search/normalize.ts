/**
 * Query and catalog-field normalization shared by matching, ranking, and autocomplete.
 * Deliberately simple — no stemming library, no general NLP. See docs/SEARCH.md.
 */

/** Generic words that must never, by themselves, justify a result — see docs/SEARCH.md
 * "meaningful matches." Kept short and reviewable rather than an imported list. */
export const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "book",
  "books",
  "story",
  "stories",
  "something",
  "please",
  "want",
  "wants",
  "need",
  "needs",
  "looking",
  "for",
  "by",
  "with",
  "about",
  "me",
  "find",
  "show",
  "i",
  "im",
  "some",
  "of",
  "to",
  "and",
  "or",
  "is",
  "are",
  "read",
  "reading",
  // Left-over scaffolding words from recognized age/duration phrases ("age 4",
  // "4 year old", "5 minute") — parseAgeYearsFromText/parseDurationBandFromText
  // already extract the actual signal from these; leaving the words themselves in
  // the free-text token pool caused a real false-positive match (see
  // docs/SEARCH.md): "age" is a substring of "courage", so "friendship for age 4"
  // was spuriously boosting any book tagged "courage".
  "age",
  "ages",
  "year",
  "years",
  "old",
  "olds",
  "minute",
  "minutes",
]);

/** Strips diacritics (é→e, ö→o, å→a, ñ→n, …) via Unicode decomposition — enough to
 * make Scandinavian/Spanish/French titles and tags searchable from an unaccented
 * query without a per-language table.
 *
 * "ø" and "æ" are handled explicitly first: unlike "å" or "é", they have no Unicode
 * canonical decomposition (they're distinct letters, not base+combining-mark), so
 * NFD alone leaves them untouched — the general strip step below would then treat
 * them as punctuation and replace them with a space, splitting the word in two. */
export function stripDiacritics(text: string): string {
  const withKnownLetters = text.replace(/[øØ]/g, "o").replace(/[æÆ]/g, "a");
  return withKnownLetters.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** The one canonical title-normalization function — used both when a book's
 * `normalized_title` column is written (seed, backfill, future import) and when an
 * incoming free-text query is compared against it (`SearchRepository`'s exact-match
 * candidate query). Lowercased, leading-article-stripped, diacritic-stripped,
 * punctuation-collapsed. Phase 5 correction pass: these two sides previously used
 * different logic (`normalizeTitle` in `seed.ts` vs. a bare `trimmed.toLowerCase()`
 * in `searchRepository.ts`), so a query like "The Very Hungry Caterpillar" (with
 * its leading article) failed to exact-match a stored `normalized_title` of "very
 * hungry caterpillar" (the article already stripped at seed time) — never
 * maintain two subtly different title-normalization implementations. */
export function normalizeTitle(title: string): string {
  return stripDiacritics(title.toLowerCase())
    .replace(/^(the|a|an)\s+/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function normalizeSearchText(text: string): string {
  return stripDiacritics(text.toLowerCase())
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenize(text: string): string[] {
  return normalizeSearchText(text)
    .split(" ")
    .filter(Boolean);
}

/** Tokens worth matching against — stop words removed. An empty result means the
 * query (if any) carried no meaningful free-text signal on its own. */
export function meaningfulTokens(text: string): string[] {
  return tokenize(text).filter((token) => !STOP_WORDS.has(token));
}
