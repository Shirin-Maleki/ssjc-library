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

const ACTIVE_CATEGORIES = [{ slug: "picture-books", label: "Picture Books" }];

function validCoverEvidence(overrides: Record<string, unknown> = {}) {
  return {
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
    ...overrides,
  };
}

function validAiSuggestions(overrides: Record<string, unknown> = {}) {
  return {
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
    ...overrides,
  };
}

function combinedResponseJson(coverEvidenceOverrides: Record<string, unknown> = {}, aiSuggestionsOverrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    coverEvidence: validCoverEvidence(coverEvidenceOverrides),
    aiSuggestions: validAiSuggestions(aiSuggestionsOverrides),
  });
}

describe("ai/geminiProvider — GeminiBookIntelligenceProvider.analyzeCover (AI-first catalog draft correction)", () => {
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
    await expect(
      provider.analyzeCover({ imageBytes: Buffer.alloc(0), mimeType: "image/jpeg", activeCategories: ACTIVE_CATEGORIES })
    ).rejects.toMatchObject({ category: "invalid_image" });
    expect(generateContentMock).not.toHaveBeenCalled();
  });

  it("returns a Zod-validated coverEvidence AND aiSuggestions from one combined, well-formed response", async () => {
    generateContentMock.mockResolvedValue({ text: combinedResponseJson() });
    const provider = new GeminiBookIntelligenceProvider("fake-key");
    const result = await provider.analyzeCover({ imageBytes: Buffer.from("fake-image-bytes"), mimeType: "image/jpeg", activeCategories: ACTIVE_CATEGORIES });
    expect(result.coverEvidence.visibleTitle).toBe("The Gruffalo");
    expect(result.coverEvidence.identityConfidenceLevel).toBe("high");
    expect(result.aiSuggestions.physicalCategorySlug).toBe("picture-books");
    expect(result.aiSuggestions.ageMinMonths).toBe(24);
    expect(result.aiSuggestions.description).toContain("outwits");
    // AI draft human-correction semantics (final round §4) — genuinely validated
    // output is "valid", never confused with the schema-failure fallback.
    expect(result.aiSuggestionsStatus).toBe("valid");
    // One call did the work of the old two.
    expect(generateContentMock).toHaveBeenCalledTimes(1);
  });

  it("sends the image as inlineData with the given mimeType, base64-encoded", async () => {
    generateContentMock.mockResolvedValue({ text: combinedResponseJson() });
    const provider = new GeminiBookIntelligenceProvider("fake-key");
    const bytes = Buffer.from("hello-cover-bytes");
    await provider.analyzeCover({ imageBytes: bytes, mimeType: "image/webp", activeCategories: ACTIVE_CATEGORIES });

    const call = generateContentMock.mock.calls[0][0];
    const imagePart = call.contents[0].parts.find((p: { inlineData?: unknown }) => p.inlineData);
    expect(imagePart.inlineData.mimeType).toBe("image/webp");
    expect(imagePart.inlineData.data).toBe(bytes.toString("base64"));
  });

  it("uses the documented model id", async () => {
    generateContentMock.mockResolvedValue({ text: combinedResponseJson() });
    const provider = new GeminiBookIntelligenceProvider("fake-key");
    await provider.analyzeCover({ imageBytes: Buffer.from("x"), mimeType: "image/jpeg", activeCategories: ACTIVE_CATEGORIES });
    expect(generateContentMock.mock.calls[0][0].model).toBe("gemini-3.8-flash");
  });

  it("instructs the model to handle rotation, skew, and background clutter before reading cover text, and keeps the strict evidence boundary (real-cover correction pass §4, AI-first catalog draft correction §2)", async () => {
    generateContentMock.mockResolvedValue({ text: combinedResponseJson() });
    const provider = new GeminiBookIntelligenceProvider("fake-key");
    await provider.analyzeCover({ imageBytes: Buffer.from("x"), mimeType: "image/jpeg", activeCategories: ACTIVE_CATEGORIES });
    const instruction = generateContentMock.mock.calls[0][0].config.systemInstruction as string;
    expect(instruction).toContain("90, 180, or 270 degrees");
    expect(instruction).toMatch(/skew|angle/i);
    expect(instruction).toMatch(/front-cover rectangle/i);
    expect(instruction).toMatch(/distinguishing it from any other books/i);
    expect(instruction).toMatch(/Do NOT invent or guess/);
    expect(instruction).toContain("an ISBN that is not visibly printed on the cover");
  });

  it("explicitly tells the model aiSuggestions is expected to make useful best-effort suggestions, not default to null (AI-first catalog draft correction §2/§6)", async () => {
    generateContentMock.mockResolvedValue({ text: combinedResponseJson() });
    const provider = new GeminiBookIntelligenceProvider("fake-key");
    await provider.analyzeCover({ imageBytes: Buffer.from("x"), mimeType: "image/jpeg", activeCategories: ACTIVE_CATEGORIES });
    const instruction = generateContentMock.mock.calls[0][0].config.systemInstruction as string;
    expect(instruction).toMatch(/expected to make a useful best-effort suggestion/i);
    expect(instruction).toMatch(/save a busy teacher real cataloging work/i);
    expect(instruction).toMatch(/reasonable pedagogical judgment/i);
  });

  it("injects only the given active categories into the system instruction, never a hard-coded/stale list", async () => {
    generateContentMock.mockResolvedValue({ text: combinedResponseJson() });
    const provider = new GeminiBookIntelligenceProvider("fake-key");
    await provider.analyzeCover({ imageBytes: Buffer.from("x"), mimeType: "image/jpeg", activeCategories: [{ slug: "picture-books", label: "Picture Books" }] });
    const instruction = generateContentMock.mock.calls[0][0].config.systemInstruction as string;
    expect(instruction).toContain("picture-books: Picture Books");
    expect(instruction).not.toContain("board-books");
  });

  it("includes an explicit teacher-provided rotation hint in the prompt text when the analysis bytes couldn't be physically rotated (real-cover correction pass, final round §1)", async () => {
    generateContentMock.mockResolvedValue({ text: combinedResponseJson() });
    const provider = new GeminiBookIntelligenceProvider("fake-key");
    await provider.analyzeCover({ imageBytes: Buffer.from("x"), mimeType: "image/heic", teacherRotationHintDegrees: 90, activeCategories: ACTIVE_CATEGORIES });
    const call = generateContentMock.mock.calls[0][0];
    const textPart = call.contents[0].parts.find((p: { text?: string }) => p.text).text as string;
    expect(textPart).toMatch(/90-degree clockwise rotation/);
    expect(textPart).toMatch(/could not be automatically pixel-rotated/i);
    expect(textPart).toMatch(/stronger, more reliable signal/i);
  });

  it("sends no rotation-hint text when no rotation was requested (0/undefined) — never an unnecessary correction", async () => {
    generateContentMock.mockResolvedValue({ text: combinedResponseJson() });
    const provider = new GeminiBookIntelligenceProvider("fake-key");
    await provider.analyzeCover({ imageBytes: Buffer.from("x"), mimeType: "image/heic", teacherRotationHintDegrees: 0, activeCategories: ACTIVE_CATEGORIES });
    let call = generateContentMock.mock.calls[0][0];
    let textPart = call.contents[0].parts.find((p: { text?: string }) => p.text).text as string;
    expect(textPart).not.toMatch(/rotation/i);

    generateContentMock.mockClear();
    await provider.analyzeCover({ imageBytes: Buffer.from("x"), mimeType: "image/jpeg", activeCategories: ACTIVE_CATEGORIES }); // omitted entirely
    call = generateContentMock.mock.calls[0][0];
    textPart = call.contents[0].parts.find((p: { text?: string }) => p.text).text as string;
    expect(textPart).not.toMatch(/rotation/i);
  });

  it("a JPEG whose bytes were already physically rotated needs no hint — real behavior unchanged from the orientation fix", async () => {
    generateContentMock.mockResolvedValue({ text: combinedResponseJson() });
    const provider = new GeminiBookIntelligenceProvider("fake-key");
    await provider.analyzeCover({ imageBytes: Buffer.from("x"), mimeType: "image/jpeg", activeCategories: ACTIVE_CATEGORIES });
    const call = generateContentMock.mock.calls[0][0];
    const textPart = call.contents[0].parts.find((p: { text?: string }) => p.text).text as string;
    expect(textPart).toBe("Analyze this book cover photo and produce both coverEvidence and aiSuggestions as instructed.");
  });

  it("throws invalid_response when Gemini's response is not valid JSON", async () => {
    generateContentMock.mockResolvedValue({ text: "not json at all" });
    const provider = new GeminiBookIntelligenceProvider("fake-key");
    await expect(
      provider.analyzeCover({ imageBytes: Buffer.from("x"), mimeType: "image/jpeg", activeCategories: ACTIVE_CATEGORIES })
    ).rejects.toMatchObject({ category: "invalid_response" });
  });

  it("throws invalid_response when Gemini returns empty text", async () => {
    generateContentMock.mockResolvedValue({ text: "" });
    const provider = new GeminiBookIntelligenceProvider("fake-key");
    await expect(
      provider.analyzeCover({ imageBytes: Buffer.from("x"), mimeType: "image/jpeg", activeCategories: ACTIVE_CATEGORIES })
    ).rejects.toMatchObject({ category: "invalid_response" });
  });

  it("throws invalid_response when coverEvidence itself is malformed (e.g. too many search terms) — the strict evidence half is a hard requirement", async () => {
    generateContentMock.mockResolvedValue({
      text: combinedResponseJson({ candidateSearchTerms: ["a", "b", "c", "d", "e", "f"] }), // max 5
    });
    const provider = new GeminiBookIntelligenceProvider("fake-key");
    await expect(
      provider.analyzeCover({ imageBytes: Buffer.from("x"), mimeType: "image/jpeg", activeCategories: ACTIVE_CATEGORIES })
    ).rejects.toMatchObject({ category: "invalid_response" });
  });

  it("a malformed aiSuggestions section does NOT discard an otherwise-valid coverEvidence — falls back to empty suggestions instead of failing the whole call, AND is reported as unavailable (AI-first catalog draft correction §5/§13; AI draft human-correction semantics §4)", async () => {
    generateContentMock.mockResolvedValue({
      text: combinedResponseJson({}, { fictionType: "biography" }), // not in the allowed enum
    });
    const provider = new GeminiBookIntelligenceProvider("fake-key");
    const result = await provider.analyzeCover({ imageBytes: Buffer.from("x"), mimeType: "image/jpeg", activeCategories: ACTIVE_CATEGORIES });
    expect(result.coverEvidence.visibleTitle).toBe("The Gruffalo"); // preserved
    expect(result.aiSuggestions.fictionType).toBeNull(); // salvaged to the empty default
    expect(result.aiSuggestions.tags).toEqual([]);
    expect(result.aiSuggestions.physicalCategorySlug).toBeNull();
    // Never confused with a genuinely valid (if sparse) suggestion — downstream
    // code must know this was a recovery fallback, not real model output.
    expect(result.aiSuggestionsStatus).toBe("unavailable");
  });

  it("a completely missing aiSuggestions key also falls back to empty suggestions rather than failing, and is reported as unavailable", async () => {
    generateContentMock.mockResolvedValue({ text: JSON.stringify({ coverEvidence: validCoverEvidence() }) });
    const provider = new GeminiBookIntelligenceProvider("fake-key");
    const result = await provider.analyzeCover({ imageBytes: Buffer.from("x"), mimeType: "image/jpeg", activeCategories: ACTIVE_CATEGORIES });
    expect(result.coverEvidence.visibleTitle).toBe("The Gruffalo");
    expect(result.aiSuggestions.description).toBeNull();
    expect(result.aiSuggestionsStatus).toBe("unavailable");
  });

  it("a genuinely valid but legitimately sparse (all-null) aiSuggestions section is still reported as valid, never confused with the fallback (AI draft human-correction semantics §4)", async () => {
    // Schema-valid, but every field happens to be null/empty — the model
    // examined the cover and genuinely had nothing to suggest.
    const sparseButValid = {
      description: null,
      tags: [],
      fictionType: null,
      format: null,
      ageMinMonths: null,
      ageMaxMonths: null,
      readAloudMinutes: null,
      visualMediaTypes: [],
      visualRealism: null,
      physicalCategorySlug: null,
      categoryConfidence: null,
      categoryReason: null,
    };
    generateContentMock.mockResolvedValue({ text: JSON.stringify({ coverEvidence: validCoverEvidence(), aiSuggestions: sparseButValid }) });
    const provider = new GeminiBookIntelligenceProvider("fake-key");
    const result = await provider.analyzeCover({ imageBytes: Buffer.from("x"), mimeType: "image/jpeg", activeCategories: ACTIVE_CATEGORIES });
    expect(result.aiSuggestions.description).toBeNull();
    expect(result.aiSuggestionsStatus).toBe("valid");
  });

  it("maps a thrown 429 status to rate_limited (after internal retries exhaust)", async () => {
    vi.useFakeTimers();
    const rateLimitError = Object.assign(new Error("rate limited"), { status: 429 });
    generateContentMock.mockRejectedValue(rateLimitError);
    const provider = new GeminiBookIntelligenceProvider("fake-key");
    const promise = provider.analyzeCover({ imageBytes: Buffer.from("x"), mimeType: "image/jpeg", activeCategories: ACTIVE_CATEGORIES });
    promise.catch(() => {});
    await vi.runAllTimersAsync();
    await expect(promise).rejects.toMatchObject({ category: "rate_limited" });
  });

  it("maps a thrown 503 status to transient_provider_failure (after internal retries exhaust)", async () => {
    vi.useFakeTimers();
    const serverError = Object.assign(new Error("high demand"), { status: 503 });
    generateContentMock.mockRejectedValue(serverError);
    const provider = new GeminiBookIntelligenceProvider("fake-key");
    const promise = provider.analyzeCover({ imageBytes: Buffer.from("x"), mimeType: "image/jpeg", activeCategories: ACTIVE_CATEGORIES });
    promise.catch(() => {});
    await vi.runAllTimersAsync();
    await expect(promise).rejects.toMatchObject({ category: "transient_provider_failure" });
  });

  it("recovers from a single transient 503 via internal retry and still succeeds", async () => {
    vi.useFakeTimers();
    const serverError = Object.assign(new Error("high demand"), { status: 503 });
    generateContentMock.mockRejectedValueOnce(serverError).mockResolvedValueOnce({ text: combinedResponseJson() });
    const provider = new GeminiBookIntelligenceProvider("fake-key");
    const promise = provider.analyzeCover({ imageBytes: Buffer.from("x"), mimeType: "image/jpeg", activeCategories: ACTIVE_CATEGORIES });
    promise.catch(() => {});
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result.coverEvidence.visibleTitle).toBe("The Gruffalo");
    expect(generateContentMock).toHaveBeenCalledTimes(2);
  });

  it("never includes the raw underlying error's message in the mapped error (no leaked provider internals)", async () => {
    vi.useFakeTimers();
    const detailedError = Object.assign(new Error("secret internal diagnostic detail"), { status: 500 });
    generateContentMock.mockRejectedValue(detailedError);
    const provider = new GeminiBookIntelligenceProvider("fake-key");
    const promise = provider.analyzeCover({ imageBytes: Buffer.from("x"), mimeType: "image/jpeg", activeCategories: ACTIVE_CATEGORIES });
    promise.catch(() => {});
    await vi.runAllTimersAsync();
    await expect(promise).rejects.not.toMatchObject({ message: expect.stringContaining("secret internal diagnostic detail") });
  });
});
