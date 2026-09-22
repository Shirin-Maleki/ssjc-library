import "server-only";
import { GeminiBookIntelligenceProvider } from "./geminiProvider";
import type { BookVisionProvider } from "./provider";

export type { BookVisionProvider, CoverIdentificationInput, CoverAnalysisResult, AiSuggestionsStatus, AIErrorCategory } from "./provider";
export { AIProviderError } from "./provider";
export type { CoverIdentification, EnrichmentSuggestion, CombinedCoverAnalysis, AIConfidenceLevel } from "./schemas";

/**
 * The one place production code decides whether/how to construct the real Gemini
 * intelligence provider — never imported by a Client Component (`import
 * "server-only"` makes that a build error). Mirrors
 * `src/lib/embeddings/index.ts`/`src/lib/googleDrive/index.ts`'s exact pattern:
 * returns `undefined`, never throws, when `GEMINI_API_KEY` isn't set — "AI not
 * configured" degrades the intake pipeline (§40 of the phase brief: vision/
 * enrichment failure never blocks a save when other evidence is sufficient), it is
 * never a hard error.
 */
export function getConfiguredBookIntelligenceProvider(): BookVisionProvider | undefined {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return undefined;
  try {
    return new GeminiBookIntelligenceProvider(apiKey);
  } catch {
    return undefined;
  }
}
