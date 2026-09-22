import { describe, expect, it } from "vitest";
import { mergeProviderSubjectsIntoTags } from "@/lib/intake/enrichmentMerge";
import { EnrichmentSuggestionSchema, MAX_ENRICHMENT_TAGS } from "@/lib/ai/schemas";

describe("intake/enrichmentMerge — mergeProviderSubjectsIntoTags (AI-first catalog draft correction §4/§13)", () => {
  it("merges new provider subjects into the AI tag list", () => {
    const result = mergeProviderSubjectsIntoTags(["forest", "mice"], ["Fairy tales", "Adventure"]);
    expect(result).toEqual(["forest", "mice", "Fairy tales", "Adventure"]);
  });

  it("de-duplicates case-insensitively — a provider subject already present as an AI tag is not added again", () => {
    const result = mergeProviderSubjectsIntoTags(["Forest", "mice"], ["forest", "Adventure"]);
    expect(result).toEqual(["Forest", "mice", "Adventure"]);
  });

  it("suggestions survive metadata reconciliation: AI tags are never wiped, only ever added to", () => {
    const aiTags = ["clever-character", "read-aloud"];
    const result = mergeProviderSubjectsIntoTags(aiTags, ["Juvenile fiction"]);
    expect(result).toEqual(expect.arrayContaining(aiTags));
    expect(result.length).toBeGreaterThan(aiTags.length);
  });

  it("returns the AI tags unchanged (same values) when there are no provider subjects", () => {
    const aiTags = ["forest", "mice"];
    expect(mergeProviderSubjectsIntoTags(aiTags, undefined)).toEqual(aiTags);
    expect(mergeProviderSubjectsIntoTags(aiTags, [])).toEqual(aiTags);
  });

  it("trims whitespace and skips empty/whitespace-only subjects", () => {
    const result = mergeProviderSubjectsIntoTags(["forest"], ["  Adventure  ", "   ", ""]);
    expect(result).toEqual(["forest", "Adventure"]);
  });

  describe("tag-merge schema mismatch fix — the cap is exactly MAX_ENRICHMENT_TAGS (8), matching EnrichmentSuggestionSchema", () => {
    it("(A) 2 AI tags + many provider subjects → merged result never exceeds 8", () => {
      const manySubjects = Array.from({ length: 20 }, (_, i) => `subject-${i}`);
      const result = mergeProviderSubjectsIntoTags(["a", "b"], manySubjects);
      expect(result.length).toBe(MAX_ENRICHMENT_TAGS);
      expect(result.length).toBeLessThanOrEqual(8);
      // The two original AI tags are preserved first, in order, never displaced.
      expect(result[0]).toBe("a");
      expect(result[1]).toBe("b");
    });

    it("(B) 8 AI tags + provider subjects → the AI's 8 tags are returned unchanged, zero provider subjects added", () => {
      const aiTags = ["t1", "t2", "t3", "t4", "t5", "t6", "t7", "t8"];
      const result = mergeProviderSubjectsIntoTags(aiTags, ["new-subject-1", "new-subject-2"]);
      expect(result).toEqual(aiTags);
      expect(result.length).toBe(8);
    });

    it("(C) 7 AI tags + a duplicate provider subject + multiple new subjects → exactly one new unique provider subject is added", () => {
      const aiTags = ["t1", "t2", "t3", "t4", "t5", "t6", "t7"];
      const result = mergeProviderSubjectsIntoTags(aiTags, ["T1", "new-subject-a", "new-subject-b"]);
      expect(result).toEqual([...aiTags, "new-subject-a"]);
      expect(result.length).toBe(8);
    });

    it("(D) the merged result validates successfully against the real EnrichmentSuggestionSchema", () => {
      const aiTags = ["a", "b", "c"];
      const manySubjects = Array.from({ length: 15 }, (_, i) => `subject-${i}`);
      const mergedTags = mergeProviderSubjectsIntoTags(aiTags, manySubjects);

      const candidate = {
        description: "A test description.",
        tags: mergedTags,
        fictionType: "fiction" as const,
        format: "picture_book" as const,
        ageMinMonths: 36,
        ageMaxMonths: 72,
        readAloudMinutes: 5,
        visualMediaTypes: [] as const,
        visualRealism: null,
        physicalCategorySlug: "picture-books",
        categoryConfidence: "high" as const,
        categoryReason: "test",
      };

      const result = EnrichmentSuggestionSchema.safeParse(candidate);
      expect(result.success).toBe(true);
    });
  });
});
