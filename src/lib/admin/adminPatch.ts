import { hasEditField } from "@/lib/intake/confirmFieldResolution";
import { TRACKED_METADATA_FIELDS, type MetadataFieldKey } from "@/lib/metadata/fieldRegistry";
import type { Format, IllustrationStyle, VisualRealism } from "@/lib/catalog/types";

/**
 * Admin metadata patch semantics (Phase 8, §16) — the exact same presence-based
 * philosophy Phase 7's Quick Edit already established for teachers
 * (`src/lib/intake/confirmFieldResolution.ts`), extended to the admin editor's
 * broader field set. A field OMITTED from the patch object means "leave it alone";
 * a nullable field explicitly sent as `null` means "clear it"; a field sent with a
 * real value means "change it to this." `hasPatchField` (re-exported from the
 * intake module's own `hasEditField` — one shared implementation, not two) is what
 * makes "omitted" and "explicitly null" distinguishable, which plain `??` cannot
 * do. Centralized here rather than duplicated across each admin Server Action.
 */
export interface AdminMetadataPatch {
  title?: string | null;
  subtitle?: string | null;
  authors?: string[] | null;
  illustrators?: string[] | null;
  publisherName?: string | null;
  imprint?: string | null;
  languageCode?: string | null;
  isbn10?: string | null;
  isbn13?: string | null;
  description?: string | null;
  ageMinMonths?: number | null;
  ageMaxMonths?: number | null;
  fictionType?: "fiction" | "nonfiction" | null;
  format?: Format | null;
  readAloudMinutes?: number | null;
  visualMediaTypes?: IllustrationStyle[] | null;
  visualRealism?: VisualRealism | null;
  tags?: string[] | null;
  physicalCategorySlug?: string | null;
}

export const hasPatchField = hasEditField;

/** Maps each patchable field to the tracked provenance field key it affects, when
 * that field is provenance-tracked at all (`lib/metadata/fieldRegistry.ts`) — tags,
 * subtitle, illustrators, publisher/imprint details, and read-aloud minutes are
 * real editable fields with no dedicated provenance row today (matching the
 * existing registry's scope; never invented here). `authors` maps to the existing
 * `contributors` field key, matching how Phase 7 already tracks it. */
const PATCH_FIELD_TO_PROVENANCE_KEY: Partial<Record<keyof AdminMetadataPatch, MetadataFieldKey>> = {
  title: "title",
  authors: "contributors",
  publisherName: "publisher",
  isbn10: "isbn",
  isbn13: "isbn",
  languageCode: "language",
  physicalCategorySlug: "physical_category",
  ageMinMonths: "age_range",
  ageMaxMonths: "age_range",
  visualMediaTypes: "visual_media_type",
  visualRealism: "visual_realism",
  format: "format",
  fictionType: "fiction_status",
  description: "description",
};

export interface ProvenanceDecision {
  fieldKey: MetadataFieldKey;
  sourceType: "human_corrected" | "human_verified";
}

/**
 * Decides exactly which `book_field_provenance` rows an admin metadata save should
 * write (§17) — one `human_corrected` row per tracked field key actually present
 * in the patch (never one per raw column; `ageMinMonths`/`ageMaxMonths` both map to
 * the single `age_range` key, so changing both in one save still yields one
 * provenance row, not two), plus one `human_verified` row per field the admin
 * explicitly confirmed WITHOUT changing (`explicitlyVerifiedFields`) — e.g. a
 * "Keep current category" decision. A field can never be both in the same save:
 * `explicitlyVerifiedFields` entries that were ALSO patched are corrected, not
 * verified, since the admin's action was a change, not a confirmation.
 */
export function resolveProvenanceForPatch(patch: AdminMetadataPatch, explicitlyVerifiedFields: MetadataFieldKey[] = []): ProvenanceDecision[] {
  const correctedKeys = new Set<MetadataFieldKey>();
  for (const [patchField, provenanceKey] of Object.entries(PATCH_FIELD_TO_PROVENANCE_KEY) as [keyof AdminMetadataPatch, MetadataFieldKey][]) {
    if (hasPatchField(patch, patchField)) {
      correctedKeys.add(provenanceKey);
    }
  }

  const decisions: ProvenanceDecision[] = [...correctedKeys].map((fieldKey) => ({ fieldKey, sourceType: "human_corrected" as const }));

  for (const fieldKey of explicitlyVerifiedFields) {
    if (!correctedKeys.has(fieldKey)) {
      decisions.push({ fieldKey, sourceType: "human_verified" });
    }
  }

  return decisions;
}

export { TRACKED_METADATA_FIELDS };
