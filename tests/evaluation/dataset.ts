import type { Filters } from "@/lib/search/filters";
import { EMPTY_FILTERS } from "@/lib/search/filters";

export type EvaluationCategory = "known_item" | "structured" | "safety" | "exploratory";

export interface EvaluationCase {
  id: string;
  category: EvaluationCategory;
  query: string;
  filters?: Partial<Filters>;
  /** At least one of these titles must appear somewhere in the returned results for
   * the case to "recall" at all. Empty array means "expect zero results." Omitted
   * entirely (undefined) means this case doesn't check recall at all — it only
   * cares about `mustNotInclude`/`expectedTop1`/`expectedTop5`, reported as "n/a"
   * for recall the same way an omitted `expectedTop1` is "n/a" for top-1. */
  expectedAnyOf?: string[];
  /** The single best match — checked against the #1 result specifically ("top-1"). */
  expectedTop1?: string;
  /** At least one of these must appear within the first 5 results ("top-5"). */
  expectedTop5?: string[];
  /** Titles that must never appear in the results, regardless of rank — a real
   * correctness/safety violation if they do. `"*"` means "no results at all." */
  mustNotInclude?: string[];
  rationale: string;
}

/**
 * A committed, human-readable search evaluation dataset — deliberately separate
 * from the seeded development catalog's own fixture definitions
 * (`src/lib/catalog/fixtures.ts`) and from any future production catalog. Every
 * case here is checked against the real Postgres-backed pipeline
 * (`SearchRepository` + `SearchService`), not the in-memory Phase 2–4 engine. See
 * `tests/evaluation/searchEvaluation.eval.ts` for how these are run and
 * `docs/SEARCH.md` §11 for how results are reported.
 *
 * Phase 5 correction pass: expanded from an initial 13 cases to cover every
 * dimension the brief calls out — known-item (including ISBN and diacritics),
 * structured/multilingual (including hard filters and combinations), correctness/
 * safety (including incomplete-metadata and hard-filter-vs-semantic dominance), and
 * exploratory (including two development-only fixtures for themes the 48-book seed
 * has no credible real match for — see
 * `EVALUATION_ONLY_FIXTURE_BOOKS` in `searchEvaluation.eval.ts`, inserted and
 * cleaned up by that file, never part of `src/db/seed.ts`).
 */
