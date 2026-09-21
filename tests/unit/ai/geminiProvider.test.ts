import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const generateContentMock = vi.fn();

vi.mock("@google/genai", () => ({
  // A regular `function`, not an arrow function — arrow functions can't be used as
  // constructors, and the real class is invoked with `new GoogleGenAI(...)`.
  GoogleGenAI: vi.fn().mockImplementation(function () {
    return { models: { generateContent: generateContentMock } };
  }),
}));

import { GeminiBookIntelligenceProvider } from "@/lib/ai/geminiProvider";
import { AIProviderError } from "@/lib/ai/provider";
import type { CoverIdentification } from "@/lib/ai/schemas";

function partialCoverEvidence(overrides: Partial<CoverIdentification>): CoverIdentification {
  return {
    visibleTitle: null,
    visibleSubtitle: null,
    visibleAuthors: null,
    visibleIllustrators: null,
    visiblePublisherOrImprint: null,
    visibleLanguage: null,
    visibleIsbn: null,
    visibleSeries: null,
    candidateSearchTerms: [],
    identityConfidenceLevel: "low",
    evidenceNotes: "",
    ...overrides,
  };
}

function validCoverIdentificationJson() {
  return JSON.stringify({
    visibleTitle: "The Gruffalo",
    visibleSubtitle: null,
    visibleAuthors: ["Julia Donaldson"],
    visibleIllustrators: ["Axel Scheffler"],
    visiblePublisherOrImprint: "Macmillan",
    visibleLanguage: "English",
    visibleIsbn: null,
    visibleSeries: null,
    candidateSearchTerms: ["The Gruffalo Julia Donaldson"],
    identityConfidenceLevel: "high",
    evidenceNotes: "Title and authors clearly visible on the cover.",
  });
}

