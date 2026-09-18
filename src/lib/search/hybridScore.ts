import type { Book } from "@/lib/catalog/types";
import type { CandidateSignals } from "@/db/repositories/searchRepository";
import { scoreBook, type MatchReason, type ScoredBook } from "./rank";
import { MINIMUM_MEANINGFUL_SCORE, RETRIEVAL_SIGNAL_WEIGHTS } from "./rankingConfig";

/**
 * A cosine distance this high or greater contributes nothing — without a real
 * ceiling, a barely-related book still adds a small positive number and clears
 * `MINIMUM_MEANINGFUL_SCORE` (0) on pure noise.
 *
 * Real-provider validation finding (2026-09-17, revised same day): the original
 * value here, `1`, was a placeholder that never gated anything in practice — see
 * docs/DECISIONS.md for that first finding (49/49 books "matched" a real
 * exploratory query in a live product check). An initial correction to `0.36` was
 * itself re-measured against a *known-item* query ("The Very Hungry Caterpillar")
 * with real embeddings for the full 49-book dev catalog, which exposed the same
 * failure mode from a different angle: 31 of 49 books — almost the entire
 * catalog, none thematically related — still cleared `0.36` and appeared as
 * semantic "matches" ahead of/alongside the correct exact-title result, visible
 * directly in a product screenshot ("35 matches" for a single-title lookup) and
 * confirmed in the evaluation harness's own top-3 for `known-item-exact-title`.
 *
 * Cross-referencing three distinct real queries' full distance distributions (a
 * known-item title, and two exploratory themes) showed the same shape every time:
 * a small number of genuinely strong matches at 0.17–0.28, then a dense,
 * near-universal "noise floor" starting around 0.30–0.32 that most of the catalog
 * falls into regardless of actual relevance — because short children's-book
 * descriptions embed into a tight region of this model's space at this catalog's
 * scale. `0.30` is chosen as the ceiling: it sits just below that noise floor and
 * excludes it, while an exploratory query's few genuinely strong hits survive.
 * This does trade away the *weakest* semantic-only hits for exploratory queries
 * that have no better catalog answer (e.g. a book with only a 0.32 distance and no
 * deterministic keyword/tag overlap will no longer surface) — an accepted
 * limitation, not a bug: exact/deterministic signals dominate ranking by design,
 * and a query's genuinely relevant results in this catalog have consistently
 * carried real deterministic overlap (category, tag, or description keyword) in
 * addition to a strong semantic score, so they are not lost by this tightening.
 * Not a perfect separator — see docs/DECISIONS.md for the full measurement and
 * why no single threshold fully resolves this at this embedding model and catalog
 * scale.
 */
const MAX_MEANINGFUL_VECTOR_DISTANCE = 0.3;

/**
 * Combines the existing deterministic free-text/intent score (`scoreBook`,
 * unchanged from Phase 2–4) with the Phase 5 SQL-retrieval signals — full-text
 * rank, trigram similarity, semantic similarity, and the retrieval layer's own
 * "exact match" flag (docs/SEARCH.md §9). Every component is named and independently
 * inspectable; nothing here is an opaque blended number. Absence of a signal (no
 * embedding, not an FTS/trgm candidate) contributes exactly 0, never a fabricated
 * placeholder value.
 */
export function combineScores(book: Book, query: string, signals: CandidateSignals | undefined): ScoredBook {
  const deterministic = scoreBook(book, query);
  if (!signals) return deterministic;

  let score = deterministic.score;
  const reasons: MatchReason[] = [...deterministic.reasons];

  if (signals.exactMatch) {
    score += RETRIEVAL_SIGNAL_WEIGHTS.exactRetrievalMatch;
    reasons.push({ type: "exact_retrieval" });
  }
  if (signals.ftsRank > 0) {
    // ts_rank is small/unbounded above — clamp the multiplier's effect so an
    // unusually high rank still can't approach a real exact-match weight.
    score += Math.min(signals.ftsRank * RETRIEVAL_SIGNAL_WEIGHTS.fullTextRank * 3, RETRIEVAL_SIGNAL_WEIGHTS.fullTextRank);
  }
  if (signals.trgmSimilarity > 0) {
    score += signals.trgmSimilarity * RETRIEVAL_SIGNAL_WEIGHTS.trigramSimilarity;
    reasons.push({ type: "fuzzy_match" });
  }
  if (signals.vectorDistance != null && signals.vectorDistance < MAX_MEANINGFUL_VECTOR_DISTANCE) {
    const similarity = 1 - signals.vectorDistance;
    score += similarity * RETRIEVAL_SIGNAL_WEIGHTS.semanticSimilarity;
    reasons.push({ type: "semantic" });
  }

  return { book, score, reasons };
}

/**
 * Ranks a candidate set the same way `rankBooks` (rank.ts) always has — score
 * descending, deterministic alphabetical tie-break, below-threshold results
 * dropped entirely (never padded). The only difference from `rankBooks` is that
 * scores here already include the Phase 5 retrieval signals.
 */
export function rankScoredBooks(scored: ScoredBook[]): ScoredBook[] {
  return scored
    .filter((s) => s.score > MINIMUM_MEANINGFUL_SCORE)
    .sort((a, b) => b.score - a.score || a.book.sortTitle.localeCompare(b.book.sortTitle));
}
