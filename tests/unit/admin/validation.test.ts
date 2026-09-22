import { describe, expect, it } from "vitest";
import {
  isValidDuplicateAction,
  isValidId,
  isValidReviewFlagOutcome,
  validateAdminMetadataPatch,
  validateApprovalEdits,
  validateCategoryInput,
  validateEffectiveAgeRange,
  validateTaxonomyLabel,
  validateVerifiedFieldKeys,
} from "@/lib/admin/validation";

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

// Final closure pass (§2) — runtime id/state/enum checks for every remaining
// admin Server Action boundary. These are plain predicates/validators, not a
// framework: each one is the single guard `persistence.ts` runs before a raw
// value would otherwise reach a Postgres `uuid`/enum comparison.
describe("admin/validation — isValidId", () => {
  it("accepts a well-formed UUID", () => {
    expect(isValidId("3fa85f64-5717-4562-b3fc-2c963f66afa6")).toBe(true);
  });

  it("rejects a malformed id rather than letting it reach a uuid column comparison", () => {
    expect(isValidId("not-a-uuid")).toBe(false);
    expect(isValidId("")).toBe(false);
    expect(isValidId("12345")).toBe(false);
    expect(isValidId("'; drop table books; --")).toBe(false);
  });
});

describe("admin/validation — isValidDuplicateAction", () => {
  it("accepts every one of the five supported duplicate outcomes", () => {
    for (const action of ["same_edition", "different_edition", "different_language", "false_match", "unresolved"]) {
      expect(isValidDuplicateAction(action)).toBe(true);
    }
  });

  it("rejects an arbitrary/malformed action", () => {
    expect(isValidDuplicateAction("delete_everything")).toBe(false);
    expect(isValidDuplicateAction("")).toBe(false);
  });
});

describe("admin/validation — isValidReviewFlagOutcome", () => {
  it("accepts resolved and dismissed", () => {
    expect(isValidReviewFlagOutcome("resolved")).toBe(true);
    expect(isValidReviewFlagOutcome("dismissed")).toBe(true);
  });

  it("rejects any other outcome", () => {
    expect(isValidReviewFlagOutcome("approved")).toBe(false);
    expect(isValidReviewFlagOutcome("")).toBe(false);
  });
});

describe("admin/validation — validateVerifiedFieldKeys", () => {
  it("accepts registered metadata field keys", () => {
    expect(validateVerifiedFieldKeys(["physical_category", "visual_media_type"])).toBeUndefined();
  });

  it("accepts an empty list", () => {
    expect(validateVerifiedFieldKeys([])).toBeUndefined();
  });

  it("rejects an unregistered/arbitrary field key", () => {
    const result = validateVerifiedFieldKeys(["physical_category", "not_a_real_field"]);
    expect(result?.ok).toBe(false);
  });
});

describe("admin/validation — validateEffectiveAgeRange", () => {
  it("accepts a valid effective range", () => {
    expect(validateEffectiveAgeRange(24, 60)).toBeUndefined();
  });

  it("accepts either bound being null (open-ended)", () => {
    expect(validateEffectiveAgeRange(null, 60)).toBeUndefined();
    expect(validateEffectiveAgeRange(24, null)).toBeUndefined();
    expect(validateEffectiveAgeRange(null, null)).toBeUndefined();
  });

  it("rejects an effective minimum greater than the effective maximum — the exact Review Later scenario where the admin only touches one bound", () => {
    // Persisted/AI age max is 48; admin raises only the minimum to 60.
    const result = validateEffectiveAgeRange(60, 48);
    expect(result?.ok).toBe(false);
    expect(result?.message).toMatch(/age from cannot be greater/i);
  });

  it("rejects an out-of-range effective bound", () => {
    expect(validateEffectiveAgeRange(-1, 60)?.ok).toBe(false);
    expect(validateEffectiveAgeRange(24, 217)?.ok).toBe(false);
  });
});
