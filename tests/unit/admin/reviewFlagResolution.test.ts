import { describe, expect, it } from "vitest";
import { FLAG_TYPES_RESOLVED_BY_REVIEW_LATER_APPROVAL, FLAG_TYPES_RESOLVED_BY_SAME_EDITION_DUPLICATE } from "@/lib/admin/reviewFlagResolution";

describe("admin/reviewFlagResolution", () => {
  it("Review Later approval resolves identity/category/duplicate concerns, never unrelated metadata concerns", () => {
    expect(FLAG_TYPES_RESOLVED_BY_REVIEW_LATER_APPROVAL).toContain("low_identification_confidence");
    expect(FLAG_TYPES_RESOLVED_BY_REVIEW_LATER_APPROVAL).toContain("teacher_requested_review");
    expect(FLAG_TYPES_RESOLVED_BY_REVIEW_LATER_APPROVAL).toContain("category_uncertain");
    expect(FLAG_TYPES_RESOLVED_BY_REVIEW_LATER_APPROVAL).toContain("duplicate_uncertain");
    expect(FLAG_TYPES_RESOLVED_BY_REVIEW_LATER_APPROVAL).not.toContain("missing_metadata");
    expect(FLAG_TYPES_RESOLVED_BY_REVIEW_LATER_APPROVAL).not.toContain("metadata_conflict");
    expect(FLAG_TYPES_RESOLVED_BY_REVIEW_LATER_APPROVAL).not.toContain("user_flagged");
    expect(FLAG_TYPES_RESOLVED_BY_REVIEW_LATER_APPROVAL).not.toContain("import_error");
    expect(FLAG_TYPES_RESOLVED_BY_REVIEW_LATER_APPROVAL).not.toContain("visual_style_uncertain");
  });

  it("same-edition duplicate resolution never resolves category concerns — the placeholder is archived, not re-categorized", () => {
    expect(FLAG_TYPES_RESOLVED_BY_SAME_EDITION_DUPLICATE).toContain("duplicate_uncertain");
    expect(FLAG_TYPES_RESOLVED_BY_SAME_EDITION_DUPLICATE).toContain("low_identification_confidence");
    expect(FLAG_TYPES_RESOLVED_BY_SAME_EDITION_DUPLICATE).not.toContain("category_uncertain");
    expect(FLAG_TYPES_RESOLVED_BY_SAME_EDITION_DUPLICATE).not.toContain("missing_metadata");
    expect(FLAG_TYPES_RESOLVED_BY_SAME_EDITION_DUPLICATE).not.toContain("metadata_conflict");
  });
});
