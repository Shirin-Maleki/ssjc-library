import { pgEnum } from "drizzle-orm/pg-core";

/**
 * Every Postgres enum in this schema, per docs/DATA_MODEL.md — used only for the
 * small, stable state classifications Phase 0 explicitly called out as real enum
 * candidates (§26 of the Phase 4 brief). Evolving vocabularies (tag names, provenance
 * field keys) are deliberately NOT enums here — see `books.ts`'s `bookFieldProvenance`
 * table and `tags.ts` for where a centralized app-level registry is used instead.
 */

export const fictionStatusEnum = pgEnum("fiction_status", ["fiction", "nonfiction", "unknown_mixed"]);

export const readDurationBandEnum = pgEnum("read_duration_band", ["under_5", "five_to_ten", "ten_plus"]);

export const formatEnum = pgEnum("format", [
  "board_book",
  "picture_book",
  "early_reader",
  "chapter_book",
  "informational_reference",
  "activity_book",
  "other",
]);

export const physicalSizeExceptionEnum = pgEnum("physical_size_exception", ["regular", "board_small", "oversized_big"]);

/**
 * Corrected from Phase 0's singular `visual_media_type` column to an array-typed
 * column of this same enum — see docs/DECISIONS.md, "Visual metadata: illustration
 * style becomes an array column, not a singular field." A book's real, working
 * illustration-style search (docs/SEARCH.md) has always needed more than one value
 * per book (e.g. "collage" + "painted"); this enum itself is unchanged from Phase 0.
 */
export const visualMediaTypeEnum = pgEnum("visual_media_type", [
  "photography",
  "watercolor",
  "collage",
  "digital_illustration",
  "pencil",
  "ink",
  "painted",
  "mixed_media",
  "graphic_vector",
  "other",
  "unknown",
]);

/**
 * `stylized_illustration` here (Phase 0's draft wording was `stylized`) — corrected to
 * match the value Phase 2's already-approved, already-tested UI and search code
 * actually uses (`VISUAL_REALISM_LABELS`, `docs/SEARCH.md`'s intent parsing). See
 * docs/DECISIONS.md for the full reasoning; this is a naming correction only, not a
 * new concept.
 */
export const visualRealismEnum = pgEnum("visual_realism", [
  "real_photography",
  "realistic_illustration",
  "stylized_illustration",
  "cartoon",
  "abstract",
  "mixed",
  "unknown",
]);

export const coverSourceTypeEnum = pgEnum("cover_source_type", ["teacher_upload", "bulk_import", "external_thumbnail"]);

export const displayCoverSourceEnum = pgEnum("display_cover_source", [
  "derived_from_drive",
  "external_provider_thumbnail",
  "drive_proxy_fallback",
]);

export const reviewStatusEnum = pgEnum("review_status", ["pending_review", "active", "archived"]);

export const availabilityStatusEnum = pgEnum("availability_status", ["on_shelf", "in_classroom", "unknown"]);

export const contributorRoleEnum = pgEnum("contributor_role", ["author", "illustrator", "photographer", "translator"]);

/**
 * `cover_visible` added in Phase 7 (`docs/DECISIONS.md`) — a fact genuinely readable
 * off the photographed front cover itself (e.g. a title printed on the cover, read
 * directly), distinct from `ai_inferred` (a value AI *guessed* from context, not
 * directly evidenced) and `external_provider` (a bibliographic API's own field).
 * Never applied to a value AI merely looked at the image to infer — only to a value
 * the cover genuinely, visibly states. See `docs/AI_PIPELINE.md` §"Evidence
 * boundary."
 */
export const provenanceSourceTypeEnum = pgEnum("provenance_source_type", [
  "external_provider",
  "ai_inferred",
  "cover_visible",
  "human_corrected",
  "human_verified",
]);

export const confidenceLevelEnum = pgEnum("confidence_level", ["high", "medium", "low"]);

export const duplicateRelationshipTypeEnum = pgEnum("duplicate_relationship_type", [
  "exact_copy_same_edition",
  "same_title_different_edition",
  "same_work_different_language",
  "false_match",
  "unresolved",
]);

export const duplicateDetectedByEnum = pgEnum("duplicate_detected_by", [
  "image_hash",
  "isbn_match",
  "title_author_match",
  "admin_manual",
]);

export const duplicateStatusEnum = pgEnum("duplicate_status", ["pending", "confirmed", "rejected"]);

export const reviewFlagTypeEnum = pgEnum("review_flag_type", [
  "user_flagged",
  "low_identification_confidence",
  "duplicate_uncertain",
  "metadata_conflict",
  "category_uncertain",
  "missing_metadata",
  "visual_style_uncertain",
  "import_error",
  "teacher_requested_review",
]);

export const reviewFlagStatusEnum = pgEnum("review_flag_status", ["open", "resolved", "dismissed"]);

export const taxonomySuggestionStatusEnum = pgEnum("taxonomy_suggestion_status", [
  "pending",
  "approved",
  "rejected",
  "merged",
  "postponed",
]);

export const ingestionJobTypeEnum = pgEnum("ingestion_job_type", ["single_add", "bulk_import", "reimport"]);

export const ingestionJobStatusEnum = pgEnum("ingestion_job_status", [
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
]);

export const ingestionSourceEnum = pgEnum("ingestion_source", ["teacher_capture", "admin_bulk_drive"]);

export const ingestionItemStatusEnum = pgEnum("ingestion_item_status", [
  "pending",
  "processing",
  "completed",
  "needs_review",
  "failed",
  "skipped_duplicate",
]);

export const sheetSyncStatusEnum = pgEnum("sheet_sync_status", ["pending", "synced", "failed"]);

/** Tag "families" — see docs/DATA_MODEL.md §12 and the Phase 4 brief §14's examples.
 * A real, stable, small classification (unlike the tag *names* themselves, which are
 * an open, evolving vocabulary and deliberately not an enum). */
export const tagFamilyEnum = pgEnum("tag_family", [
  "topic",
  "theme",
  "social_emotional",
  "curriculum",
  "concept",
  "visual_subject",
  "seasonal",
  "featured",
]);
