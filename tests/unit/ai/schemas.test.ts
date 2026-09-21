import { describe, expect, it } from "vitest";
import {
  CoverIdentificationSchema,
  EnrichmentSuggestionSchema,
  CombinedCoverAnalysisSchema,
  EMPTY_AI_SUGGESTIONS,
} from "@/lib/ai/schemas";

/**
 * AI-first catalog draft correction (§2/§13) — proves the strict/inferential
 * boundary is enforced at the schema level, not just by convention: the strict
 * `coverEvidence` half of a combined response can never be populated from
 * speculative `aiSuggestions` fields, because the two are genuinely different
 * Zod object shapes with no overlapping keys for the fields that matter.
 */
describe("ai/schemas — the strict evidence / inferential suggestions boundary", () => {
  it("CoverIdentificationSchema has no speculative/inferential keys — a model could never smuggle a category, age, or fiction guess into strict evidence", () => {
    const evidenceKeys = Object.keys(CoverIdentificationSchema.shape);
    const inferentialOnlyKeys = ["physicalCategorySlug", "ageMinMonths", "ageMaxMonths", "fictionType", "format", "readAloudMinutes", "visualMediaTypes", "visualRealism"];
    for (const key of inferentialOnlyKeys) {
      expect(evidenceKeys).not.toContain(key);
    }
  });

  it("EnrichmentSuggestionSchema has no strict-only keys — it can never be mistaken for a bibliographic-fact object", () => {
    const suggestionKeys = Object.keys(EnrichmentSuggestionSchema.shape);
    const strictOnlyKeys = ["visibleIsbn", "visibleTitle", "visibleAuthors", "identityConfidenceLevel", "candidateSearchTerms"];
    for (const key of strictOnlyKeys) {
      expect(suggestionKeys).not.toContain(key);
    }
  });

  it("CombinedCoverAnalysisSchema validates a real-shaped payload with both sections present", () => {
    const result = CombinedCoverAnalysisSchema.safeParse({
      coverEvidence: {
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
      },
      aiSuggestions: {
        description: "A mouse invents a fearsome creature to scare off predators.",
        tags: ["forest"],
        fictionType: "fiction",
        format: "picture_book",
        ageMinMonths: 24,
        ageMaxMonths: 60,
        readAloudMinutes: 8,
        visualMediaTypes: [],
        visualRealism: null,
        physicalCategorySlug: "picture-books",
        categoryConfidence: "high",
        categoryReason: null,
      },
    });
    expect(result.success).toBe(true);
  });

  it("EMPTY_AI_SUGGESTIONS is itself a valid EnrichmentSuggestion — the salvage fallback never produces an invalid object", () => {
    expect(EnrichmentSuggestionSchema.safeParse(EMPTY_AI_SUGGESTIONS).success).toBe(true);
    expect(EMPTY_AI_SUGGESTIONS.tags).toEqual([]);
    expect(EMPTY_AI_SUGGESTIONS.physicalCategorySlug).toBeNull();
  });
});
