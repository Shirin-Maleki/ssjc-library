import type { TeacherEdits } from "./draft";
import type { EnrichmentSuggestion, CoverIdentification } from "@/lib/ai/schemas";
import type { ProvenanceInput } from "./persistence";

/**
 * AI draft human-correction semantics (final round, §1/§2/§3) — the exact
 * distinction a teacher's Quick Edit interaction must preserve all the way to
 * the database: a field ABSENT from `edits` means "the teacher never touched
 * this," so the AI/proposed value applies and provenance stays `ai_inferred`
 * (or `cover_visible` for title). A field PRESENT in `edits` — even with value
 * `null` — means the teacher explicitly set or cleared it, so exactly that
 * value applies (including `null`) and provenance becomes `human_corrected` /
 * `human_verified`. Plain `??` cannot make this distinction (it treats an
 * explicit `null` the same as "absent"), which is the real bug this module
 * fixes — extracted into its own pure, dependency-light module (mirrors
 * `candidateAcceptance.ts`/`visionFailureClassification.ts`/
 * `enrichmentMerge.ts`'s own reasoning from earlier passes) specifically so
 * this decision logic is directly unit-testable without a database connection
 * or staff session.
 */
export function hasEditField<T extends object, K extends keyof T>(edits: T | undefined, key: K): boolean {
  return edits != null && Object.prototype.hasOwnProperty.call(edits, key);
}

export interface ConfirmFieldResolutionInput {
  edits: TeacherEdits | undefined;
  proposedTitle: string | null | undefined;
  proposedLanguageCode: string | null | undefined;
  proposedAuthors: string[] | undefined;
  /** The AI/previously-established category slug carried from the confirm
   * screen (`ConfirmSaveInput.categorySlug`) — distinct from
   * `edits.physicalCategorySlug`, and used ONLY when the teacher never touched
   * the category field in Quick Edit at all. */
  fallbackCategorySlug: string | null | undefined;
  enrichment: EnrichmentSuggestion | null;
  coverEvidence: CoverIdentification | null;
  categorySuggestion: { slug: string; label: string; confidence: "high" | "medium" | "low" | null; reason: string | null } | null;
}

export interface ConfirmFieldResolution {
  title: string | null | undefined;
  languageCode: string | null | undefined;
  authors: string[];
  categorySlug: string | null | undefined;
  description: string | undefined;
  fictionType: NonNullable<EnrichmentSuggestion["fictionType"]> | undefined;
  format: NonNullable<EnrichmentSuggestion["format"]> | undefined;
  ageMinMonths: number | undefined;
  ageMaxMonths: number | undefined;
  provenance: ProvenanceInput[];
}

/**
 * Resolves every teacher-correctable confirm-screen field to its final saved
 * value AND the provenance row (if any) that value earns — the single place
 * this decision is made, so `confirmSaveAction` doesn't have to re-derive it
 * (and risk drifting back to a `??`-based bug) inline.
 *
 * Fields NOT covered here (isbn/subtitle/publisher provenance,
 * visual_media_type/visual_realism, display cover) have no Quick Edit surface
 * and are unaffected by this correction — they stay resolved directly in
 * `confirmSaveAction`.
 */
export function resolveConfirmFields(input: ConfirmFieldResolutionInput): ConfirmFieldResolution {
  const { edits, enrichment, coverEvidence, categorySuggestion } = input;
  const provenance: ProvenanceInput[] = [];

  const titleEdited = hasEditField(edits, "title");
  const title = titleEdited ? edits!.title : input.proposedTitle;
  if (titleEdited) {
    provenance.push({ fieldKey: "title", sourceType: "human_corrected" });
  } else if (coverEvidence?.visibleTitle) {
    provenance.push({ fieldKey: "title", sourceType: "cover_visible", confidenceLevel: coverEvidence.identityConfidenceLevel });
  }

  const languageEdited = hasEditField(edits, "languageCode");
  const languageCode = languageEdited ? edits!.languageCode : input.proposedLanguageCode;

  const authorsEdited = hasEditField(edits, "authors");
  const authors = authorsEdited ? (edits!.authors ?? []) : (input.proposedAuthors ?? []);

  const categoryEdited = hasEditField(edits, "physicalCategorySlug");
  const categorySlug = categoryEdited ? edits!.physicalCategorySlug : input.fallbackCategorySlug;
  if (categoryEdited) {
    provenance.push({ fieldKey: "physical_category", sourceType: "human_verified" });
  } else if (categorySuggestion) {
    provenance.push({ fieldKey: "physical_category", sourceType: "ai_inferred", confidenceLevel: categorySuggestion.confidence ?? undefined });
  }

  const descriptionEdited = hasEditField(edits, "description");
  const description = descriptionEdited ? (edits!.description ?? undefined) : (enrichment?.description ?? undefined);
  if (descriptionEdited) {
    provenance.push({ fieldKey: "description", sourceType: "human_corrected" });
  } else if (enrichment?.description) {
    provenance.push({ fieldKey: "description", sourceType: "ai_inferred" });
  }

  const fictionEdited = hasEditField(edits, "fictionType");
  const fictionType = fictionEdited ? (edits!.fictionType ?? undefined) : (enrichment?.fictionType ?? undefined);
  if (fictionEdited) {
    provenance.push({ fieldKey: "fiction_status", sourceType: "human_corrected" });
  } else if (enrichment?.fictionType) {
    provenance.push({ fieldKey: "fiction_status", sourceType: "ai_inferred" });
  }

  const formatEdited = hasEditField(edits, "format");
  const format = formatEdited ? (edits!.format ?? undefined) : (enrichment?.format ?? undefined);
  if (formatEdited) {
    provenance.push({ fieldKey: "format", sourceType: "human_corrected" });
  } else if (enrichment?.format) {
    provenance.push({ fieldKey: "format", sourceType: "ai_inferred" });
  }

  const ageMinEdited = hasEditField(edits, "ageMinMonths");
  const ageMaxEdited = hasEditField(edits, "ageMaxMonths");
  const ageMinMonths = ageMinEdited ? (edits!.ageMinMonths ?? undefined) : (enrichment?.ageMinMonths ?? undefined);
  const ageMaxMonths = ageMaxEdited ? (edits!.ageMaxMonths ?? undefined) : (enrichment?.ageMaxMonths ?? undefined);
  if (ageMinEdited || ageMaxEdited) {
    provenance.push({ fieldKey: "age_range", sourceType: "human_corrected" });
  } else if (enrichment?.ageMinMonths != null || enrichment?.ageMaxMonths != null) {
    provenance.push({ fieldKey: "age_range", sourceType: "ai_inferred" });
  }

  return { title, languageCode, authors, categorySlug, description, fictionType, format, ageMinMonths, ageMaxMonths, provenance };
}
