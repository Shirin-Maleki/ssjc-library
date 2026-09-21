import { describe, expect, it } from "vitest";
import { mergeProviderSubjectsIntoTags } from "@/lib/intake/enrichmentMerge";

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

  it("caps the merged list at 10 tags, never an unbounded list from a subject-heavy provider record", () => {
    const manySubjects = Array.from({ length: 20 }, (_, i) => `subject-${i}`);
    const result = mergeProviderSubjectsIntoTags(["a", "b"], manySubjects);
    expect(result.length).toBeLessThanOrEqual(10);
  });

  it("trims whitespace and skips empty/whitespace-only subjects", () => {
    const result = mergeProviderSubjectsIntoTags(["forest"], ["  Adventure  ", "   ", ""]);
    expect(result).toEqual(["forest", "Adventure"]);
  });
});
