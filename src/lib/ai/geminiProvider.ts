import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { AIProviderError, type AIErrorCategory, type BookVisionProvider, type CoverIdentificationInput, type CoverAnalysisResult } from "./provider";
import { CoverIdentificationSchema, CombinedCoverAnalysisSchema, EnrichmentSuggestionSchema, EMPTY_AI_SUGGESTIONS } from "./schemas";
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
 * **AI-first catalog draft correction**: `analyzeCover()` replaces the original
 * `identifyCover()` + `suggestEnrichment()` two-sequential-call design with ONE
 * combined multimodal request returning `{ coverEvidence, aiSuggestions }`. See
 * `schemas.ts`'s `CombinedCoverAnalysisSchema` for why, and this file's
 * `parseCombinedAnalysis()` for why the two sections are validated independently.
 *
 * Deliberately NOT `import "server-only"` — matches `embeddings/geminiProvider.ts`
 * and `googleDrive/googleDriveProvider.ts`'s own reasoning: this class must be
 * directly constructible in mocked unit tests. The real production guard is
 * `src/lib/ai/index.ts`.
 */

const MODEL_ID = "gemini-3.8-flash";
const ANALYSIS_TIMEOUT_MS = 25_000; // one combined call now does the work of the old two (20s + 15s) calls

const COMBINED_ANALYSIS_JSON_SCHEMA = stripMetaKeys(z.toJSONSchema(CombinedCoverAnalysisSchema));

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

/**
 * The one combined system instruction (AI-first catalog draft correction, §2/§6) —
 * explicitly separates two different obligations in the same response:
 * `coverEvidence` (strict, visible-only, never invented) and `aiSuggestions`
 * (genuinely inferential, teacher-labor-saving catalog assistance, expected to make
 * a useful best-effort guess rather than defaulting to null merely because the
 * cover alone doesn't literally prove the answer). Conflating these two would
 * either make bibliographic identity unreliable (if suggestions were treated as
 * fact) or make suggestions uselessly sparse (if evidence's strict standard leaked
 * into them) — the prompt is deliberately explicit about which rule applies to
 * which half of the response.
 */
