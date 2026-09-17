import type { Filters } from "@/lib/search/filters";
import { EMPTY_FILTERS } from "@/lib/search/filters";

export type EvaluationCategory = "known_item" | "structured" | "exploratory" | "safety";

export interface EvaluationCase {
  id: string;
  category: EvaluationCategory;
  query: string;
  filters?: Partial<Filters>;
  /** At least one of these titles must appear somewhere in the returned results for
   * the case to "recall" at all. */
  expectedAnyOf: string[];
  /** The single best match — checked against the #1 result specifically ("top-1"). */
  expectedTop1?: string;
  /** Titles that must never appear in the results, regardless of rank — a real
   * correctness/safety violation if they do (e.g. a book that must be excluded by a
   * hard filter, or a book from a different catalog entirely). */
  mustNotInclude?: string[];
  rationale: string;
}

/**
 * A committed, human-readable search evaluation dataset — deliberately separate from
 * the seeded development catalog's own fixture definitions
 * (`src/lib/catalog/fixtures.ts`) and from any future production catalog. Every case
 * here is checked against the real Postgres-backed pipeline (`SearchRepository` +
 * `SearchService`), not the in-memory Phase 2–4 engine. See
 * `tests/evaluation/searchEvaluation.eval.ts` for how these are run and
 * `docs/SEARCH.md` §11 for how the results are reported.
 */
export const EVALUATION_CASES: EvaluationCase[] = [
  // --- known-item: an exact/near-exact title or author the teacher already knows ---
  {
    id: "known-item-exact-title",
    category: "known_item",
    query: "The Very Hungry Caterpillar",
    expectedAnyOf: ["The Very Hungry Caterpillar"],
    expectedTop1: "The Very Hungry Caterpillar",
    rationale: "An exact title match must be the unambiguous #1 result.",
  },
  {
    id: "known-item-author-name",
    category: "known_item",
    query: "Eric Carle",
    expectedAnyOf: ["The Very Hungry Caterpillar", "Brown Bear, Brown Bear, What Do You See?"],
    rationale: "A real author's full name must surface their books via exact contributor matching.",
  },
  {
    id: "known-item-typo-tolerance",
    category: "known_item",
    query: "the gruffalo",
    expectedAnyOf: ["The Gruffalo"],
    expectedTop1: "The Gruffalo",
    rationale: "Case-insensitive exact title matching must still resolve to #1.",
  },
  {
    id: "known-item-title-typo",
    category: "known_item",
    query: "caterpilar",
    expectedAnyOf: ["The Very Hungry Caterpillar"],
    rationale: "A real one-word typo must be tolerated via trigram fuzzy matching (docs/SEARCH.md §3).",
  },

  // --- structured: a hard filter or a deterministic parsed phrase ---
  {
    id: "structured-language-filter-swedish",
    category: "structured",
    query: "",
    filters: { languages: ["sv"] },
    expectedAnyOf: ["Guess How Much I Love You"],
    mustNotInclude: ["The Gruffalo"],
    rationale:
      "Filtering to Swedish must include a book whose ADDITIONAL (not primary) language is Swedish, and exclude English-only books.",
  },
  {
    id: "structured-duration-filter-under-5",
    category: "structured",
    query: "",
    filters: { durations: ["under_5"] },
    expectedAnyOf: ["Amazing Animal Babies"],
    rationale: "A duration filter is a hard SQL constraint, not a ranking-only signal.",
  },
  {
    id: "structured-age-phrase",
    category: "structured",
    query: "a book for a 4 year old",
    // A pure age phrase with no other distinguishing text ties every age-appropriate
    // book at the same deterministic score (RANKING_WEIGHTS.ageIntent), so the
    // top-10 page is an alphabetical (sortTitle) slice of a large tied set — this is
    // the same tie-break behavior Phase 2-4 always had for an equally unspecific
    // query, not a regression. Checked against real, verified output, not tuned to
    // hide a bug: the actual regression this case exists to catch (age-appropriate
    // books with no literal keyword overlap with the query being unreachable as
    // candidates at all — see `buildIntentConditions` in searchRepository.ts) was a
    // real bug found via this exact case, fixed by adding an intent-candidate SQL
    // query, and is what "38 candidates found, many age-appropriate" verifies.
    expectedAnyOf: ["Alfie Atkins Wants to Choose", "Amazing Animal Babies", "Bestefars Båt"],
    rationale:
      "Deterministic age-phrase parsing (lib/search/intent.ts) must produce a real SQL candidate, not just a ranking bonus that never gets a chance to apply — regression case for a real bug where age-appropriate books with no literal keyword overlap with the query text were never retrieved as candidates at all.",
  },

  // --- exploratory: a descriptive, multi-word query with no exact keyword target ---
  {
    id: "exploratory-real-photos-of-animals",
    category: "exploratory",
    query: "animal books with real photos",
    expectedAnyOf: ["Amazing Animal Babies", "Bugs Up Close", "Ocean Wonders"],
    rationale:
      "Regression case for a real bug: plainto_tsquery's implicit AND returned zero results for this exact phrase; the OR-based tsquery fix (docs/SEARCH.md §3) must surface real photography books about animals.",
  },
  {
    id: "exploratory-bedtime-mood",
    category: "exploratory",
    query: "a calm bedtime story",
    expectedAnyOf: ["Goodnight Moon", "The Napping House", "Winter's Quiet Sleep"],
    rationale: "A mood/theme description, not a title or keyword, must still retrieve thematically relevant books.",
  },

  // --- safety/correctness: results that must never appear, or filters that must never leak ---
  {
    id: "safety-generic-filler-query-returns-nothing",
    category: "safety",
    query: "something to read please",
    expectedAnyOf: [],
    mustNotInclude: ["*"],
    rationale:
      "Regression case for a real bug: the boilerplate word 'read' incidentally matched every book via a structural label. A query built entirely from generic words must return zero results, never padded (docs/SEARCH.md §9).",
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
    id: "safety-incompatible-filter-combination",
    category: "safety",
    query: "",
    filters: { languages: ["sv"], durations: ["ten_plus"], visualRealism: ["real_photography"] },
    expectedAnyOf: [],
    mustNotInclude: ["*"],
    rationale: "An incompatible combination of real hard filters must return zero padded/approximate results.",
  },
];

export { EMPTY_FILTERS };
