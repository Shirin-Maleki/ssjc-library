import type { CoverIdentification, EnrichmentSuggestion } from "./schemas";

/**
 * The seam between the intake pipeline and Gemini generation/vision (Phase 7, §7 of
 * the phase brief) — mirrors the provider-boundary shape already proven twice in
 * this codebase (`src/lib/embeddings/`, `src/lib/googleDrive/`): interface + errors
 * here, one concrete implementation (`geminiProvider.ts`), one server-only factory
 * (`index.ts`). Nothing outside this file and `geminiProvider.ts` knows Gemini's
 * request/response shapes. Deliberately separate from
 * `src/lib/embeddings/geminiProvider.ts` — generation/vision and embedding are
 * different provider responsibilities using the same `GEMINI_API_KEY` through
 * completely independent code paths (§6 of the phase brief); this file never
 * imports, wraps, or modifies that one.
 */

export type AIErrorCategory =
  | "configuration_missing"
  | "invalid_image"
  | "rate_limited"
  | "transient_provider_failure"
  | "timeout"
  | "invalid_response"
  | "unexpected_provider_failure";

/**
 * The one error type both provider methods throw. `message` never contains a raw
 * Gemini response body, the API key, or verbose model prose — see
 * `geminiProvider.ts`'s own comment and the secret-safety tests in
 * `tests/unit/ai/geminiProvider.test.ts`.
 */
export class AIProviderError extends Error {
  constructor(readonly category: AIErrorCategory, message: string, readonly cause?: unknown) {
    super(message);
    this.name = "AIProviderError";
  }
}

export interface CoverIdentificationInput {
  /** The (possibly resized, `src/lib/intake/imagePrep.ts`) analysis image bytes —
   * never the Drive original file reference itself; this provider has no idea Drive
   * exists. */
  imageBytes: Buffer;
  mimeType: string;
  /**
   * A teacher-provided clockwise rotation correction that could NOT be physically
   * applied to `imageBytes` (real-cover correction pass §1, final round) — set only
   * when `manualRotationApplied` was `false` on the `AnalysisImage` these bytes came
   * from (in practice: a real HEIC/HEIF source, which this deployment's `sharp`
   * build cannot decode/rotate) AND the teacher chose a non-zero rotation on the
   * preview. Never set when the bytes were already physically rotated — that case
   * needs no hint, the pixels already show the correction.
   *
   * Explicit, structured teacher input, not a guess — the system instruction treats
   * this as stronger evidence of intended viewing orientation than the model's own
   * automatic inference from the (possibly still-sideways) pixels themselves.
   */
  teacherRotationHintDegrees?: 0 | 90 | 180 | 270;
  /** The exact, currently-active physical categories Gemini may choose from for
   * `aiSuggestions.physicalCategorySlug` — never a stale/hard-coded list (§28 of the
   * phase brief). Enforced again at the application layer regardless of what the
   * model returns (`src/lib/intake/categorySuggestion.ts`). Fetched and passed in
   * for THIS one combined call now that evidence extraction and suggestion both
   * happen together (AI-first catalog draft correction, §3) — previously only the
   * second, separate enrichment call needed this list. */
  activeCategories: { slug: string; label: string }[];
}

/**
 * AI draft human-correction semantics (final round, §4) — `aiSuggestions` alone
 * can't distinguish "the model genuinely examined this cover and had nothing
 * useful to suggest" (still a real, valid result) from "the model's suggestions
 * section failed its own schema validation and was replaced by
 * `EMPTY_AI_SUGGESTIONS` as a recovery fallback" (not a real result at all) —
 * both can produce an all-null/empty object. `aiSuggestionsStatus` makes that
 * distinction explicit and is never inferred from `aiSuggestions`' own content.
 */
export type AiSuggestionsStatus = "valid" | "unavailable";

export interface CoverAnalysisResult {
  coverEvidence: CoverIdentification;
  aiSuggestions: EnrichmentSuggestion;
  aiSuggestionsStatus: AiSuggestionsStatus;
}

/** The one Gemini vision task per book (AI-first catalog draft correction, §3) —
 * one multimodal request returns both strict visible-evidence extraction and
 * genuinely inferential catalog-assistance suggestions, replacing the original
 * two-sequential-call design (`identifyCover` + a separate `suggestEnrichment`).
 * See `src/lib/ai/schemas.ts`'s `CombinedCoverAnalysisSchema` doc comment for why
 * this halves the default per-book Gemini call count and for why the two sections
 * are validated independently. */
export interface BookVisionProvider {
  analyzeCover(input: CoverIdentificationInput): Promise<CoverAnalysisResult>;
}
