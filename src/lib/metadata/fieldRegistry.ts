import { z } from "zod";

/**
 * The centralized application registry `docs/DATA_MODEL.md` §6 describes —
 * `book_field_provenance.field_key` is deliberately plain `text` in Postgres, not a
 * database enum, specifically so this list (which fields have tracked
 * provenance/confidence) can grow as a code change, never a migration. This module is
 * the single source of truth for that vocabulary; nothing else should hard-code a
 * `field_key` string literal.
 *
 * Grouped by concept (identity/category/age/visual/general metadata) matching the
 * enrichment pipeline described in `docs/ARCHITECTURE.md` §11 (vision identification →
 * metadata reconciliation → category suggestion → confidence scoring) — a focused set
 * of the fields that pipeline actually determines, not a speculative field-by-field
 * enumeration of every `books` column.
 */
export const TRACKED_METADATA_FIELDS = {
  title: "identity",
  contributors: "identity",
  publisher: "identity",
  isbn: "identity",
  physical_category: "category",
  age_range: "age",
  visual_media_type: "visual",
  visual_realism: "visual",
  format: "metadata",
  fiction_status: "metadata",
} as const;

export type MetadataFieldKey = keyof typeof TRACKED_METADATA_FIELDS;
export type MetadataFieldConcept = (typeof TRACKED_METADATA_FIELDS)[MetadataFieldKey];

export function isMetadataFieldKey(value: string): value is MetadataFieldKey {
  return Object.prototype.hasOwnProperty.call(TRACKED_METADATA_FIELDS, value);
}

/** For validating a `field_key` value at an application boundary (e.g. the Phase 7/8
 * enrichment pipeline writing a new `book_field_provenance` row) — a Zod schema
 * rather than a hand-rolled check, matching this project's existing validation
 * convention (`src/lib/validation/auth.ts`, `src/lib/catalog/languages.ts`). */
export const metadataFieldKeySchema = z
  .string()
  .refine(isMetadataFieldKey, { message: "Not a recognized tracked metadata field key." }) as z.ZodType<MetadataFieldKey>;

export function metadataFieldConcept(key: MetadataFieldKey): MetadataFieldConcept {
  return TRACKED_METADATA_FIELDS[key];
}