function buildCombinedAnalysisSystemInstruction(activeCategories: { slug: string; label: string }[]): string {
  const categoryList = activeCategories.map((c) => `- ${c.slug}: ${c.label}`).join("\n");
  return `You are helping a school librarian catalog a children's book from one photograph of its front cover. You produce TWO separate sections in one response: "coverEvidence" (strict factual extraction) and "aiSuggestions" (useful, explicitly inferential catalog assistance). These two sections follow DIFFERENT rules — read both parts of this instruction carefully before answering.

This is a REAL PHONE PHOTO, not a clean scan. Before reading any text, account for how real phone photos are actually taken:
- The image may be rotated 90, 180, or 270 degrees from upright — a photo's orientation metadata is not reliable, so judge orientation from the image content itself, not from any assumption that it arrives upright.
- The photo may be slightly skewed, taken at an angle, or show mild perspective distortion (the cover photographed from slightly above/below/to one side).
- The frame may include background clutter — a shelf, table, other books, hands, or the edge of a surface — alongside the actual book.

Before extracting anything, work through these steps:
1. Identify the likely front-cover rectangle in the image — the single book cover that is the actual subject of the photo, distinguishing it from any other books, spines, or objects also visible in the frame.
2. Determine that rectangle's readable orientation (it may not match the orientation the image file arrives in). If this message tells you the teacher provided an explicit rotation correction, treat that as a stronger, more reliable signal of the intended viewing orientation than whatever you would otherwise infer from the pixels alone — apply it rather than overriding it with your own guess.
3. Mentally rotate/re-orient your reading of that rectangle as needed so the title and author text read normally, left to right.
4. Only then read the cover's visible text and artwork.

=== SECTION 1: "coverEvidence" — STRICT, FACTUAL, VISIBLE-ONLY ===

ONLY report information you can actually see printed on the cover in the photograph. Report a field as null when the cover does not clearly show it.

Do NOT invent or guess, in coverEvidence:
- an ISBN that is not visibly printed on the cover
- a publication year
- an exact edition
- a page count
- the interior illustration medium (the cover alone does not prove this)
- an age range
- a read-aloud duration
- publisher metadata not visible on the cover itself

The image is evidence, not permission to guess. Rotation, skew, an off-angle shot, or background clutter are normal photo conditions to work through, not reasons by themselves to report low confidence — reserve low confidence and null fields for when the cover's own text is genuinely blurry, obscured, in an unfamiliar script, or otherwise actually unclear once correctly oriented.

=== SECTION 2: "aiSuggestions" — USEFUL, EXPLICITLY INFERENTIAL CATALOG ASSISTANCE ===

This section is DIFFERENT from coverEvidence. Its whole purpose is to save a busy teacher real cataloging work by preparing a genuinely useful draft — not to prove facts. You ARE expected to make a useful best-effort suggestion with a confidence level whenever there is reasonable evidence, even though the cover alone does not literally prove the answer. You may use: the title and author you just read, the cover artwork/photography style, your own general knowledge of a confidently identified real book, trusted bibliographic context if any is provided separately, and reasonable pedagogical judgment for a children's/school library. Reserve null/unknown for aiSuggestions fields ONLY when there is genuinely not enough basis to make a useful suggestion (e.g., the book could not be identified at all) — do not default to null merely because the cover doesn't literally spell out the answer.

- "description": 1-2 short, plain sentences — what the book is about and why a teacher might search for it. Never marketing language, never "beloved classic," never exaggerated praise, never an unsupported educational claim.
- "tags": about 4-8 short, normalized, lowercase discovery concepts — topics, themes, social-emotional or curriculum concepts where relevant, singular where natural, no near-duplicates.
- "fictionType": your best-supported guess ("fiction" or "nonfiction"), or null only if genuinely unclear even for a confidently identified book.
- "format": your best-supported guess from the given options, or null only if genuinely unclear.
- "ageMinMonths"/"ageMaxMonths": a broad, practical preschool/library age RECOMMENDATION in months (not a publisher fact) — prefer a reasonable broad range over null when the book type/content gives you a real basis to estimate one.
- "readAloudMinutes": a reasonable estimate based on the likely book type/length (e.g. a short picture book vs. a longer one) — a recommendation, not a measured fact.
- "visualMediaTypes"/"visualRealism": infer from the visible cover art/photography when it's reasonably representative of the book's overall visual style — a front cover alone does not prove the INTERIOR pages' medium, so prefer an empty/null answer only when the cover genuinely gives no usable signal, not merely because it's not 100% certain.
- "physicalCategorySlug": choose EXACTLY ONE slug from this exact list — the most practical real shelf placement for this book — or null ONLY when no listed category is reasonably appropriate. You may never invent a category or return a slug not in this list:
${categoryList}
- "categoryConfidence"/"categoryReason": your honest confidence in the category choice and a short reason.

Restated plainly: coverEvidence must never invent a bibliographic fact. aiSuggestions, by contrast, is EXPECTED to make a useful pedagogical/catalog suggestion whenever there is reasonable evidence — an empty aiSuggestions section for a book you could clearly identify is not the safe choice, it is a wasted opportunity to help the teacher.`;
}

/**
 * Real-cover correction pass (final round, §1) — when the teacher's manual
 * rotation could NOT be physically applied to the analysis bytes (real HEIC/HEIF
 * sources this deployment can't decode/rotate), the rotation is instead surfaced
 * here as explicit per-request text, never silently dropped. Only appended when a
 * hint is actually present and non-zero; the base instruction text is unchanged
 * otherwise, so this never regresses the JPEG/PNG/WebP path (which already
 * physically rotates the bytes and needs no hint at all).
 */
function buildAnalyzeCoverPromptText(teacherRotationHintDegrees: CoverIdentificationInput["teacherRotationHintDegrees"]): string {
  const base = "Analyze this book cover photo and produce both coverEvidence and aiSuggestions as instructed.";
  if (!teacherRotationHintDegrees) return base;
  return `${base}\n\nExplicit teacher-provided orientation correction: the teacher visually inspected this exact photo and indicated it should be interpreted with an additional ${teacherRotationHintDegrees}-degree clockwise rotation applied before reading. This image format could not be automatically pixel-rotated, so the bytes you are given are NOT already rotated — apply this correction yourself when determining the cover's readable orientation. Treat this as a stronger, more reliable signal of the intended viewing orientation than your own automatic inference from the pixels alone.`;
}

