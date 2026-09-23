import { describe, expect, it } from "vitest";
import { projectCostFromObservedUsage, GEMINI_FLASH_PRICING_USD_PER_MILLION_TOKENS } from "@/lib/bulkImport/pricing";

describe("bulkImport/pricing — projectCostFromObservedUsage", () => {
  it("returns undefined when there are no real observed samples, rather than fabricating a zero-cost projection", () => {
    expect(projectCostFromObservedUsage([])).toBeUndefined();
  });

  it("computes a real per-item average and projects it linearly to 100 and ~1,500 images", () => {
    const projection = projectCostFromObservedUsage([
      { promptTokens: 1000, candidateTokens: 200 },
      { promptTokens: 2000, candidateTokens: 400 },
    ]);
    expect(projection).toBeDefined();
    expect(projection!.sampleCount).toBe(2);
    expect(projection!.averagePromptTokensPerItem).toBe(1500);
    expect(projection!.averageCandidateTokensPerItem).toBe(300);

    const { inputPerMillion, outputPerMillion } = GEMINI_FLASH_PRICING_USD_PER_MILLION_TOKENS;
    const expectedPerItem = (1500 / 1_000_000) * inputPerMillion + (300 / 1_000_000) * outputPerMillion;
    expect(projection!.averageCostPerItemUsd).toBeCloseTo(expectedPerItem, 10);
    expect(projection!.projected100ImagesUsd).toBeCloseTo(expectedPerItem * 100, 10);
    expect(projection!.projected1500ImagesUsd).toBeCloseTo(expectedPerItem * 1500, 10);
  });

  it("labels the projection with the pricing-checked date, never leaving it implicit", () => {
    const projection = projectCostFromObservedUsage([{ promptTokens: 500, candidateTokens: 100 }]);
    expect(projection!.pricingCheckedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