describe("ai/geminiProvider — GeminiBookIntelligenceProvider", () => {
  beforeEach(() => {
    generateContentMock.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("throws configuration_missing when constructed without an API key", () => {
    expect(() => new GeminiBookIntelligenceProvider("")).toThrow(AIProviderError);
    try {
      new GeminiBookIntelligenceProvider("");
    } catch (error) {
      expect((error as AIProviderError).category).toBe("configuration_missing");
    }
  });

  it("throws invalid_image before ever calling the model for a zero-byte image", async () => {
    const provider = new GeminiBookIntelligenceProvider("fake-key");
    await expect(provider.identifyCover({ imageBytes: Buffer.alloc(0), mimeType: "image/jpeg" })).rejects.toMatchObject({
      category: "invalid_image",
    });
    expect(generateContentMock).not.toHaveBeenCalled();
  });

  it("returns a Zod-validated CoverIdentification on a well-formed real-shaped response", async () => {
    generateContentMock.mockResolvedValue({ text: validCoverIdentificationJson() });
    const provider = new GeminiBookIntelligenceProvider("fake-key");
    const result = await provider.identifyCover({ imageBytes: Buffer.from("fake-image-bytes"), mimeType: "image/jpeg" });
    expect(result.visibleTitle).toBe("The Gruffalo");
    expect(result.identityConfidenceLevel).toBe("high");
  });

  it("sends the image as inlineData with the given mimeType, base64-encoded", async () => {
    generateContentMock.mockResolvedValue({ text: validCoverIdentificationJson() });
    const provider = new GeminiBookIntelligenceProvider("fake-key");
    const bytes = Buffer.from("hello-cover-bytes");
    await provider.identifyCover({ imageBytes: bytes, mimeType: "image/webp" });

    const call = generateContentMock.mock.calls[0][0];
    const imagePart = call.contents[0].parts.find((p: { inlineData?: unknown }) => p.inlineData);
    expect(imagePart.inlineData.mimeType).toBe("image/webp");
    expect(imagePart.inlineData.data).toBe(bytes.toString("base64"));
  });

  it("uses the documented model id", async () => {
    generateContentMock.mockResolvedValue({ text: validCoverIdentificationJson() });
    const provider = new GeminiBookIntelligenceProvider("fake-key");
    await provider.identifyCover({ imageBytes: Buffer.from("x"), mimeType: "image/jpeg" });
    expect(generateContentMock.mock.calls[0][0].model).toBe("gemini-3.8-flash");
  });

  it("instructs the model to handle rotation, skew, and background clutter before reading cover text (real-cover correction pass §4)", async () => {
    generateContentMock.mockResolvedValue({ text: validCoverIdentificationJson() });
    const provider = new GeminiBookIntelligenceProvider("fake-key");
    await provider.identifyCover({ imageBytes: Buffer.from("x"), mimeType: "image/jpeg" });
    const instruction = generateContentMock.mock.calls[0][0].config.systemInstruction as string;
    expect(instruction).toContain("90, 180, or 270 degrees");
    expect(instruction).toMatch(/skew|angle/i);
    expect(instruction).toMatch(/front-cover rectangle/i);
    expect(instruction).toMatch(/distinguishing it from any other books/i);
    // The evidence boundary must survive this addition unchanged — still no
    // license to invent hidden bibliographic fields.
    expect(instruction).toMatch(/Do NOT invent or guess/);
    expect(instruction).toContain("an ISBN that is not visibly printed on the cover");
  });

  it("throws invalid_response when Gemini's response is not valid JSON", async () => {
    generateContentMock.mockResolvedValue({ text: "not json at all" });
    const provider = new GeminiBookIntelligenceProvider("fake-key");
    await expect(provider.identifyCover({ imageBytes: Buffer.from("x"), mimeType: "image/jpeg" })).rejects.toMatchObject({
      category: "invalid_response",
    });
  });

  it("throws invalid_response when Gemini's JSON is schema-valid-shaped JSON but violates the schema (e.g. too many search terms)", async () => {
    const tooManyTerms = JSON.parse(validCoverIdentificationJson());
    tooManyTerms.candidateSearchTerms = ["a", "b", "c", "d", "e", "f"]; // max 5
    generateContentMock.mockResolvedValue({ text: JSON.stringify(tooManyTerms) });
    const provider = new GeminiBookIntelligenceProvider("fake-key");
    await expect(provider.identifyCover({ imageBytes: Buffer.from("x"), mimeType: "image/jpeg" })).rejects.toMatchObject({
      category: "invalid_response",
    });
  });

  it("throws invalid_response when Gemini returns empty text", async () => {
    generateContentMock.mockResolvedValue({ text: "" });
    const provider = new GeminiBookIntelligenceProvider("fake-key");
    await expect(provider.identifyCover({ imageBytes: Buffer.from("x"), mimeType: "image/jpeg" })).rejects.toMatchObject({
      category: "invalid_response",
    });
  });

  it("maps a thrown 429 status to rate_limited (after internal retries exhaust)", async () => {
    vi.useFakeTimers();
    const rateLimitError = Object.assign(new Error("rate limited"), { status: 429 });
    generateContentMock.mockRejectedValue(rateLimitError);
    const provider = new GeminiBookIntelligenceProvider("fake-key");
    const promise = provider.identifyCover({ imageBytes: Buffer.from("x"), mimeType: "image/jpeg" });
    promise.catch(() => {});
    await vi.runAllTimersAsync();
    await expect(promise).rejects.toMatchObject({ category: "rate_limited" });
  });

  it("maps a thrown 503 status to transient_provider_failure (after internal retries exhaust)", async () => {
    vi.useFakeTimers();
    const serverError = Object.assign(new Error("high demand"), { status: 503 });
    generateContentMock.mockRejectedValue(serverError);
    const provider = new GeminiBookIntelligenceProvider("fake-key");
    const promise = provider.identifyCover({ imageBytes: Buffer.from("x"), mimeType: "image/jpeg" });
    promise.catch(() => {});
    await vi.runAllTimersAsync();
    await expect(promise).rejects.toMatchObject({ category: "transient_provider_failure" });
  });

  it("recovers from a single transient 503 via internal retry and still succeeds", async () => {
    vi.useFakeTimers();
    const serverError = Object.assign(new Error("high demand"), { status: 503 });
    generateContentMock.mockRejectedValueOnce(serverError).mockResolvedValueOnce({ text: validCoverIdentificationJson() });
    const provider = new GeminiBookIntelligenceProvider("fake-key");
    const promise = provider.identifyCover({ imageBytes: Buffer.from("x"), mimeType: "image/jpeg" });
    promise.catch(() => {});
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result.visibleTitle).toBe("The Gruffalo");
    expect(generateContentMock).toHaveBeenCalledTimes(2);
  });

  it("never includes the raw underlying error's message in the mapped error (no leaked provider internals)", async () => {
    vi.useFakeTimers();
    const detailedError = Object.assign(new Error("secret internal diagnostic detail"), { status: 500 });
    generateContentMock.mockRejectedValue(detailedError);
    const provider = new GeminiBookIntelligenceProvider("fake-key");
    const promise = provider.identifyCover({ imageBytes: Buffer.from("x"), mimeType: "image/jpeg" });
    promise.catch(() => {});
    await vi.runAllTimersAsync();
    await expect(promise).rejects.not.toMatchObject({ message: expect.stringContaining("secret internal diagnostic detail") });
  });

  describe("suggestEnrichment", () => {
    function validEnrichmentJson() {
      return JSON.stringify({
        description: "A mouse outwits a series of forest predators by inventing a fearsome creature.",
        tags: ["forest", "clever-mouse"],
        fictionType: "fiction",
        format: "picture_book",
        ageMinMonths: 24,
        ageMaxMonths: 60,
        readAloudMinutes: 8,
        visualMediaTypes: ["digital_illustration"],
        visualRealism: "stylized_illustration",
        physicalCategorySlug: "picture-books",
        categoryConfidence: "high",
        categoryReason: "Clearly a picture book format and length.",
      });
    }

    it("never sends image bytes for the enrichment call — text evidence only", async () => {
      generateContentMock.mockResolvedValue({ text: validEnrichmentJson() });
      const provider = new GeminiBookIntelligenceProvider("fake-key");
      await provider.suggestEnrichment({
        coverEvidence: partialCoverEvidence({ visibleTitle: "The Gruffalo" }),
        metadataSummary: undefined,
        activeCategories: [{ slug: "picture-books", label: "Picture Books" }],
      });
      const call = generateContentMock.mock.calls[0][0];
      const hasImagePart = call.contents[0].parts.some((p: { inlineData?: unknown }) => p.inlineData);
      expect(hasImagePart).toBe(false);
    });

    it("injects only the given active categories into the system instruction, never inventing one", async () => {
      generateContentMock.mockResolvedValue({ text: validEnrichmentJson() });
      const provider = new GeminiBookIntelligenceProvider("fake-key");
      await provider.suggestEnrichment({
        coverEvidence: partialCoverEvidence({ visibleTitle: "The Gruffalo" }),
        metadataSummary: undefined,
        activeCategories: [{ slug: "picture-books", label: "Picture Books" }],
      });
      const call = generateContentMock.mock.calls[0][0];
      expect(call.config.systemInstruction).toContain("picture-books: Picture Books");
      expect(call.config.systemInstruction).not.toContain("board-books");
    });

    it("rejects an enrichment response with a fictionType outside the allowed vocabulary", async () => {
      const invalid = JSON.parse(validEnrichmentJson());
      invalid.fictionType = "biography"; // not in the allowed enum
      generateContentMock.mockResolvedValue({ text: JSON.stringify(invalid) });
      const provider = new GeminiBookIntelligenceProvider("fake-key");
      await expect(
        provider.suggestEnrichment({ coverEvidence: partialCoverEvidence({}), metadataSummary: undefined, activeCategories: [] })
      ).rejects.toMatchObject({ category: "invalid_response" });
    });
  });
});
