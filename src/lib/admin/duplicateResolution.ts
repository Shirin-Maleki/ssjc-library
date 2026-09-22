/**
 * The narrow duplicate-resolution decision logic for pending Phase 7 intake (Phase
 * 8, §12/§13/§14) — deliberately NOT a general "merge arbitrary book A into
 * arbitrary book B" engine. This module only decides, for one of five approved
 * outcomes, what should structurally happen: which `duplicate_relationship_type`
 * to record (if any), whether an existing pending placeholder book gets archived
 * (never hard-deleted, never merged field-by-field), and whether the
 * photographed/pending record finalizes as its own active bibliographic record.
 * `src/lib/admin/persistence.ts` is the transactional DB layer that actually
 * carries this plan out.
 */

export type DuplicateResolutionAction = "same_edition" | "different_edition" | "different_language" | "false_match" | "unresolved";

export type DuplicateRelationshipType =
  | "exact_copy_same_edition"
  | "same_title_different_edition"
  | "same_work_different_language"
  | "false_match"
  | "unresolved";

export interface DuplicateResolutionPlan {
  relationshipType: DuplicateRelationshipType;
  /**
   * SAME EDITION only, and only when a Phase 7 `pending_review` placeholder book
   * exists for this intake — the placeholder is archived (never hard-deleted,
   * never a destructive field-by-field merge into the canonical book), its review
   * flags resolved, and a new `book_copies` row attaches to the EXISTING canonical
   * book instead. No useful Drive/intake evidence is lost — the ingestion item's
   * own draft/source reference is untouched by archiving the placeholder.
   */
  archivePendingPlaceholder: boolean;
  /** Whether the photographed/pending record becomes its own real, active
   * bibliographic record as a result of this decision (different edition/language,
   * false match) — never true for `same_edition` (no second active record is ever
   * created/kept) or `unresolved` (nothing is finalized yet). */
  finalizeAsActive: boolean;
  /**
   * Whether a `book_duplicates` relationship row is meaningful here — only when
   * TWO real bibliographic records end up existing side by side (different
   * edition/language, false match against a real existing book). `same_edition`
   * results in only ONE canonical book surviving, so a relationship row would be a
   * nonsensical self-relation (§14) — that decision is preserved through the audit
   * log and ingestion history instead, never a fabricated pending book solely to
   * have two ids to relate.
   */
  createDuplicateRelationshipRow: boolean;
}

const PLANS: Record<DuplicateResolutionAction, DuplicateResolutionPlan> = {
  same_edition: {
    relationshipType: "exact_copy_same_edition",
    archivePendingPlaceholder: true,
    finalizeAsActive: false,
    createDuplicateRelationshipRow: false,
  },
  different_edition: {
    relationshipType: "same_title_different_edition",
    archivePendingPlaceholder: false,
    finalizeAsActive: true,
    createDuplicateRelationshipRow: true,
  },
  different_language: {
    relationshipType: "same_work_different_language",
    archivePendingPlaceholder: false,
    finalizeAsActive: true,
    createDuplicateRelationshipRow: true,
  },
  false_match: {
    relationshipType: "false_match",
    archivePendingPlaceholder: false,
    finalizeAsActive: true,
    createDuplicateRelationshipRow: true,
  },
  unresolved: {
    relationshipType: "unresolved",
    archivePendingPlaceholder: false,
    finalizeAsActive: false,
    createDuplicateRelationshipRow: false,
  },
};

/**
 * `hasPendingPlaceholder` only affects the `same_edition` plan (whether there is
 * anything to archive at all — an ingestion-only Review Later item with no book row
 * yet has nothing to archive, just an ingestion item to complete). Every other
 * action's plan is fixed regardless of whether a placeholder exists.
 */
export function planDuplicateResolution(action: DuplicateResolutionAction, hasPendingPlaceholder: boolean): DuplicateResolutionPlan {
  const plan = PLANS[action];
  if (action === "same_edition" && !hasPendingPlaceholder) {
    return { ...plan, archivePendingPlaceholder: false };
  }
  return plan;
}
