import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import {
  AIProviderError,
  type AIErrorCategory,
  type BookEnrichmentProvider,
  type BookVisionProvider,
  type CoverIdentificationInput,
  type EnrichmentInput,
} from "./provider";
import { CoverIdentificationSchema, EnrichmentSuggestionSchema, type CoverIdentification, type EnrichmentSuggestion } from "./schemas";
import { withGeminiRetry } from "./retry";

/**
 * Real Gemini vision/enrichment provider (Phase 7). Model decision, dated and
 * sourced (`docs/DECISIONS.md`, `docs/AI_PIPELINE.md`): **`gemini-3.8-flash`**,
 * re-confirmed against `ai.google.dev` on 2026-09-20 (the phase brief's own
 * suggested model name) — current stable/GA multimodal Flash model, image input
 * (JPEG/PNG/WebP/HEIC/HEIF, confirmed against the live official image-understanding
 * docs the same day), structured JSON output, current official
 * `@google/genai` JavaScript SDK support. Real API calls made during
 * implementation confirm this shape works end to end (image input + a
 * Zod-derived `responseSchema` + real structured JSON returned and Zod-validated).
 *
 * **API surface decision**: uses the SDK's `ai.models.generateContent` method
 * (`config.responseMimeType`/`config.responseSchema`), not Google's newer
 * "Interactions API" (`ai.interactions.create`) — both are current and officially
 * supported as of this date (the Interactions API reached GA 2026-06-22 and is now
 * the default shown across most doc pages; `generateContent` remains, in Google's
 * own words, "fully supported... for the foreseeable future" for exactly this kind
 * of mainline single-turn model call). This intake pipeline does one bounded,
 * single-turn structured-extraction call per step — none of the Interactions API's
 * differentiating capabilities (managed agents, long-running/background execution,
 * multi-turn agentic orchestration) apply here, and `generateContent`'s
 * request/response shape is the one already deeply, reliably understood in this
 * codebase. See `docs/DECISIONS.md` for the full reasoning.
 *
 * Deliberately NOT `import "server-only"` — matches `embeddings/geminiProvider.ts`
 * and `googleDrive/googleDriveProvider.ts`'s own reasoning: this class must be
 * directly constructible in mocked unit tests. The real production guard is
 * `src/lib/ai/index.ts`.
 */

const MODEL_ID = "gemini-3.8-flash";
const VISION_TIMEOUT_MS = 20_000;
const ENRICHMENT_TIMEOUT_MS = 15_000;

const COVER_IDENTIFICATION_JSON_SCHEMA = stripMetaKeys(z.toJSONSchema(CoverIdentificationSchema));
const ENRICHMENT_JSON_SCHEMA = stripMetaKeys(z.toJSONSchema(EnrichmentSuggestionSchema));

/** `z.toJSONSchema()` emits a top-level `$schema` key (and Zod 4 emits
 * `additionalProperties: false` at every object level) — Gemini's `responseSchema`
 * doesn't recognize `$schema` and real testing during implementation showed no
 * problem leaving `additionalProperties` in place, but `$schema` is stripped
 * defensively since it has no meaning to Gemini's schema validator. */
function stripMetaKeys(schema: unknown): Record<string, unknown> {
  if (schema && typeof schema === "object") {
    const rest = { ...(schema as Record<string, unknown>) };
    delete rest.$schema;
    return rest;
  }
  return schema as Record<string, unknown>;
}

const COVER_IDENTIFICATION_SYSTEM_INSTRUCTION = `You are extracting bibliographic evidence from a photograph of a children's book's front cover, for a school library catalog.

ONLY report information you can actually see printed on the cover in the photograph. Report a field as null when the cover does not clearly show it.

Do NOT invent or guess:
- an ISBN that is not visibly printed on the cover
- a publication year
- an exact edition
- a page count
- the interior illustration medium (the cover alone does not prove this)
- an age range
- a read-aloud duration
- publisher metadata not visible on the cover itself

The image is evidence, not permission to guess. If the cover is blurry, obscured, in an unfamiliar script, or otherwise unclear, report lower confidence and leave the relevant fields null rather than guessing.`;

