import { isLanguageCode } from "@/lib/catalog/languages";
import { hasPatchField, type AdminMetadataPatch } from "./adminPatch";
import type { TeacherEdits } from "@/lib/intake/draft";

/**
 * Phase 8 correction pass — runtime validation for admin mutation boundaries
 * (§9). TypeScript types are erased at runtime; a Server Action is directly
 * invokable with any JSON body regardless of what the UI happens to send. This
 * module is the one place both `updateBookMetadata()`'s patch and
 * `approveReviewLater()`'s edits are checked before ANY database write —
 * deliberately small and focused, not a general schema-validation framework.
 *
 * The specific bug this closes: `{ title: null }` or `{ languageCode: null }`
 * used to pass straight through to `resolveProvenanceForPatch`/the update
 * builder — the update silently ignored the null (title/language are required
 * columns) while STILL recording a `human_corrected` provenance row, a false
 * claim that a correction happened when the value never actually changed.
 * Now: an explicit attempt to clear title/language is rejected outright,
 * before any provenance decision or database write.
 */
export interface ValidationFailure {
  ok: false;
  error: "invalid_input";
  message: string;
}

const AGE_MIN_MONTHS = 0;
const AGE_MAX_MONTHS = 216;
const MAX_READ_ALOUD_MINUTES = 500;

const FORMAT_VALUES = new Set(["board_book", "picture_book", "early_reader", "chapter_book", "informational_reference", "activity_book", "other"]);
const FICTION_VALUES = new Set(["fiction", "nonfiction"]);
const VISUAL_REALISM_VALUES = new Set(["real_photography", "realistic_illustration", "stylized_illustration", "cartoon", "abstract", "mixed"]);
const VISUAL_MEDIA_VALUES = new Set(["photography", "watercolor", "collage", "digital_illustration", "pencil", "ink", "painted", "mixed_media", "graphic_vector"]);