export class GeminiBookIntelligenceProvider implements BookVisionProvider {
  private readonly client: GoogleGenAI;

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new AIProviderError("configuration_missing", "GEMINI_API_KEY is not set.");
    }
    this.client = new GoogleGenAI({ apiKey });
  }

  async analyzeCover(input: CoverIdentificationInput): Promise<CoverAnalysisResult> {
    if (input.imageBytes.length === 0) {
      throw new AIProviderError("invalid_image", "The image has no bytes to analyze.");
    }

    const promptText = buildAnalyzeCoverPromptText(input.teacherRotationHintDegrees);

    const raw = await this.callWithTimeout(
      () =>
        withGeminiRetry(() =>
          this.client.models.generateContent({
            model: MODEL_ID,
            contents: [
              {
                role: "user",
                parts: [
                  { text: promptText },
                  { inlineData: { mimeType: input.mimeType, data: input.imageBytes.toString("base64") } },
                ],
              },
            ],
            config: {
              systemInstruction: buildCombinedAnalysisSystemInstruction(input.activeCategories),
              responseMimeType: "application/json",
              responseSchema: COMBINED_ANALYSIS_JSON_SCHEMA,
            },
          })
        ),
      ANALYSIS_TIMEOUT_MS
    );

    const result = this.parseCombinedAnalysis(raw.text);
    if (raw.usageMetadata) {
      result.usage = {
        promptTokens: raw.usageMetadata.promptTokenCount ?? 0,
        candidateTokens: raw.usageMetadata.candidatesTokenCount ?? 0,
        totalTokens: raw.usageMetadata.totalTokenCount ?? 0,
      };
    }
    return result;
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

  /**
   * Parses the combined response, but deliberately does NOT validate it as one
   * atomic object (AI-first catalog draft correction, §5/§13): `coverEvidence` is a
   * hard requirement (matches the old `identifyCover` failure behavior exactly —
   * a malformed/missing `coverEvidence` still throws `invalid_response`), but a
   * malformed `aiSuggestions` section alone falls back to
   * `EMPTY_AI_SUGGESTIONS` rather than discarding an otherwise-good identification.
   * "Preserve what it did provide" (the phase brief's own words) would be violated
   * by validating the whole object as one schema, since Zod fails an entire object
   * on any single nested field's schema violation.
   *
   * `aiSuggestionsStatus` (AI draft human-correction semantics, final round §4)
   * records which of those two cases actually happened — never inferred from
   * `aiSuggestions`' own content, since a genuinely valid but all-null/empty
   * suggestion (the model examined the cover and had nothing to add) must still
   * read as `"valid"`, not be confused with the schema-failure fallback.
   */
  private parseCombinedAnalysis(text: string | undefined): CoverAnalysisResult {
    if (!text) {
      throw new AIProviderError("invalid_response", "Gemini returned no text content (analyzeCover).");
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch (error) {
      throw new AIProviderError("invalid_response", "Gemini's response was not valid JSON (analyzeCover).", error);
    }

    const record = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
    const coverEvidenceResult = CoverIdentificationSchema.safeParse(record.coverEvidence);
    if (!coverEvidenceResult.success) {
      throw new AIProviderError("invalid_response", "Gemini's response did not match the expected schema (analyzeCover).", coverEvidenceResult.error);
    }

    const aiSuggestionsResult = EnrichmentSuggestionSchema.safeParse(record.aiSuggestions);
    const aiSuggestions = aiSuggestionsResult.success ? aiSuggestionsResult.data : EMPTY_AI_SUGGESTIONS;

    return {
      coverEvidence: coverEvidenceResult.data,
      aiSuggestions,
      aiSuggestionsStatus: aiSuggestionsResult.success ? "valid" : "unavailable",
    };
  }
}
