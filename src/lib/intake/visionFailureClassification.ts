import { AIProviderError } from "@/lib/ai/provider";

/**
 * Real-cover correction pass (final round, §2) — `identifyCoverAction` previously
 * collapsed every vision-provider failure (Gemini quota exhaustion, a rate limit, a
 * timeout, a genuinely unreadable image) into one identical "vision_failed"
 * category, which the UI showed as one identical recovery screen regardless of
 * cause. That's incorrect UX: a teacher whose photo is fine but whose automatic
 * recognition is temporarily unavailable should never be told to rotate/retake the
 * photo — the photo was never the problem.
 *
 * Extracted into its own pure module (mirrors `candidateAcceptance.ts`'s reasoning
 * from the identity-safety fix) specifically so this classification is directly
 * unit-testable without a database connection or staff session — both required
 * just to *import* `actions.ts`.
 *
 * Two real, distinct teacher-facing outcomes:
 * - `cover_unreadable`: the provider call completed but the image itself
 *   genuinely couldn't be read (a malformed/empty analysis image, or a response
 *   that failed schema validation) — rotate/retry/choose-a-different-photo are all
 *   meaningful actions here. (The OTHER `cover_unreadable` case — a well-formed
 *   response with no usable title — never throws at all; `identifyCoverAction`
 *   handles that separately via its own `hasUsableIdentification` flag.)
 * - `identification_unavailable`: the provider itself is the problem right now
 *   (rate limit, transient failure, timeout, or any other unexpected provider
 *   failure) — retry later or continue manually, never "take a better photo."
 *
 * Never exposes the underlying provider category, a raw provider message, an HTTP
 * status, or any model/API identifier in the returned teacher-facing message.
 */
export type VisionFailureCategory = "cover_unreadable" | "identification_unavailable";

export interface ClassifiedVisionFailure {
  category: VisionFailureCategory;
  message: string;
}

export function classifyVisionFailure(error: unknown): ClassifiedVisionFailure {
  const providerCategory = error instanceof AIProviderError ? error.category : "unexpected_provider_failure";
  if (providerCategory === "invalid_image" || providerCategory === "invalid_response") {
    return { category: "cover_unreadable", message: "We couldn't read this cover clearly." };
  }
  // rate_limited, transient_provider_failure, timeout, unexpected_provider_failure,
  // configuration_missing (defensive only — identifyCoverAction already returns a
  // separate, earlier failure for that case before this classifier ever runs).
  return { category: "identification_unavailable", message: "Automatic book recognition is temporarily unavailable." };
}
