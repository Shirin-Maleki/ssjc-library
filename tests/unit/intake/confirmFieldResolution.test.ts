import { describe, expect, it } from "vitest";
import { hasEditField, resolveConfirmFields } from "@/lib/intake/confirmFieldResolution";
import type { EnrichmentSuggestion, CoverIdentification } from "@/lib/ai/schemas";
import type { TeacherEdits } from "@/lib/intake/draft";

const AI_SUGGESTION: EnrichmentSuggestion = {
  description: "A mouse invents a fearsome creature to scare off forest predators.",
  tags: ["forest", "clever-mouse"],
  fictionType: "fiction",
  format: "picture_book",
  ageMinMonths: 36,
  ageMaxMonths: 72,
  readAloudMinutes: 8,
  visualMediaTypes: ["digital_illustration"],
  visualRealism: "stylized_illustration",
  physicalCategorySlug: "picture-books",
  categoryConfidence: "high",
  categoryReason: "Clearly a picture book.",
};

const COVER_EVIDENCE: CoverIdentification = {
  visibleTitle: "The Gruffalo",
  visibleSubtitle: null,
  visibleAuthors: ["Julia Donaldson"],
  visibleIllustrators: null,
  visiblePublisherOrImprint: null,
  visibleLanguage: "English",
  visibleIsbn: null,
  visibleSeries: null,
  candidateSearchTerms: [],
  identityConfidenceLevel: "high",
  evidenceNotes: "",
};

const CATEGORY_SUGGESTION = { slug: "picture-books", label: "Picture Books", confidence: "high" as const, reason: "Clearly a picture book." };

function baseInput(overrides: Partial<Parameters<typeof resolveConfirmFields>[0]> = {}) {
  return {
    edits: undefined,
    proposedTitle: "The Gruffalo",
    proposedLanguageCode: "en",
    proposedAuthors: ["Julia Donaldson"],
    fallbackCategorySlug: "picture-books",
    enrichment: AI_SUGGESTION,
    coverEvidence: COVER_EVIDENCE,
    categorySuggestion: CATEGORY_SUGGESTION,
    ...overrides,
  };
}

describe("intake/confirmFieldResolution — hasEditField", () => {
  it("returns false when edits is undefined", () => {
    expect(hasEditField<TeacherEdits, "fictionType">(undefined, "fictionType")).toBe(false);
  });

  it("returns false when the key is genuinely absent from edits", () => {
    expect(hasEditField<TeacherEdits, "fictionType">({ description: "x" }, "fictionType")).toBe(false);
  });

  it("returns true when the key is present with a real value", () => {
    expect(hasEditField<TeacherEdits, "fictionType">({ fictionType: "fiction" }, "fictionType")).toBe(true);
  });

  it("returns true when the key is present with value null — the core distinction plain ?? cannot make", () => {
    expect(hasEditField<TeacherEdits, "fictionType">({ fictionType: null }, "fictionType")).toBe(true);
  });
});

