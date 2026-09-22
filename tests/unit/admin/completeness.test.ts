import { describe, expect, it } from "vitest";
import { computeMissingMetadataFields, describeMissingMetadata, type CompletenessInput } from "@/lib/admin/completeness";

function complete(overrides: Partial<CompletenessInput> = {}): CompletenessInput {
  return {
    hasContributors: true,
    hasDescription: true,
    hasAgeRange: true,
    hasFormat: true,
    hasVisualStyle: true,
    ...overrides,
  };
}

describe("admin/completeness — computeMissingMetadataFields", () => {
  it("returns an empty list when every field is present", () => {
    expect(computeMissingMetadataFields(complete())).toEqual([]);
  });

  it("returns every field when all are missing, in a fixed deterministic order", () => {
    const result = computeMissingMetadataFields(
      complete({ hasContributors: false, hasDescription: false, hasAgeRange: false, hasFormat: false, hasVisualStyle: false })
    );
    expect(result).toEqual(["contributors", "description", "age_range", "format", "visual_style"]);
  });

  it("returns exactly the missing fields — age range, format, and visual style", () => {
    const result = computeMissingMetadataFields(complete({ hasAgeRange: false, hasFormat: false, hasVisualStyle: false }));
    expect(result).toEqual(["age_range", "format", "visual_style"]);
  });
});

describe("admin/completeness — describeMissingMetadata", () => {
  it("returns null when nothing is missing", () => {
    expect(describeMissingMetadata([])).toBeNull();
  });

  it("formats a single missing field without a list separator", () => {
    expect(describeMissingMetadata(["description"])).toBe("Missing description");
  });

  it("formats two missing fields with 'and', no Oxford comma", () => {
    expect(describeMissingMetadata(["age_range", "format"])).toBe("Missing age range and format");
  });

  it("formats three or more missing fields with an Oxford comma, matching the phase brief's own example", () => {
    expect(describeMissingMetadata(["age_range", "format", "visual_style"])).toBe("Missing age range, format, and visual style");
  });

  it("never surfaces a raw field_key or opaque score, only plain labels", () => {
    const text = describeMissingMetadata(["contributors", "age_range"])!;
    expect(text).not.toMatch(/_/);
    expect(text).not.toMatch(/\d/);
  });
});