function fail(message: string): ValidationFailure {
  return { ok: false, error: "invalid_input", message };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isStringArrayOfNonEmpty(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string" && v.trim().length > 0);
}

function validateAgeRange(ageMin: number | null | undefined, ageMax: number | null | undefined): string | undefined {
  if (ageMin != null && (!Number.isInteger(ageMin) || ageMin < AGE_MIN_MONTHS || ageMin > AGE_MAX_MONTHS)) {
    return `Age from must be a whole number of months between ${AGE_MIN_MONTHS} and ${AGE_MAX_MONTHS}.`;
  }
  if (ageMax != null && (!Number.isInteger(ageMax) || ageMax < AGE_MIN_MONTHS || ageMax > AGE_MAX_MONTHS)) {
    return `Age to must be a whole number of months between ${AGE_MIN_MONTHS} and ${AGE_MAX_MONTHS}.`;
  }
  if (ageMin != null && ageMax != null && ageMin > ageMax) {
    return "Age from cannot be greater than age to.";
  }
  return undefined;
}

/** Shared identity/classification checks common to both the admin metadata
 * patch and a Review Later approval's teacher-edits-shaped corrections —
 * title/language may never be explicitly cleared (both are required columns);
 * a category slug, if present, may never be explicitly cleared to null either
 * (the existing insufficient-data error is what should surface for "no
 * category at all," never a silently-ignored clear). */
function validateCommonIdentityFields(edits: {
  title?: string | null;
  languageCode?: string | null;
  physicalCategorySlug?: string | null;
  ageMinMonths?: number | null;
  ageMaxMonths?: number | null;
  fictionType?: string | null;
  format?: string | null;
}): ValidationFailure | undefined {
  if (hasPatchField(edits, "title")) {
    if (edits.title == null || !edits.title.trim()) return fail("A title is required and cannot be cleared.");
  }
  if (hasPatchField(edits, "languageCode")) {
    if (edits.languageCode == null) return fail("A language is required and cannot be cleared.");
    if (!isLanguageCode(edits.languageCode)) return fail("That is not a recognized language.");
  }
  if (hasPatchField(edits, "physicalCategorySlug")) {
    if (edits.physicalCategorySlug != null && !edits.physicalCategorySlug.trim()) return fail("Not a valid category selection.");
  }
  if (hasPatchField(edits, "fictionType") && edits.fictionType != null && !FICTION_VALUES.has(edits.fictionType)) {
    return fail("Not a recognized fiction/nonfiction value.");
  }
  if (hasPatchField(edits, "format") && edits.format != null && !FORMAT_VALUES.has(edits.format)) {
    return fail("Not a recognized format.");
  }
  if (hasPatchField(edits, "ageMinMonths") && edits.ageMinMonths != null && (!Number.isInteger(edits.ageMinMonths) || edits.ageMinMonths < AGE_MIN_MONTHS || edits.ageMinMonths > AGE_MAX_MONTHS)) {
    return fail(`Age from must be a whole number of months between ${AGE_MIN_MONTHS} and ${AGE_MAX_MONTHS}.`);
  }
  if (hasPatchField(edits, "ageMaxMonths") && edits.ageMaxMonths != null && (!Number.isInteger(edits.ageMaxMonths) || edits.ageMaxMonths < AGE_MIN_MONTHS || edits.ageMaxMonths > AGE_MAX_MONTHS)) {
    return fail(`Age to must be a whole number of months between ${AGE_MIN_MONTHS} and ${AGE_MAX_MONTHS}.`);
  }
  return undefined;
}

/** Validates a Review Later approval's admin corrections (`TeacherEdits`
 * shape) — called before `resolveConfirmFields` ever runs. Age min/max
 * ordering is checked by the caller once both are resolved against the AI
 * suggestion (this function only checks each supplied bound's own range). */
export function validateApprovalEdits(edits: TeacherEdits): ValidationFailure | undefined {
  return validateCommonIdentityFields(edits);
}

/** Validates a general admin metadata patch — every field the admin editor
 * can send, checked before any provenance decision or database write. */
export function validateAdminMetadataPatch(
  patch: AdminMetadataPatch,
  existing: { ageMinMonths: number | null; ageMaxMonths: number | null }
): ValidationFailure | undefined {
  const commonFailure = validateCommonIdentityFields(patch);
  if (commonFailure) return commonFailure;

  if (hasPatchField(patch, "subtitle") && patch.subtitle != null && !isNonEmptyString(patch.subtitle)) {
    return fail("Subtitle cannot be a blank value — clear it instead.");
  }
  if (hasPatchField(patch, "authors") && patch.authors != null && !isStringArrayOfNonEmpty(patch.authors)) {
    return fail("Author names must be non-empty text.");
  }
  if (hasPatchField(patch, "illustrators") && patch.illustrators != null && !isStringArrayOfNonEmpty(patch.illustrators)) {
    return fail("Illustrator names must be non-empty text.");
  }
  if (hasPatchField(patch, "publisherName") && patch.publisherName != null && !isNonEmptyString(patch.publisherName)) {
    return fail("Publisher name cannot be a blank value — clear it instead.");
  }
  if (hasPatchField(patch, "tags") && patch.tags != null && !isStringArrayOfNonEmpty(patch.tags)) {
    return fail("Tags must be non-empty text.");
  }
  if (hasPatchField(patch, "readAloudMinutes") && patch.readAloudMinutes != null && (typeof patch.readAloudMinutes !== "number" || !Number.isFinite(patch.readAloudMinutes) || patch.readAloudMinutes < 0 || patch.readAloudMinutes > MAX_READ_ALOUD_MINUTES)) {
    return fail(`Read-aloud minutes must be between 0 and ${MAX_READ_ALOUD_MINUTES}.`);
  }
  if (hasPatchField(patch, "visualRealism") && patch.visualRealism != null && !VISUAL_REALISM_VALUES.has(patch.visualRealism)) {
    return fail("Not a recognized visual realism value.");
  }
  if (hasPatchField(patch, "visualMediaTypes") && patch.visualMediaTypes != null) {
    if (!Array.isArray(patch.visualMediaTypes) || patch.visualMediaTypes.some((v) => !VISUAL_MEDIA_VALUES.has(v))) {
      return fail("Not a recognized visual media/style value.");
    }
  }

  const effectiveAgeMin = hasPatchField(patch, "ageMinMonths") ? patch.ageMinMonths : existing.ageMinMonths;
  const effectiveAgeMax = hasPatchField(patch, "ageMaxMonths") ? patch.ageMaxMonths : existing.ageMaxMonths;
  const ageError = validateAgeRange(effectiveAgeMin, effectiveAgeMax);
  if (ageError) return fail(ageError);

  return undefined;
}

/** Category create/update input — a category name may never be blank, and a
 * displayOrder (when supplied) must be a real, reasonable integer. */
export function validateCategoryInput(input: { label?: string; displayOrder?: number }): ValidationFailure | undefined {
  if (input.label !== undefined && !input.label.trim()) return fail("A category name is required.");
  if (input.displayOrder !== undefined && (!Number.isInteger(input.displayOrder) || input.displayOrder < 0 || input.displayOrder > 32767)) {
    return fail("Display order must be a whole number between 0 and 32767.");
  }
  return undefined;
}

/** A taxonomy suggestion's confirmed label (approval) may never be blank. */
export function validateTaxonomyLabel(label: string): ValidationFailure | undefined {
  if (!label.trim()) return fail("A category name is required.");
  return undefined;
}