describe("intake/confirmFieldResolution — resolveConfirmFields (AI draft human-correction semantics, final round §1/§2/§3)", () => {
  it("(A/B) no edits at all: every AI-suggested field is used as-is with ai_inferred/cover_visible provenance, nothing human_corrected", () => {
    const result = resolveConfirmFields(baseInput({ edits: undefined }));
    expect(result.description).toBe(AI_SUGGESTION.description);
    expect(result.fictionType).toBe("fiction");
    expect(result.format).toBe("picture_book");
    expect(result.ageMinMonths).toBe(36);
    expect(result.ageMaxMonths).toBe(72);
    expect(result.categorySlug).toBe("picture-books");
    expect(result.provenance).toEqual(
      expect.arrayContaining([
        { fieldKey: "title", sourceType: "cover_visible", confidenceLevel: "high" },
        { fieldKey: "physical_category", sourceType: "ai_inferred", confidenceLevel: "high" },
        { fieldKey: "description", sourceType: "ai_inferred" },
        { fieldKey: "fiction_status", sourceType: "ai_inferred" },
        { fieldKey: "format", sourceType: "ai_inferred" },
        { fieldKey: "age_range", sourceType: "ai_inferred" },
      ])
    );
    expect(result.provenance.some((p) => p.sourceType === "human_corrected" || p.sourceType === "human_verified")).toBe(false);
  });

  it("(A) editing only description leaves category/age/fiction/format resolved from AI values with ai_inferred provenance, and does not mark them human-corrected", () => {
    const result = resolveConfirmFields(baseInput({ edits: { description: "A teacher-edited description." } }));
    expect(result.description).toBe("A teacher-edited description.");
    expect(result.fictionType).toBe("fiction");
    expect(result.format).toBe("picture_book");
    expect(result.ageMinMonths).toBe(36);
    expect(result.ageMaxMonths).toBe(72);
    expect(result.categorySlug).toBe("picture-books");

    const byField = Object.fromEntries(result.provenance.map((p) => [p.fieldKey, p.sourceType]));
    expect(byField.description).toBe("human_corrected");
    expect(byField.fiction_status).toBe("ai_inferred");
    expect(byField.format).toBe("ai_inferred");
    expect(byField.age_range).toBe("ai_inferred");
    expect(byField.physical_category).toBe("ai_inferred");
  });

  it("(C) fictionType explicitly cleared to null resolves to null/undefined, never falls back to the AI value, and is marked human_corrected", () => {
    const result = resolveConfirmFields(baseInput({ edits: { fictionType: null } }));
    expect(result.fictionType).toBeUndefined(); // null -> undefined for the save call (never "fiction")
    const byField = Object.fromEntries(result.provenance.map((p) => [p.fieldKey, p.sourceType]));
    expect(byField.fiction_status).toBe("human_corrected");
    // Untouched fields are unaffected.
    expect(result.format).toBe("picture_book");
    expect(byField.format).toBe("ai_inferred");
  });

  it("(D) age range explicitly cleared to null on both bounds never falls back to the AI age, and is marked human_corrected", () => {
    const result = resolveConfirmFields(baseInput({ edits: { ageMinMonths: null, ageMaxMonths: null } }));
    expect(result.ageMinMonths).toBeUndefined();
    expect(result.ageMaxMonths).toBeUndefined();
    const byField = Object.fromEntries(result.provenance.map((p) => [p.fieldKey, p.sourceType]));
    expect(byField.age_range).toBe("human_corrected");
  });

  it("(E) description explicitly cleared to null never falls back to the AI description, and is marked human_corrected", () => {
    const result = resolveConfirmFields(baseInput({ edits: { description: null } }));
    expect(result.description).toBeUndefined();
    const byField = Object.fromEntries(result.provenance.map((p) => [p.fieldKey, p.sourceType]));
    expect(byField.description).toBe("human_corrected");
  });

  it("(F) physical category explicitly cleared to null resolves to null — the caller (confirmSaveAction) is what turns this into the required-category error, never silently restoring the AI category", () => {
    const result = resolveConfirmFields(baseInput({ edits: { physicalCategorySlug: null } }));
    expect(result.categorySlug).toBeNull();
    const byField = Object.fromEntries(result.provenance.map((p) => [p.fieldKey, p.sourceType]));
    expect(byField.physical_category).toBe("human_verified");
  });

  it("a genuinely different category choice is marked human_verified, not human_corrected", () => {
    const result = resolveConfirmFields(baseInput({ edits: { physicalCategorySlug: "early-readers" } }));
    expect(result.categorySlug).toBe("early-readers");
    const byField = Object.fromEntries(result.provenance.map((p) => [p.fieldKey, p.sourceType]));
    expect(byField.physical_category).toBe("human_verified");
  });

  it("title edited: human_corrected, never cover_visible", () => {
    const result = resolveConfirmFields(baseInput({ edits: { title: "A New Title" } }));
    expect(result.title).toBe("A New Title");
    const byField = Object.fromEntries(result.provenance.map((p) => [p.fieldKey, p.sourceType]));
    expect(byField.title).toBe("human_corrected");
  });

  it("no AI suggestion exists at all (enrichment null): untouched fields resolve to undefined with no ai_inferred provenance rows", () => {
    const result = resolveConfirmFields(baseInput({ enrichment: null, categorySuggestion: null, edits: undefined }));
    expect(result.description).toBeUndefined();
    expect(result.fictionType).toBeUndefined();
    expect(result.format).toBeUndefined();
    expect(result.ageMinMonths).toBeUndefined();
    expect(result.ageMaxMonths).toBeUndefined();
    expect(result.provenance.some((p) => p.fieldKey === "description")).toBe(false);
    expect(result.provenance.some((p) => p.fieldKey === "fiction_status")).toBe(false);
    expect(result.provenance.some((p) => p.fieldKey === "physical_category")).toBe(false);
  });
});
