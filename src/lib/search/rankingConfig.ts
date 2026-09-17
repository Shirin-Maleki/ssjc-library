/**
 * Every ranking weight lives here, and only here — see docs/SEARCH.md. If a result
 * ordering looks wrong, this is the one file to check; nothing else in lib/search
 * should contain a bare numeric weight.
 *
 * Roughly: exact title > title prefix/partial > author/illustrator/publisher/
 * category/tag/language/age/illustration-style/realism/duration (all "strong",
 * intentionally close in weight since none should categorically dominate the others)
 * > format/fiction-type ("medium") > description keyword (a weak supporting signal).
 */
export const RANKING_WEIGHTS = {
  exactTitle: 100,
  titlePrefix: 70,
  titlePartial: 40,
  author: 60,
  illustrator: 55,
  publisherOrImprint: 45,
  physicalCategory: 50,
  tagOrTopic: 50,
  languageIntent: 45,
  ageIntent: 45,
  illustrationStyleIntent: 45,
  visualRealismIntent: 45,
  durationIntent: 40,
  formatOrFictionType: 25,
  descriptionKeyword: 15,
} as const;

/** A book with a total score at or below this is not a meaningful result — see
 * docs/SEARCH.md "do not pad results." */
export const MINIMUM_MEANINGFUL_SCORE = 0;

/**
 * Phase 5 — the SQL/retrieval-layer signals `src/lib/search/hybridScore.ts` adds on
 * top of the deterministic score above. Deliberately on the *same* 0–100 scale as
 * `RANKING_WEIGHTS` so the two are genuinely comparable, but capped well below
 * `exactTitle` (100) for every signal except `exactRetrievalMatch` itself — a purely
 * semantic/fuzzy match must never outrank a real deterministic signal
 * (docs/SEARCH.md §9, "exact known-item matches must dominate weaker semantic
 * similarity"). `exactRetrievalMatch` (ISBN, or a title/contributor/publisher
 * equality the deterministic pass may not have scored the same way) intentionally
 * matches `exactTitle`'s weight — it exists specifically for cases like a bare ISBN
 * query, where the deterministic free-text pass has no field to compare a digit
 * string against, so the retrieval layer is the *only* place that signal exists.
 */
export const RETRIEVAL_SIGNAL_WEIGHTS = {
  exactRetrievalMatch: 100,
  /** `ts_rank` values are small and unbounded above (typically well under 1) — this
   * scales a typical strong match up into a meaningful, comparable range without
   * ever approaching `exactTitle`. */
  fullTextRank: 30,
  /** `pg_trgm` `similarity()` is already 0–1. */
  trigramSimilarity: 25,
  /** Cosine similarity (`1 - cosine distance`), 0–1. Deliberately the smallest
   * weight of the four: semantic retrieval is additive, never a substitute for a
   * real keyword/structured signal (docs/SEARCH.md §9). */
  semanticSimilarity: 20,
} as const;
