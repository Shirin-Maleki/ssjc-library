import { z } from "zod";

/**
 * Zod schemas for both Gemini generation tasks (Phase 7, §8/§20 of the phase brief).
 * Each schema serves two purposes from one definition: `z.toJSONSchema()` (native to
 * this project's Zod 4) builds the `responseSchema` object sent to Gemini
 * (`geminiProvider.ts`), and the same schema then validates the actual response —
 * schema-valid output from the model still requires real semantic validation before
 * being trusted (§8: "Schema-valid output still requires semantic validation").
 *
 * `AIConfidenceLevel` is deliberately scoped per-task, not one universal "AI
 * confidence" reused everywhere (§16/§20 of the phase brief) — this file defines it
 * once because vision evidence and enrichment suggestions both genuinely need the
 * same three-value shape, not because every future confidence concept should reuse
 * it. Identity *reconciliation* confidence (`src/lib/intake/reconciliation.ts`) is a
 * separate, independently-computed concept from deterministic evidence matching, not
 * this value.
 */
export const AIConfidenceLevelSchema = z.enum(["high", "medium", "low"]);
export type AIConfidenceLevel = z.infer<typeof AIConfidenceLevelSchema>;

/**
 * The first Gemini task's output — evidence extraction, not catalog completion
 * (§8). Every bibliographic field is honestly nullable: a real front cover often
 * doesn't show a subtitle, an ISBN, illustrators, or a series name, and the system
 * instruction (`geminiProvider.ts`) explicitly forbids inventing any of them.
 * `candidateSearchTerms` (never more than 5) feeds `src/lib/metadataProviders/`'s
 * bounded provider search — not a place for the model to editorialize.
 */
export const CoverIdentificationSchema = z.object({
  visibleTitle: z.string().min(1).max(300).nullable(),
  visibleSubtitle: z.string().min(1).max(300).nullable(),
  visibleAuthors: z.array(z.string().min(1).max(150)).max(6).nullable(),
  visibleIllustrators: z.array(z.string().min(1).max(150)).max(6).nullable(),
  visiblePublisherOrImprint: z.string().min(1).max(200).nullable(),
  /** The language as it appears to the model from the cover's own text/script — free
   * text, not yet reconciled against the ISO 639-1 registry (`src/lib/intake/`'s
   * reconciliation step does that; a model guessing at a code directly would be a
   * needless extra place to get it wrong). */
  visibleLanguage: z.string().min(1).max(60).nullable(),
  visibleIsbn: z.string().min(4).max(20).nullable(),
  visibleSeries: z.string().min(1).max(200).nullable(),
  candidateSearchTerms: z.array(z.string().min(1).max(120)).max(5),
  identityConfidenceLevel: AIConfidenceLevelSchema,
  /** A short, concrete note about what evidence was/wasn't visible — never a place
   * for invented facts, only an honest account of what the cover actually showed. */
  evidenceNotes: z.string().max(600),
});
export type CoverIdentification = z.infer<typeof CoverIdentificationSchema>;

/**
 * The second Gemini task's output — enrichment, run only after identity
 * reconciliation has established a reasonable book candidate (§20). Every field is
 * optional/nullable by design (§20: "correct absence is better than plausible
 * invention") — nothing here is required for a book to save successfully
 * (`src/lib/intake/persistence.ts` §32's minimum-data rule never depends on any of
 * these). `physicalCategorySlug` is a plain string here, not a dynamic enum of the
 * currently-active categories — Gemini is *told* the allowed set in the prompt
 * (`geminiProvider.ts`), but the real enforcement that it "may NOT invent a
 * category" is an application-level check
 * (`src/lib/intake/categorySuggestion.ts`) against the live active list, never
 * trust in the model alone.
 */
/**
 * The one canonical cap on `EnrichmentSuggestion.tags` — exported so
 * `src/lib/intake/enrichmentMerge.ts`'s provider-subject merge can enforce the
 * exact same limit instead of hard-coding a second number that can silently drift
 * from this schema (a real Phase 7 bug: the merge once used its own `MAX_TAGS = 10`,
 * so a subject-heavy accepted candidate could merge past this schema's max(8) and
 * fail `parseIntakeDraft()`'s validation at save time).
 */
export const MAX_ENRICHMENT_TAGS = 8;

export const EnrichmentSuggestionSchema = z.object({
  description: z.string().min(1).max(400).nullable(),
  tags: z.array(z.string().min(1).max(40)).max(MAX_ENRICHMENT_TAGS),
  fictionType: z.enum(["fiction", "nonfiction"]).nullable(),
  format: z
    .enum(["board_book", "picture_book", "early_reader", "chapter_book", "informational_reference", "activity_book", "other"])
    .nullable(),
  ageMinMonths: z.number().int().min(0).max(216).nullable(),
  ageMaxMonths: z.number().int().min(0).max(216).nullable(),
  readAloudMinutes: z.number().min(0).max(90).nullable(),
  visualMediaTypes: z
    .array(
      z.enum(["photography", "watercolor", "collage", "digital_illustration", "pencil", "ink", "painted", "mixed_media", "graphic_vector"])
    )
    .max(3),
  visualRealism: z.enum(["real_photography", "realistic_illustration", "stylized_illustration", "cartoon", "abstract", "mixed"]).nullable(),
  physicalCategorySlug: z.string().min(1).max(100).nullable(),
  categoryConfidence: AIConfidenceLevelSchema.nullable(),
  categoryReason: z.string().max(300).nullable(),
});
export type EnrichmentSuggestion = z.infer<typeof EnrichmentSuggestionSchema>;

/**
 * The single combined multimodal analysis response (AI-first catalog draft
 * correction, §3) — replaces the original two-sequential-Gemini-call pipeline
 * (one for `CoverIdentificationSchema` evidence, a second for
 * `EnrichmentSuggestionSchema` suggestions) with one request that returns both,
 * separately validated. This halves the default per-book Gemini call count and
 * removes a real, observed fragility: the enrichment call is what most often hit
 * this project's very small (20/day) free-tier quota second, silently leaving a
 * teacher with a near-empty confirmation screen even when identification itself
 * had already succeeded.
 *
 * `coverEvidence` keeps its existing strict, visible-only-evidence contract
 * unchanged. `aiSuggestions` reuses `EnrichmentSuggestionSchema` as-is — it was
 * already shaped correctly for this purpose — but is now explicitly understood as
 * genuinely inferential, teacher-labor-saving catalog assistance (`ai_inferred`
 * provenance), never claimed as a publisher fact. See `geminiProvider.ts`'s
 * `analyzeCover()` for why these two sections are validated independently rather
 * than as one atomic object: a malformed `aiSuggestions` section must never
 * discard an otherwise-valid `coverEvidence` extraction.
 */
export const CombinedCoverAnalysisSchema = z.object({
  coverEvidence: CoverIdentificationSchema,
  aiSuggestions: EnrichmentSuggestionSchema,
});
export type CombinedCoverAnalysis = z.infer<typeof CombinedCoverAnalysisSchema>;

/** A genuinely empty suggestions object — used when `aiSuggestions` fails its own
 * schema validation but `coverEvidence` is still valid, so a partial real result is
 * never discarded wholesale (AI-first catalog draft correction, §5). Every field
 * absent/null is honest here: it means "no suggestion could be salvaged," not "AI
 * decided there was nothing to suggest." */
export const EMPTY_AI_SUGGESTIONS: EnrichmentSuggestion = {
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
