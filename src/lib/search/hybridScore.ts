import type { Book } from "@/lib/catalog/types";
import type { CandidateSignals } from "@/db/repositories/searchRepository";
import { scoreBook, type MatchReason, type ScoredBook } from "./rank";
import { MINIMUM_MEANINGFUL_SCORE, RETRIEVAL_SIGNAL_WEIGHTS } from "./rankingConfig";

/** A cosine distance this high or greater contributes nothing — without a ceiling,
 * a barely-related book would still add a small positive number and could nudge a
 * zero-deterministic-signal book above the meaningful-result threshold on pure
 * noise. Real matches in practice score well under 1. */
const MAX_MEANINGFUL_VECTOR_DISTANCE = 1;

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
