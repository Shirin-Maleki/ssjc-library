/**
 * Every identity-reconciliation weight/threshold lives here, and only here (Phase 7
 * — mirrors `src/lib/search/rankingConfig.ts`'s exact convention). Reconciliation
 * (`src/lib/intake/reconciliation.ts`) is a deterministic evidence match, never "ask
 * Gemini which API result is correct" (§16 of the phase brief) — these are the
 * centralized, tested thresholds that decide `high_confidence` / `ambiguous` /
 * `unresolved`, not one universal AI confidence number.
 */
export const RECONCILIATION_WEIGHTS = {
  /** An ISBN genuinely visible on the cover, confirmed by a provider candidate's own
   * ISBN — the single strongest possible signal; near-certain on its own. */
  isbnMatch: 100,
  normalizedTitleMatch: 45,
  authorMatch: 30,
  subtitleMatch: 15,
  languageMatch: 10,
  publisherMatch: 10,
} as const;

/** At or above this score, identity is accepted as `high_confidence` — an ISBN
 * match alone clears it; a strong combination (title + author, or title + author +
 * language) also does. */
export const HIGH_CONFIDENCE_THRESHOLD = 75;

/** At or above this score (but below `HIGH_CONFIDENCE_THRESHOLD`), identity is
 * `ambiguous` — real evidence exists, but not enough to accept automatically; a
 * teacher decides. Below this, `unresolved` — too little evidence to present as a
 * meaningful match at all. */
export const AMBIGUOUS_THRESHOLD = 30;
