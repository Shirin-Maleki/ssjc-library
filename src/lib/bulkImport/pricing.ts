/**
 * §35 of the phase brief — cost projection, kept in one small, easily-updatable
 * module rather than hardcoded deep in pipeline logic. Every number below is
 * from Google's own published Gemini API pricing page, checked live at
 * implementation time (2026-09-23) — not carried over from memory or an
 * earlier phase's numbers. Re-check `https://ai.google.dev/gemini-api/docs/pricing`
 * before trusting these for a real Phase 10 budget decision; Google's own page
 * already states the input/output rates below step up on 2027-01-01.
 */
export const GEMINI_PRICING_CHECKED_DATE = "2026-09-23";

export const GEMINI_FLASH_PRICING_USD_PER_MILLION_TOKENS = {
  /** `gemini-3.8-flash` (this project's configured vision/enrichment model),
   * standard paid tier, through 2026-12-31. Google's pricing page does not
   * separately itemize image-input token counting for this model — an image is
   * billed at this same per-token input rate, converted to tokens by Gemini's
   * own (undocumented-here) image tokenization, which is why this project
   * prefers a REAL observed per-call token count (`usageMetadata`, captured in
   * `src/lib/ai/geminiProvider.ts`) over a theoretical per-image token guess
   * wherever real validation data is available. */
  inputPerMillion: 0.75,
  outputPerMillion: 3.75,
  /** Rates step up on this date per Google's own pricing page — a Phase 10
   * budget estimate made after this date must re-check the current number. */
  rateChangeDate: "2027-01-01",
  inputPerMillionAfterChange: 1.5,
  outputPerMillionAfterChange: 7.5,
} as const;

export const GEMINI_EMBEDDING_PRICING_USD_PER_MILLION_TOKENS = {
  /** `gemini-embedding-2` (this project's configured embedding model), text
   * input, standard paid tier. */
  textInputPerMillion: 0.2,
} as const;

/** Google's free tier for both models above is "free of charge" for the
 * limited daily quota this project has already directly observed and recorded
 * in `docs/COSTS.md` (20 real `gemini-3.8-flash` requests/day, the
 * `GenerateRequestsPerDayPerProjectPerModel-FreeTier` constraint) — real bulk
 * import at any meaningful scale requires enabling billing/paid-tier usage,
 * not just staying under this ceiling. */
export const OBSERVED_FREE_TIER_DAILY_GEMINI_REQUEST_LIMIT = 20;

export interface ObservedUsageSample {
  promptTokens: number;
  candidateTokens: number;
}

export interface CostProjection {
  sampleCount: number;
  averagePromptTokensPerItem: number;
  averageCandidateTokensPerItem: number;
  averageCostPerItemUsd: number;
  projected100ImagesUsd: number;
  projected1500ImagesUsd: number;
  pricingCheckedDate: string;
}

/**
 * Projects cost from REAL observed per-item Gemini token usage — never from a
 * theoretical assumption when real samples exist (§35: "clearly label
 * estimates and assumptions"; a real observed average is not an assumption).
 * Returns `undefined` when no real samples are available at all (nothing to
 * average), so a caller can fall back to explicitly labeling a projection as a
 * theoretical assumption instead of silently reporting `0`.
 */
export function projectCostFromObservedUsage(samples: ObservedUsageSample[]): CostProjection | undefined {
  if (samples.length === 0) return undefined;

  const avgPrompt = samples.reduce((sum, s) => sum + s.promptTokens, 0) / samples.length;
  const avgCandidate = samples.reduce((sum, s) => sum + s.candidateTokens, 0) / samples.length;

  const { inputPerMillion, outputPerMillion } = GEMINI_FLASH_PRICING_USD_PER_MILLION_TOKENS;
  const costPerItem = (avgPrompt / 1_000_000) * inputPerMillion + (avgCandidate / 1_000_000) * outputPerMillion;

  return {
    sampleCount: samples.length,
    averagePromptTokensPerItem: Math.round(avgPrompt),
    averageCandidateTokensPerItem: Math.round(avgCandidate),
    averageCostPerItemUsd: costPerItem,
    projected100ImagesUsd: costPerItem * 100,
    projected1500ImagesUsd: costPerItem * 1500,
    pricingCheckedDate: GEMINI_PRICING_CHECKED_DATE,
  };
}
