import { z } from "zod";
import { CoverIdentificationSchema, EnrichmentSuggestionSchema } from "@/lib/ai/schemas";

/**
 * The versioned, validated Phase 7 intake draft (§3B, §31 of the phase brief) —
 * everything needed to RESUME a single-book intake without re-uploading or
 * re-running provider calls. Stored in `ingestion_items.intake_draft` (a plain
 * `jsonb` column — Postgres has no schema of its own to enforce here, so this
 * module's `IntakeDraftSchema` is the actual contract, validated on every write via
 * `parseIntakeDraft`/every read via `readIntakeDraft`).
 *
 * Explicit boundary (§3B/§42): this is a validated APPLICATION-DOMAIN draft, never
 * an arbitrary raw AI response dump. It never contains a secret, an image byte, or
 * a resumable Drive upload session URI (`driveSource` only ever holds the already-
 * durable Drive file id + safe metadata, never the ephemeral session used to create
 * it), and never persists verbose model chain-of-thought or raw AI prose — only the
 * already-schema-validated `CoverIdentification`/`EnrichmentSuggestion` structures
 * those provider calls already produce.
 */

/** Bumped whenever this shape changes in a way a stored draft might not match —
 * lets a future reader detect an old-shape draft rather than silently
 * misinterpreting it. */
export const INTAKE_DRAFT_SCHEMA_VERSION = 1;

export const PipelineStageSchema = z.enum([
  "uploaded",
  "identified",
  "metadata_looked_up",
  "reconciled",
  "duplicate_checked",
  "enriched",
  "ready_for_confirmation",
  "needs_review",
  "completed",
]);
export type PipelineStage = z.infer<typeof PipelineStageSchema>;

const DriveSourceSchema = z.object({
  fileId: z.string().min(1),
  filename: z.string().min(1),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().positive(),
  checksum: z.string().nullable(),
});

const MetadataCandidateRecordSchema = z.object({
  provider: z.enum(["google_books", "open_library"]),
  providerIdentifier: z.string(),
  title: z.string().optional(),
  subtitle: z.string().optional(),
  authors: z.array(z.string()).optional(),
  publisher: z.string().optional(),
  publishedDate: z.string().optional(),
  language: z.string().optional(),
  isbn10: z.string().optional(),
  isbn13: z.string().optional(),
  description: z.string().optional(),
  subjects: z.array(z.string()).optional(),
  thumbnailUrl: z.string().optional(),
  matchScore: z.number(),
  matchedSignals: z.array(z.string()),
});

const ProposedBookValuesSchema = z.object({
  title: z.string().nullable(),
  subtitle: z.string().nullable(),
  authors: z.array(z.string()),
  illustrators: z.array(z.string()),
  publisher: z.string().nullable(),
  languageCode: z.string().nullable(),
  additionalLanguageCodes: z.array(z.string()),
  isbn10: z.string().nullable(),
  isbn13: z.string().nullable(),
});

/** The limited, teacher-facing correction surface (§29 of the phase brief) — never
 * a full catalog form's worth of fields. */
const TeacherEditsSchema = z
  .object({
    title: z.string().nullable(),
    authors: z.array(z.string()).nullable(),
    languageCode: z.string().nullable(),
    physicalCategorySlug: z.string().nullable(),
    ageMinMonths: z.number().int().nullable(),
    ageMaxMonths: z.number().int().nullable(),
    fictionType: z.enum(["fiction", "nonfiction"]).nullable(),
    format: z
      .enum(["board_book", "picture_book", "early_reader", "chapter_book", "informational_reference", "activity_book", "other"])
      .nullable(),
  })
  .partial();
export type TeacherEdits = z.infer<typeof TeacherEditsSchema>;

const CategorySuggestionRecordSchema = z.object({
  slug: z.string(),
  label: z.string(),
  confidence: z.enum(["high", "medium", "low"]).nullable(),
  reason: z.string().nullable(),
});

export const DuplicateOutcomeSchema = z.enum([
  "no_match",
  "exact_copy_same_edition",
  "same_title_different_edition",
  "same_work_different_language",
  "ambiguous_similar_title",
]);

export const IntakeDraftSchema = z.object({
  schemaVersion: z.literal(INTAKE_DRAFT_SCHEMA_VERSION),
  pipelineStage: PipelineStageSchema,
  driveSource: DriveSourceSchema,
  coverEvidence: CoverIdentificationSchema.nullable(),
  metadataCandidates: z.array(MetadataCandidateRecordSchema).default([]),
  selectedCandidateProviderIdentifier: z.string().nullable(),
  reconciliationOutcome: z.enum(["high_confidence", "ambiguous", "unresolved"]).nullable(),
  proposedBookValues: ProposedBookValuesSchema.nullable(),
  duplicateOutcome: DuplicateOutcomeSchema.nullable(),
  duplicateCandidateBookIds: z.array(z.string()).default([]),
  enrichmentSuggestion: EnrichmentSuggestionSchema.nullable(),
  categorySuggestion: CategorySuggestionRecordSchema.nullable(),
  teacherEdits: TeacherEditsSchema.nullable(),
  reviewReason: z.string().nullable(),
});
export type IntakeDraft = z.infer<typeof IntakeDraftSchema>;

/** Validates a draft before it's ever written to `ingestion_items.intake_draft` —
 * the one place a malformed/incomplete draft is caught before persistence, not
 * after. */
export function parseIntakeDraft(value: unknown): IntakeDraft {
  return IntakeDraftSchema.parse(value);
}

/** Validates a draft read back from the database — returns `undefined` (never
 * throws) for a `null` column or a draft that doesn't match the current schema
 * version/shape, so a Review Later resume path degrades to "start a fresh intake"
 * rather than crashing on stale data. */
export function readIntakeDraft(value: unknown): IntakeDraft | undefined {
  if (value == null) return undefined;
  const result = IntakeDraftSchema.safeParse(value);
  return result.success ? result.data : undefined;
}

/** A fresh draft immediately after a confirmed Drive upload — the minimum real
 * state every intake starts from. */
export function createInitialDraft(driveSource: z.infer<typeof DriveSourceSchema>): IntakeDraft {
  return {
    schemaVersion: INTAKE_DRAFT_SCHEMA_VERSION,
    pipelineStage: "uploaded",
    driveSource,
    coverEvidence: null,
    metadataCandidates: [],
    selectedCandidateProviderIdentifier: null,
    reconciliationOutcome: null,
    proposedBookValues: null,
    duplicateOutcome: null,
    duplicateCandidateBookIds: [],
    enrichmentSuggestion: null,
    categorySuggestion: null,
    teacherEdits: null,
    reviewReason: null,
  };
}
