import { reviewFlagTypeEnum } from "@/db/schema";

/**
 * §26 of the phase brief — "Conservative automation policy": bulk import must
 * never guess harder merely because no teacher is present to make the final
 * call. Pure and dependency-free (no DB, no session, no provider call) so this
 * gate is directly, exhaustively unit-testable — mirrors
 * `candidateAcceptance.ts`'s identity-safety gate and `duplicateResolution.ts`'s
 * pure decision table, the established pattern for "a decision this important
 * gets its own testable function, not an inline branch in the orchestrator."
 *
 * Deliberately built ONLY from signals the existing Phase 7 pipeline already
 * produces (cover identification confidence, reconciliation outcome, duplicate
 * outcome, category-suggestion validity/confidence) — it does not invent new
 * Gemini-detected signals (e.g. "multiple books visible," "this is a spine, not
 * a front cover") that would require changing `CoverIdentification`'s prompt/
 * schema, which is out of this phase's reuse-not-redesign scope. In practice
 * this is not as narrow as it sounds: a spine-only, multi-book, or genuinely
 * unreadable photograph overwhelmingly also fails to produce a confident,
 * usable single-book title from Gemini's existing identification call, so
 * `hasUsableIdentification: false` already catches most of those cases
 * honestly, rather than by name. This limitation is stated plainly in
 * `docs/BULK_IMPORT.md` rather than overclaimed.
 *
 * The five checks below run in a fixed, documented order and return on the
 * FIRST one that fails — an item can have multiple real problems at once, and
 * only the first-detected one is ever reported; Admin Review can surface
 * others once a human actually opens the item (`loadAdminReviewDetail` already
 * shows the full persisted draft, not just the one flag reason).
 */

type ReviewFlagType = (typeof reviewFlagTypeEnum.enumValues)[number];

export interface BulkCompletionGateInput {
  hasUsableIdentification: boolean;
  title: string | null;
  languageCode: string | null;
  reconciliationOutcome: "high_confidence" | "ambiguous" | "unresolved";
  duplicateOutcome: "no_match" | "exact_copy_same_edition" | "same_title_different_edition" | "same_work_different_language" | "ambiguous_similar_title";
  /** The already-validated (against real active categories) suggested slug, or
   * `null` when no suggestion survived validation — never a raw, unvalidated AI
   * string. */
  categorySlug: string | null;
  categoryConfidence: "high" | "medium" | "low" | null;
}

export type BulkCompletionDecision =
  | { outcome: "complete" }
  | { outcome: "needs_review"; flagType: ReviewFlagType; reason: string };

export function decideBulkCompletionGate(input: BulkCompletionGateInput): BulkCompletionDecision {
  if (!input.hasUsableIdentification || !input.title?.trim()) {
    return { outcome: "needs_review", flagType: "low_identification_confidence", reason: "The cover photograph could not be confidently identified — the title may be unreadable, the photo may not show a usable front cover, or more than one book may be visible." };
  }

  if (!input.languageCode) {
    return { outcome: "needs_review", flagType: "low_identification_confidence", reason: "A primary language could not be confidently determined for this book." };
  }

  if (input.reconciliationOutcome === "ambiguous") {
    return { outcome: "needs_review", flagType: "metadata_conflict", reason: "Multiple plausible bibliographic matches were found and none was confident enough to accept automatically." };
  }
  if (input.reconciliationOutcome === "unresolved") {
    return { outcome: "needs_review", flagType: "low_identification_confidence", reason: "No confidently matching bibliographic metadata was found for this title." };
  }

  if (input.duplicateOutcome !== "no_match") {
    return { outcome: "needs_review", flagType: "duplicate_uncertain", reason: "A possible duplicate of an existing catalog record was found and needs a human decision (same edition, different edition, different language, or a false match)." };
  }

  if (!input.categorySlug) {
    return { outcome: "needs_review", flagType: "category_uncertain", reason: "No confident shelving category suggestion was available for this book." };
  }
  if (input.categoryConfidence === "low") {
    return { outcome: "needs_review", flagType: "category_uncertain", reason: "The suggested shelving category had low confidence." };
  }

  return { outcome: "complete" };
}
