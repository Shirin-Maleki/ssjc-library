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
