import { describe, expect, it } from "vitest";
import { planDuplicateResolution } from "@/lib/admin/duplicateResolution";

describe("admin/duplicateResolution — planDuplicateResolution", () => {
  it("SAME EDITION with an existing pending placeholder: archives the placeholder, never finalizes a second active record, no relationship row", () => {
    const plan = planDuplicateResolution("same_edition", true);
    expect(plan.relationshipType).toBe("exact_copy_same_edition");
    expect(plan.archivePendingPlaceholder).toBe(true);
    expect(plan.finalizeAsActive).toBe(false);
    expect(plan.createDuplicateRelationshipRow).toBe(false);
  });

  it("SAME EDITION with no pending placeholder (ingestion-only item): nothing to archive", () => {
    const plan = planDuplicateResolution("same_edition", false);
    expect(plan.archivePendingPlaceholder).toBe(false);
    expect(plan.finalizeAsActive).toBe(false);
    expect(plan.createDuplicateRelationshipRow).toBe(false);
  });

  it("DIFFERENT EDITION: finalizes as its own active record and records the relationship", () => {
    const plan = planDuplicateResolution("different_edition", true);
    expect(plan.relationshipType).toBe("same_title_different_edition");
    expect(plan.finalizeAsActive).toBe(true);
    expect(plan.archivePendingPlaceholder).toBe(false);
    expect(plan.createDuplicateRelationshipRow).toBe(true);
  });

  it("DIFFERENT LANGUAGE: finalizes as its own active record and records the relationship", () => {
    const plan = planDuplicateResolution("different_language", true);
    expect(plan.relationshipType).toBe("same_work_different_language");
    expect(plan.finalizeAsActive).toBe(true);
    expect(plan.createDuplicateRelationshipRow).toBe(true);
  });

  it("FALSE MATCH: finalizes as distinct, records the rejected relationship, never merges", () => {
    const plan = planDuplicateResolution("false_match", true);
    expect(plan.relationshipType).toBe("false_match");
    expect(plan.finalizeAsActive).toBe(true);
    expect(plan.archivePendingPlaceholder).toBe(false);
    expect(plan.createDuplicateRelationshipRow).toBe(true);
  });

  it("UNRESOLVED: never finalizes, never archives, never creates a relationship row — stays pending", () => {
    const plan = planDuplicateResolution("unresolved", true);
    expect(plan.relationshipType).toBe("unresolved");
    expect(plan.finalizeAsActive).toBe(false);
    expect(plan.archivePendingPlaceholder).toBe(false);
    expect(plan.createDuplicateRelationshipRow).toBe(false);
  });
});
