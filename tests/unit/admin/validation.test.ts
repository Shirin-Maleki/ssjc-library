import { describe, expect, it } from "vitest";
import { validateAdminMetadataPatch, validateApprovalEdits, validateCategoryInput, validateTaxonomyLabel } from "@/lib/admin/validation";

describe("admin/validation — validateAdminMetadataPatch", () => {
  const existing = { ageMinMonths: 24, ageMaxMonths: 60 };

  it("accepts an empty patch (nothing to validate)", () => {
    expect(validateAdminMetadataPatch({}, existing)).toBeUndefined();
  });

  it("rejects explicitly clearing the title — a required field can never be cleared", () => {
    const result = validateAdminMetadataPatch({ title: null }, existing);
    expect(result?.ok).toBe(false);
    expect(result?.message).toMatch(/title/i);
  });

  it("rejects a whitespace-only title as equivalent to clearing it", () => {
    const result = validateAdminMetadataPatch({ title: "   " }, existing);
    expect(result?.ok).toBe(false);
  });

  it("accepts a real title change", () => {
    expect(validateAdminMetadataPatch({ title: "A New Title" }, existing)).toBeUndefined();
  });

  it("rejects explicitly clearing the language — a required field can never be cleared", () => {
    const result = validateAdminMetadataPatch({ languageCode: null }, existing);
    expect(result?.ok).toBe(false);
    expect(result?.message).toMatch(/language/i);
  });

  it("rejects an unrecognized language code", () => {
    const result = validateAdminMetadataPatch({ languageCode: "not-a-language" }, existing);
    expect(result?.ok).toBe(false);
    expect(result?.message).toMatch(/language/i);
  });

  it("accepts a real, recognized language code", () => {
    expect(validateAdminMetadataPatch({ languageCode: "sv" }, existing)).toBeUndefined();
  });

  it("rejects an age outside 0-216 months", () => {
    expect(validateAdminMetadataPatch({ ageMinMonths: -1 }, existing)?.ok).toBe(false);
    expect(validateAdminMetadataPatch({ ageMaxMonths: 217 }, existing)?.ok).toBe(false);
  });

  it("rejects a non-integer age", () => {
    expect(validateAdminMetadataPatch({ ageMinMonths: 24.5 }, existing)?.ok).toBe(false);
  });

  it("rejects age min greater than age max after merging the patch with existing values", () => {
    // existing max is 60; patching min to 61 alone must fail against it.
    const result = validateAdminMetadataPatch({ ageMinMonths: 61 }, existing);
    expect(result?.ok).toBe(false);
    expect(result?.message).toMatch(/age from cannot be greater/i);
  });

  it("accepts a valid age range change (both bounds updated together)", () => {
    expect(validateAdminMetadataPatch({ ageMinMonths: 36, ageMaxMonths: 72 }, existing)).toBeUndefined();
  });

  it("allows a genuinely nullable field to be explicitly cleared", () => {
    expect(validateAdminMetadataPatch({ description: null }, existing)).toBeUndefined();
    expect(validateAdminMetadataPatch({ ageMinMonths: null, ageMaxMonths: null }, existing)).toBeUndefined();
    expect(validateAdminMetadataPatch({ format: null }, existing)).toBeUndefined();
    expect(validateAdminMetadataPatch({ fictionType: null }, existing)).toBeUndefined();
  });

  it("rejects an unrecognized format/fiction/visual-realism value", () => {
    expect(validateAdminMetadataPatch({ format: "novel" as never }, existing)?.ok).toBe(false);
    expect(validateAdminMetadataPatch({ fictionType: "maybe" as never }, existing)?.ok).toBe(false);
    expect(validateAdminMetadataPatch({ visualRealism: "surreal" as never }, existing)?.ok).toBe(false);
  });

  it("rejects a visualMediaTypes array containing an unrecognized value", () => {
    const result = validateAdminMetadataPatch({ visualMediaTypes: ["watercolor", "not-a-style"] as never }, existing);
    expect(result?.ok).toBe(false);
  });

  it("rejects a negative or unreasonable read-aloud minutes value", () => {
    expect(validateAdminMetadataPatch({ readAloudMinutes: -5 }, existing)?.ok).toBe(false);
    expect(validateAdminMetadataPatch({ readAloudMinutes: 5000 }, existing)?.ok).toBe(false);
  });

  it("rejects empty-string entries in authors/illustrators/tags arrays", () => {
    expect(validateAdminMetadataPatch({ authors: ["Real Name", "  "] }, existing)?.ok).toBe(false);
    expect(validateAdminMetadataPatch({ illustrators: [""] }, existing)?.ok).toBe(false);
    expect(validateAdminMetadataPatch({ tags: ["ok", ""] }, existing)?.ok).toBe(false);
  });

  it("accepts clearing physicalCategorySlug is treated as invalid at this layer too (never silently ignored)", () => {
    // Empty-string category is rejected; null category is caught by the
    // persistence layer's own "category is required" check, but this
    // validator still treats a blank non-null string as invalid input.
    const result = validateAdminMetadataPatch({ physicalCategorySlug: "" }, existing);
    expect(result?.ok).toBe(false);
  });
});

describe("admin/validation — validateApprovalEdits", () => {
  it("accepts empty edits", () => {
    expect(validateApprovalEdits({})).toBeUndefined();
  });

  it("rejects clearing title/language in a Review Later approval's edits, exactly like the general editor", () => {
    expect(validateApprovalEdits({ title: null })?.ok).toBe(false);
    expect(validateApprovalEdits({ languageCode: null })?.ok).toBe(false);
  });

  it("rejects an invalid language code in approval edits", () => {
    expect(validateApprovalEdits({ languageCode: "xx-not-real" })?.ok).toBe(false);
  });

  it("allows nullable fields (description, age, fiction, format) to be explicitly cleared", () => {
    expect(validateApprovalEdits({ description: null, fictionType: null, format: null, ageMinMonths: null, ageMaxMonths: null })).toBeUndefined();
  });
});

describe("admin/validation — validateCategoryInput", () => {
  it("rejects a blank label", () => {
    expect(validateCategoryInput({ label: "   " })?.ok).toBe(false);
  });

  it("accepts a real label", () => {
    expect(validateCategoryInput({ label: "Ocean Life" })).toBeUndefined();
  });

  it("rejects a negative or out-of-range display order", () => {
    expect(validateCategoryInput({ displayOrder: -1 })?.ok).toBe(false);
    expect(validateCategoryInput({ displayOrder: 1.5 })?.ok).toBe(false);
    expect(validateCategoryInput({ displayOrder: 99999 })?.ok).toBe(false);
  });

  it("accepts a reasonable display order", () => {
    expect(validateCategoryInput({ displayOrder: 3 })).toBeUndefined();
  });
});

describe("admin/validation — validateTaxonomyLabel", () => {
  it("rejects a blank label", () => {
    expect(validateTaxonomyLabel("   ")?.ok).toBe(false);
  });

  it("accepts a real label", () => {
    expect(validateTaxonomyLabel("Ocean Life")).toBeUndefined();
  });
});
