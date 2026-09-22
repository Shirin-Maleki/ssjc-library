import { describe, expect, it } from "vitest";
import { hasPatchField, resolveProvenanceForPatch, type AdminMetadataPatch } from "@/lib/admin/adminPatch";

describe("admin/adminPatch — hasPatchField (presence, not truthiness)", () => {
  it("an omitted field is absent", () => {
    expect(hasPatchField<AdminMetadataPatch, "description">({}, "description")).toBe(false);
  });

  it("an explicit null is present", () => {
    expect(hasPatchField<AdminMetadataPatch, "description">({ description: null }, "description")).toBe(true);
  });

  it("a real value is present", () => {
    expect(hasPatchField<AdminMetadataPatch, "description">({ description: "x" }, "description")).toBe(true);
  });
});

describe("admin/adminPatch — resolveProvenanceForPatch", () => {
  it("an omitted field produces no provenance decision at all", () => {
    const decisions = resolveProvenanceForPatch({});
    expect(decisions).toEqual([]);
  });

  it("changing only description produces exactly one human_corrected decision for description", () => {
    const decisions = resolveProvenanceForPatch({ description: "A new description." });
    expect(decisions).toEqual([{ fieldKey: "description", sourceType: "human_corrected" }]);
  });

  it("explicitly clearing a nullable field (null) still produces a human_corrected decision — clearing is a correction, not a no-op", () => {
    const decisions = resolveProvenanceForPatch({ description: null });
    expect(decisions).toEqual([{ fieldKey: "description", sourceType: "human_corrected" }]);
  });

  it("changing both ageMinMonths and ageMaxMonths in one save produces ONE age_range decision, not two", () => {
    const decisions = resolveProvenanceForPatch({ ageMinMonths: 24, ageMaxMonths: 60 });
    expect(decisions).toEqual([{ fieldKey: "age_range", sourceType: "human_corrected" }]);
  });

  it("changing isbn10 or isbn13 both map to the single tracked isbn field", () => {
    expect(resolveProvenanceForPatch({ isbn10: "0000000000" })).toEqual([{ fieldKey: "isbn", sourceType: "human_corrected" }]);
    expect(resolveProvenanceForPatch({ isbn13: "0000000000000" })).toEqual([{ fieldKey: "isbn", sourceType: "human_corrected" }]);
  });

  it("changing category produces a human_corrected physical_category decision", () => {
    const decisions = resolveProvenanceForPatch({ physicalCategorySlug: "early-readers" });
    expect(decisions).toEqual([{ fieldKey: "physical_category", sourceType: "human_corrected" }]);
  });

  it("an explicitly verified field with no corresponding patch change becomes human_verified", () => {
    const decisions = resolveProvenanceForPatch({}, ["physical_category"]);
    expect(decisions).toEqual([{ fieldKey: "physical_category", sourceType: "human_verified" }]);
  });

  it("a field that is BOTH patched and listed as verified is recorded only as human_corrected — a change is never also a mere verification", () => {
    const decisions = resolveProvenanceForPatch({ physicalCategorySlug: "early-readers" }, ["physical_category"]);
    expect(decisions).toEqual([{ fieldKey: "physical_category", sourceType: "human_corrected" }]);
  });

  it("verifying one field never marks unrelated AI metadata as verified", () => {
    const decisions = resolveProvenanceForPatch({ description: "changed" }, ["physical_category"]);
    expect(decisions).toEqual(
      expect.arrayContaining([
        { fieldKey: "description", sourceType: "human_corrected" },
        { fieldKey: "physical_category", sourceType: "human_verified" },
      ])
    );
    expect(decisions).toHaveLength(2);
    expect(decisions.some((d) => d.fieldKey === "fiction_status")).toBe(false);
    expect(decisions.some((d) => d.fieldKey === "age_range")).toBe(false);
  });

  it("untouched, unverified fields never appear in the decision list at all", () => {
    const decisions = resolveProvenanceForPatch({ description: "changed" });
    expect(decisions).toHaveLength(1);
  });
});