export const EVALUATION_CASES: EvaluationCase[] = [
  // ============================================================
  // KNOWN-ITEM
  // ============================================================
  {
    id: "known-item-exact-title",
    category: "known_item",
    query: "The Very Hungry Caterpillar",
    expectedAnyOf: ["The Very Hungry Caterpillar"],
    expectedTop1: "The Very Hungry Caterpillar",
    rationale: "An exact title match must be the unambiguous #1 result.",
  },
  {
    id: "known-item-normalized-title-no-article",
    category: "known_item",
    query: "Very Hungry Caterpillar",
    expectedAnyOf: ["The Very Hungry Caterpillar"],
    expectedTop1: "The Very Hungry Caterpillar",
    rationale:
      "A query without the book's own leading article must still exact-match via the canonical normalizer (normalizeTitle) both sides now share — regression case for the normalization-mismatch bug this correction pass fixed.",
  },
  {
    id: "known-item-title-with-punctuation",
    category: "known_item",
    query: "The Gruffalo!",
    expectedAnyOf: ["The Gruffalo"],
    expectedTop1: "The Gruffalo",
    rationale: "Trailing punctuation a teacher might type must not prevent an otherwise-exact title match.",
  },
  {
    id: "known-item-author",
    category: "known_item",
    query: "Eric Carle",
    expectedAnyOf: ["The Very Hungry Caterpillar", "Brown Bear, Brown Bear, What Do You See?", "The Grouchy Ladybug"],
    rationale: "A real author's full name must surface their books via exact contributor matching.",
  },
  {
    id: "known-item-illustrator",
    category: "known_item",
    query: "Axel Scheffler",
    expectedAnyOf: ["The Gruffalo"],
    expectedTop1: "The Gruffalo",
    rationale: "An illustrator's full name must surface their book via exact contributor matching, not just authors.",
  },
  {
    id: "known-item-publisher",
    category: "known_item",
    query: "Philomel Books",
    expectedAnyOf: ["The Very Hungry Caterpillar"],
    rationale: "An exact publisher name must surface its books via exact publisher matching.",
  },
  {
    id: "known-item-isbn-10",
    category: "known_item",
    query: "0399226907",
    expectedAnyOf: ["The Very Hungry Caterpillar"],
    expectedTop1: "The Very Hungry Caterpillar",
    rationale: "A bare ISBN-10 has no field for the deterministic free-text pass to compare against — the retrieval layer's exact-match branch is the only place this signal can exist at all.",
  },
  {
    id: "known-item-isbn-13",
    category: "known_item",
    query: "9780333710937",
    expectedAnyOf: ["The Gruffalo"],
    expectedTop1: "The Gruffalo",
    rationale: "Same as ISBN-10, for the 13-digit form.",
  },
  {
    id: "known-item-title-typo",
    category: "known_item",
    query: "caterpilar",
    expectedAnyOf: ["The Very Hungry Caterpillar"],
    rationale: "A real one-word typo must be tolerated via trigram fuzzy matching (docs/SEARCH.md §3).",
  },
  {
    id: "known-item-contributor-typo",
    category: "known_item",
    query: "Eric Carl",
    expectedAnyOf: ["The Very Hungry Caterpillar", "Brown Bear, Brown Bear, What Do You See?"],
    rationale: "A one-letter contributor-name typo must still surface real books via trigram matching against contributor names, not just titles.",
  },
  {
    id: "known-item-diacritics",
    category: "known_item",
    query: "Bestefars Bat",
    expectedAnyOf: ["Bestefars Båt"],
    rationale: "An unaccented query (no 'å') must still find a title that carries the diacritic, via diacritic-stripped exact/fuzzy matching.",
  },

  // ============================================================
  // STRUCTURED AND MULTILINGUAL
  // ============================================================
  {
    id: "structured-primary-language-native-title-query",
    category: "structured",
    query: "Bestefars Båt",
    expectedAnyOf: ["Bestefars Båt"],
    expectedTop1: "Bestefars Båt",
    rationale:
      "A query in the book's own primary (non-English) language must still exact-match its title — full-text search itself uses an English-only stemming configuration (a documented simplification, docs/SEARCH.md §3), so this specifically verifies the language-agnostic exact-match path, not stemmed non-English retrieval.",
  },
  {
    id: "structured-additional-language-only-free-text",
    category: "structured",
    query: "a German book about love",
    expectedAnyOf: ["Guess How Much I Love You"],
    rationale:
      "'Guess How Much I Love You' is English-primary with German as an ADDITIONAL language only — free-text language-intent parsing must check additional languages too, not just primary (docs/SEARCH.md, language parity).",
  },
  {
    id: "structured-explicit-language-filter",
    category: "structured",
    query: "",
    filters: { languages: ["no"] },
    expectedAnyOf: ["Bestefars Båt", "Frøet som ville blomstre"],
    mustNotInclude: ["The Very Hungry Caterpillar"],
    rationale: "An explicit language filter is a hard SQL constraint scoped to the queryless-browse bounded pagination path.",
  },
  {
    id: "structured-age-3",
    category: "structured",
    query: "",
    filters: { ageYears: 3 },
    // Age-only queryless browsing ties every age-appropriate book at score 0
    // (alphabetical order, no free-text signal to differentiate them) — checked
    // against the real top-10 (sort_title order) for age 3 (36 months), not
    // assumed. See docs/SEARCH.md §7/§9.
    expectedAnyOf: ["Alfie Atkins Wants to Choose", "Amazing Animal Babies"],
    rationale: "Age 3 (36 months) as an explicit hard filter.",
  },
  {
    id: "structured-age-4",
    category: "structured",
    query: "",
    filters: { ageYears: 4 },
    // Same alphabetical-tie reasoning as age 3 above — checked against the real
    // top-10 for age 4 (48 months).
    expectedAnyOf: ["Bestefars Båt", "Celebrating Together", "Bugs Up Close"],
    rationale: "Age 4 (48 months) as an explicit hard filter — distinct age point from age 3.",
  },
  {
    id: "structured-age-range-phrase",
    category: "structured",
    query: "a book for 2 to 5 year olds",
    // A pure age-range phrase with no other distinguishing text ties every
    // age-appropriate book at the same deterministic score, same as the
    // "structured-age-phrase" finding earlier in this pass — checked against real
    // output, not assumed (docs/SEARCH.md §2/§9).
    expectedAnyOf: ["Celebrating Together", "Pettson and Findus: Finding a Rooster", "Un Día en el Mercado"],
    rationale: "A free-text age-range phrase ('2 to 5') resolves to a representative midpoint — a soft/strong ranking signal, never a hard filter.",
  },
  {
    id: "structured-fiction-hard-filter",
    category: "structured",
    query: "",
    filters: { fictionTypes: ["nonfiction"] },
    expectedAnyOf: ["Amazing Animal Babies", "Bugs Up Close", "My First Book of Shapes"],
    mustNotInclude: ["The Very Hungry Caterpillar", "The Gruffalo"],
    rationale: "An explicit fiction/nonfiction filter is a hard SQL constraint.",
  },
  {
    id: "structured-format-hard-filter",
    category: "structured",
    query: "",
    filters: { formats: ["board_book"] },
    expectedAnyOf: ["The Grouchy Ladybug", "My First Book of Shapes"],
    rationale: "An explicit format filter is a hard SQL constraint.",
  },
  {
    id: "structured-category-hard-filter",
    category: "structured",
    query: "",
    filters: { categories: ["stem-discovery"] },
    expectedAnyOf: ["My First Book of Shapes", "Numbers on Our Street"],
    mustNotInclude: ["The Very Hungry Caterpillar"],
    rationale: "An explicit category filter is a hard SQL constraint.",
  },
  {
    id: "structured-duration-under-5",
    category: "structured",
    query: "",
    filters: { durations: ["under_5"] },
    expectedAnyOf: ["Amazing Animal Babies", "My First Book of Shapes"],
    rationale: "An explicit duration-band filter is a hard SQL constraint.",
  },
  {
    id: "structured-real-photography",
    category: "structured",
    query: "",
    filters: { visualRealism: ["real_photography"] },
    expectedAnyOf: ["Amazing Animal Babies", "Bugs Up Close"],
    rationale: "An explicit visual-realism filter is a hard SQL constraint.",
  },
  {
    id: "structured-watercolor",
    category: "structured",
    query: "",
    filters: { illustrationStyles: ["watercolor"] },
    expectedAnyOf: ["The Gruffalo", "Winter's Quiet Sleep"],
    rationale: "An explicit illustration-style filter (watercolor) is a hard SQL constraint.",
  },
  {
    id: "structured-collage",
    category: "structured",
    query: "",
    filters: { illustrationStyles: ["collage"] },
    expectedAnyOf: ["The Very Hungry Caterpillar", "The Snowy Day"],
    rationale: "An explicit illustration-style filter (collage) is a hard SQL constraint.",
  },
  {
    id: "structured-multiple-simultaneous-filters",
    category: "structured",
    query: "",
    filters: { categories: ["stem-discovery"], formats: ["board_book"], fictionTypes: ["nonfiction"] },
    expectedAnyOf: ["My First Book of Shapes"],
    mustNotInclude: ["Numbers on Our Street"], // picture_book, not board_book — must be excluded by the format filter
    rationale: "Three simultaneous hard filters (category AND format AND fiction type) must all apply together, not any one alone.",
  },

  // ============================================================
  // CORRECTNESS AND SAFETY
  // ============================================================
  {
    id: "safety-generic-filler-query-returns-nothing",
    category: "safety",
    query: "something to read please",
    expectedAnyOf: [],
    mustNotInclude: ["*"],
    rationale:
      "Regression case for a real bug: the boilerplate word 'read' incidentally matched every book via a structural label. A query built entirely from generic words must return zero results, never padded.",
  },
  {
    id: "safety-pending-review-book-never-appears",
    category: "safety",
    query: "Pending Review Test Book",
    expectedAnyOf: [],
    mustNotInclude: ["Pending Review Test Book"],
    rationale: "A pending_review book must never appear in teacher-facing search results, however precisely its title is typed.",
  },
  {
    id: "safety-archived-book-never-appears",
    category: "safety",
    query: "Archived Test Book",
    expectedAnyOf: [],
    mustNotInclude: ["Archived Test Book"],
    rationale: "An archived book must never appear in teacher-facing search results.",
  },
  {
    id: "safety-unknown-duration-not-treated-as-short",
    category: "safety",
    query: "",
    filters: { durations: ["under_5"] },
    mustNotInclude: ["Book With Incomplete Metadata"],
    expectedAnyOf: ["Amazing Animal Babies", "My First Book of Shapes"],
    rationale:
      "'Book With Incomplete Metadata' has no recorded read-aloud duration at all — an unrecorded duration must never satisfy an 'Under 5 minutes' filter the way a fabricated 0-minute default would.",
  },
  {
    id: "safety-unknown-realism-not-treated-as-mixed",
    category: "safety",
    query: "",
    filters: { visualRealism: ["mixed"] },
    mustNotInclude: ["Book With Incomplete Metadata"],
    // Deliberately no `expectedAnyOf` — some real fixture books (e.g. "Dinosaur
    // Bones", "How Plants Grow") genuinely have `visualRealism: "mixed"` as a
    // real, confirmed value, so filtering to "mixed" legitimately returns them.
    // The actual invariant under test is narrower and is what `mustNotInclude`
    // checks: the INCOMPLETE-metadata book (genuinely unrecorded realism) must
    // never be coerced into matching "mixed" the way a fabricated default would.
    rationale:
      "'Book With Incomplete Metadata' has no recorded visual realism — an unrecorded value must never satisfy a 'mixed' filter the way a fabricated default would (distinct from a real book whose realism is genuinely, confirmedly 'mixed').",
  },
  {
    id: "safety-unknown-fiction-status-not-treated-as-nonfiction",
    category: "safety",
    query: "",
    filters: { fictionTypes: ["nonfiction"] },
    mustNotInclude: ["Book With Incomplete Metadata"],
    expectedAnyOf: ["Amazing Animal Babies"],
    rationale:
      "'Book With Incomplete Metadata' has an unknown fiction status (unknown_mixed) — it must never satisfy an explicit 'nonfiction' filter the way a fabricated default would.",
  },
  {
    id: "safety-incompatible-filter-combination",
    category: "safety",
    query: "",
    filters: { languages: ["sv"], durations: ["ten_plus"], visualRealism: ["real_photography"] },
    expectedAnyOf: [],
    mustNotInclude: ["*"],
    rationale: "An incompatible combination of real hard filters must return zero padded/approximate results.",
  },
  {
    id: "safety-hard-category-filter-not-overridden-by-thematic-relevance",
    category: "safety",
    query: "baby animals",
    filters: { categories: ["stem-discovery"] },
    mustNotInclude: ["Amazing Animal Babies"],
    rationale:
      "'Amazing Animal Babies' would score very highly for this query on thematic grounds alone (it's exactly about baby animals) — but it lives in Animals & Nature, not STEM & Discovery, so an explicit category hard filter must exclude it regardless of how strong its textual/semantic relevance would otherwise be. No real embedding provider is configured in this environment, so this specifically proves the SQL-level hard-filter enforcement, which applies identically whether or not a semantic signal is present (docs/SEARCH.md §9: 'hard filters never violated by semantic similarity').",
  },
  {
    id: "safety-exact-title-outranks-thematic-match",
    category: "safety",
    query: "The Very Hungry Caterpillar",
    expectedTop1: "The Very Hungry Caterpillar",
    rationale: "An exact title match must rank #1 even though other animal/insect-themed books ('Bugs Up Close', 'The Grouchy Ladybug') are thematically related and could otherwise compete on keyword overlap.",
  },
  {
    id: "safety-exact-contributor-outranks-weaker-thematic-match",
    category: "safety",
    query: "Eric Carle",
    expectedTop5: ["The Very Hungry Caterpillar", "Brown Bear, Brown Bear, What Do You See?", "The Grouchy Ladybug"],
    mustNotInclude: ["Dinosaur Adventure"],
    rationale: "An exact contributor-name match must dominate the results; a book with no relationship to Eric Carle at all must not appear just because it's a generically popular animal-adjacent title.",
  },
  {
    id: "safety-provider-absence-preserves-conventional-results",
    category: "safety",
    query: "The Very Hungry Caterpillar",
    expectedTop1: "The Very Hungry Caterpillar",
    rationale:
      "With no GEMINI_API_KEY configured in this environment, every query — including this one — already runs the provider-absence fallback path (SearchService.tryEmbedQuery catches the missing-provider case and returns undefined). This case exists specifically to make that fallback's effect on a real query explicit in the report: conventional retrieval alone still finds the exact right answer.",
  },

  // ============================================================
  // EXPLORATORY
  // ============================================================
  {
    id: "exploratory-friendship-sharing",
    category: "exploratory",
    query: "a story about learning to share with a friend",
    expectedAnyOf: ["The Rainbow Fish", "Should I Share My Ice Cream?"],
    rationale: "A descriptive theme query (sharing/friendship), not a title or keyword, must retrieve thematically relevant books.",
  },
  {
    id: "exploratory-winter-atmosphere",
    category: "exploratory",
    query: "a quiet story about animals getting ready for winter",
    expectedAnyOf: ["Winter's Quiet Sleep", "The Snowy Day"],
    rationale: "A mood/atmosphere description must still retrieve thematically relevant books via FTS/trigram over descriptions and tags.",
  },
  {
    id: "exploratory-curriculum-concept-query",
    category: "exploratory",
    query: "a book for learning shapes and colors",
    expectedAnyOf: ["My First Book of Shapes"],
    rationale: "A curriculum/concept-oriented query (a common real teacher need) must retrieve the relevant concept book.",
  },
  {
    id: "exploratory-gentle-separation-goodbye",
    category: "exploratory",
    query: "a gentle story about saying goodbye to a parent for the day",
    expectedAnyOf: ["Back Before You Know It"],
    rationale:
      "No real 48-book fixture credibly covers this specific, common early-childhood theme (a gentle daily-separation/goodbye story, distinct from bedtime) — 'Back Before You Know It' is an explicitly labeled, development-only evaluation fixture inserted by the evaluation harness itself (never part of src/db/seed.ts), per the brief's own allowance for this exact situation.",
  },
  {
    id: "exploratory-starting-school-anxiety",
    category: "exploratory",
    query: "a reassuring story for a child nervous about their first day of school",
    expectedAnyOf: ["My First Day at Oakwood"],
    rationale:
      "Same situation as the separation/goodbye case above — no real fixture covers starting-school anxiety specifically. 'My First Day at Oakwood' is the second explicitly labeled, development-only evaluation fixture.",
  },
];

export { EMPTY_FILTERS };
