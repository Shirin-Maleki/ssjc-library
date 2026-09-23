import { describe, expect, it } from "vitest";
import { decideBulkCompletionGate, type BulkCompletionGateInput } from "@/lib/bulkImport/completionGate";

function baseInput(overrides: Partial<BulkCompletionGateInput> = {}): BulkCompletionGateInput {
  return {
    hasUsableIdentification: true,
    title: "A Real Book Title",
    languageCode: "en",
    reconciliationOutcome: "high_confidence",
    duplicateOutcome: "no_match",
    categorySlug: "stories-imagination",
    categoryConfidence: "high",
    ...overrides,
  };
}

describe("bulkImport/completionGate — decideBulkCompletionGate", () => {
  it("completes automatically when every signal is strong", () => {
    expect(decideBulkCompletionGate(baseInput())).toEqual({ outcome: "complete" });
  });

  it("routes to review when identification produced no usable title", () => {
    const result = decideBulkCompletionGate(baseInput({ hasUsableIdentification: false, title: null }));
    expect(result).toMatchObject({ outcome: "needs_review", flagType: "low_identification_confidence" });
  });

  it("routes to review when the title is present but blank/whitespace", () => {
    const result = decideBulkCompletionGate(baseInput({ title: "   " }));
    expect(result).toMatchObject({ outcome: "needs_review", flagType: "low_identification_confidence" });
  });

  it("routes to review when no language could be determined", () => {
    const result = decideBulkCompletionGate(baseInput({ languageCode: null }));
    expect(result).toMatchObject({ outcome: "needs_review", flagType: "low_identification_confidence" });
  });

  it("routes to review as metadata_conflict when reconciliation is ambiguous", () => {
    const result = decideBulkCompletionGate(baseInput({ reconciliationOutcome: "ambiguous" }));
    expect(result).toMatchObject({ outcome: "needs_review", flagType: "metadata_conflict" });
  });

  it("routes to review as low_identification_confidence when reconciliation is unresolved", () => {
    const result = decideBulkCompletionGate(baseInput({ reconciliationOutcome: "unresolved" }));
    expect(result).toMatchObject({ outcome: "needs_review", flagType: "low_identification_confidence" });
  });

  it("routes to review as duplicate_uncertain for every non-no_match duplicate outcome", () => {
    for (const outcome of ["exact_copy_same_edition", "same_title_different_edition", "same_work_different_language", "ambiguous_similar_title"] as const) {
      const result = decideBulkCompletionGate(baseInput({ duplicateOutcome: outcome }));
      expect(result).toMatchObject({ outcome: "needs_review", flagType: "duplicate_uncertain" });
    }
  });

  it("routes to review as category_uncertain when no category slug survived validation", () => {
    const result = decideBulkCompletionGate(baseInput({ categorySlug: null }));
    expect(result).toMatchObject({ outcome: "needs_review", flagType: "category_uncertain" });
  });

  it("routes to review as category_uncertain when the category suggestion had low confidence", () => {
    const result = decideBulkCompletionGate(baseInput({ categoryConfidence: "low" }));
    expect(result).toMatchObject({ outcome: "needs_review", flagType: "category_uncertain" });
  });

  it("allows a medium-confidence category to auto-complete, matching the interactive flow's own leniency", () => {
    expect(decideBulkCompletionGate(baseInput({ categoryConfidence: "medium" }))).toEqual({ outcome: "complete" });
  });

  it("checks identification before every other signal, even when multiple things are wrong at once", () => {
    const result = decideBulkCompletionGate(baseInput({ hasUsableIdentification: false, title: null, reconciliationOutcome: "unresolved", duplicateOutcome: "ambiguous_similar_title", categorySlug: null }));
    expect(result).toMatchObject({ flagType: "low_identification_confidence" });
  });
});