function buildEnrichmentSystemInstruction(activeCategories: { slug: string; label: string }[]): string {
  const categoryList = activeCategories.map((c) => `- ${c.slug}: ${c.label}`).join("\n");
  return `You are suggesting enrichment metadata for a children's book already added to a school library catalog, based on validated cover evidence and (when available) bibliographic metadata already looked up from a trusted source.

Only suggest a value when there is real supporting evidence in what you were given. Leaving a field null/empty is correct and preferred over a plausible-sounding guess — this is a library catalog, not a fiction generator.

Write "description" as 1-2 plain sentences: what the book is about and why a teacher might search for it. Never sales language, never "beloved classic," never exaggerated praise, never an unsupported educational claim.

Suggest at most 8 short, normalized tags (lowercase, singular where natural, no near-duplicates of each other).

For "physicalCategorySlug", choose EXACTLY ONE slug from this exact list, or null if none genuinely fits — you may never invent a category or return a slug not in this list:
${categoryList}

A front cover alone does not prove the medium/style of the book's INTERIOR pages — only suggest visualMediaTypes/visualRealism when the cover itself is genuine evidence of the book's overall visual style, and prefer an empty/null answer when unsure.`;
}

interface EnrichmentPromptPayload {
  coverEvidence: unknown;
  metadataSummary: unknown;
}

function buildEnrichmentPrompt(input: EnrichmentInput): EnrichmentPromptPayload {
  return {
    coverEvidence: input.coverEvidence,
    metadataSummary: input.metadataSummary ?? null,
  };
}

export class GeminiBookIntelligenceProvider implements BookVisionProvider, BookEnrichmentProvider {
  private readonly client: GoogleGenAI;

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new AIProviderError("configuration_missing", "GEMINI_API_KEY is not set.");
    }
    this.client = new GoogleGenAI({ apiKey });
  }

  async identifyCover(input: CoverIdentificationInput): Promise<CoverIdentification> {
    if (input.imageBytes.length === 0) {
      throw new AIProviderError("invalid_image", "The image has no bytes to analyze.");
    }

    const raw = await this.callWithTimeout(
      () =>
        withGeminiRetry(() =>
          this.client.models.generateContent({
            model: MODEL_ID,
            contents: [
              {
                role: "user",
                parts: [
                  { text: "Extract bibliographic evidence visible on this book cover." },
                  { inlineData: { mimeType: input.mimeType, data: input.imageBytes.toString("base64") } },
                ],
              },
            ],
            config: {
              systemInstruction: COVER_IDENTIFICATION_SYSTEM_INSTRUCTION,
              responseMimeType: "application/json",
              responseSchema: COVER_IDENTIFICATION_JSON_SCHEMA,
            },
          })
        ),
      VISION_TIMEOUT_MS
    );

    return this.parseAndValidate(raw.text, CoverIdentificationSchema, "identifyCover");
  }

  async suggestEnrichment(input: EnrichmentInput): Promise<EnrichmentSuggestion> {
    const payload = buildEnrichmentPrompt(input);

    const raw = await this.callWithTimeout(
      () =>
        withGeminiRetry(() =>
          this.client.models.generateContent({
            model: MODEL_ID,
            contents: [
              {
                role: "user",
                parts: [{ text: `Evidence:\n${JSON.stringify(payload, null, 2)}` }],
              },
            ],
            config: {
              systemInstruction: buildEnrichmentSystemInstruction(input.activeCategories),
              responseMimeType: "application/json",
              responseSchema: ENRICHMENT_JSON_SCHEMA,
            },
          })
        ),
      ENRICHMENT_TIMEOUT_MS
    );

    return this.parseAndValidate(raw.text, EnrichmentSuggestionSchema, "suggestEnrichment");
  }

  private async callWithTimeout<T>(action: () => Promise<T>, timeoutMs: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    try {
      return await Promise.race([
        action(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new AIProviderError("timeout", `Gemini request timed out after ${timeoutMs}ms.`)), timeoutMs);
        }),
      ]);
    } catch (error) {
      throw this.mapError(error);
    } finally {
      clearTimeout(timer!);
    }
  }

  private mapError(error: unknown): AIProviderError {
    if (error instanceof AIProviderError) return error;
    const status = error && typeof error === "object" && "status" in error ? (error as { status: unknown }).status : undefined;
    let category: AIErrorCategory = "unexpected_provider_failure";
    if (status === 429) category = "rate_limited";
    else if (typeof status === "number" && status >= 500) category = "transient_provider_failure";
    // Never include the raw error's own message (which could echo request content)
    // beyond a short, safe category label.
    return new AIProviderError(category, `Gemini request failed (${category}).`, error);
  }

  private parseAndValidate<T>(text: string | undefined, schema: z.ZodType<T>, context: string): T {
    if (!text) {
      throw new AIProviderError("invalid_response", `Gemini returned no text content (${context}).`);
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch (error) {
      throw new AIProviderError("invalid_response", `Gemini's response was not valid JSON (${context}).`, error);
    }
    const result = schema.safeParse(json);
    if (!result.success) {
      throw new AIProviderError("invalid_response", `Gemini's response did not match the expected schema (${context}).`, result.error);
    }
    return result.data;
  }
}
