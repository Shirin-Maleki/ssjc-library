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
}

export interface EnrichmentInput {
  /** The validated vision evidence from the identification step. */
  coverEvidence: CoverIdentification;
  /** The reconciled, trusted metadata candidate, when one was established — omitted
   * when none was (enrichment still runs on cover evidence alone; §20 of the phase
   * brief only requires that identity reconciliation happened first, not that it
   * succeeded with high confidence). */
  metadataSummary?: {
    title?: string;
    subtitle?: string;
    authors?: string[];
    publisher?: string;
    description?: string;
    subjects?: string[];
  };
  /** The exact, currently-active physical categories Gemini may choose from — never
   * a stale/hard-coded list (§28). Enforced again at the application layer
   * regardless of what the model returns. */
  activeCategories: { slug: string; label: string }[];
}

/** The first Gemini task — evidence extraction from a photographed cover, never
 * catalog completion (§8). */
export interface BookVisionProvider {
  identifyCover(input: CoverIdentificationInput): Promise<CoverIdentification>;
}

/** The second Gemini task — enrichment suggestions, run only after identity
 * reconciliation (§20). */
export interface BookEnrichmentProvider {
  suggestEnrichment(input: EnrichmentInput): Promise<EnrichmentSuggestion>;
}
