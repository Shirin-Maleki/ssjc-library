import { describe, expect, it } from "vitest";
import { classifyVisionFailure } from "@/lib/intake/visionFailureClassification";
import { AIProviderError } from "@/lib/ai/provider";

/**
 * Regression coverage for the real-cover correction pass's (final round, §2)
 * failure-classification fix — a teacher-facing "the photo is unreadable" outcome
 * must never be conflated with "the service is temporarily unavailable."
 */
describe("intake/visionFailureClassification", () => {
  it("classifies invalid_image as cover_unreadable", () => {
    const result = classifyVisionFailure(new AIProviderError("invalid_image", "The image has no bytes to analyze."));
    expect(result.category).toBe("cover_unreadable");
    expect(result.message).toBe("We couldn't read this cover clearly.");
  });

  it("classifies invalid_response as cover_unreadable", () => {
    const result = classifyVisionFailure(new AIProviderError("invalid_response", "Gemini returned malformed JSON."));
    expect(result.category).toBe("cover_unreadable");
  });

  it("classifies rate_limited as identification_unavailable", () => {
    const result = classifyVisionFailure(new AIProviderError("rate_limited", "Quota exceeded."));
    expect(result.category).toBe("identification_unavailable");
    expect(result.message).toBe("Automatic book recognition is temporarily unavailable.");
  });

  it("classifies transient_provider_failure as identification_unavailable", () => {
    const result = classifyVisionFailure(new AIProviderError("transient_provider_failure", "503 from upstream."));
    expect(result.category).toBe("identification_unavailable");
  });

  it("classifies timeout as identification_unavailable", () => {
    const result = classifyVisionFailure(new AIProviderError("timeout", "Vision call timed out."));
    expect(result.category).toBe("identification_unavailable");
  });

  it("classifies unexpected_provider_failure as identification_unavailable", () => {
    const result = classifyVisionFailure(new AIProviderError("unexpected_provider_failure", "Something odd."));
    expect(result.category).toBe("identification_unavailable");
  });

  it("classifies a non-AIProviderError (e.g. a plain thrown Error) as identification_unavailable, never crashing", () => {
    const result = classifyVisionFailure(new Error("some unrelated failure"));
    expect(result.category).toBe("identification_unavailable");
  });

  it("never exposes provider/technical language in the returned message", () => {
    const results = [
      classifyVisionFailure(new AIProviderError("invalid_image", "raw gemini text")),
      classifyVisionFailure(new AIProviderError("rate_limited", "429 quota exceeded for generativelanguage.googleapis.com")),
      classifyVisionFailure(new AIProviderError("timeout", "gemini-3.8-flash timed out")),
    ];
    for (const result of results) {
      expect(result.message).not.toMatch(/gemini|429|503|quota|api|model/i);
    }
  });
});
