/**
 * Deterministic "missing useful metadata" detection (Phase 8, §6/§45 of the phase
 * brief) — deliberately not an opaque numeric "quality score." Every book either has
 * or lacks each of a small, fixed set of genuinely useful (never required) fields;
 * this module just names which ones are missing, in plain language, so an admin
 * reviewing the queue sees "Missing age range, format, and visual style" rather than
 * a mysterious percentage. Reused by both the review-queue aggregator
 * (`reviewQueue.ts`) and the review detail screen, so there is exactly one
 * implementation of "what counts as missing" — never two independently-drifting
 * checks of the same five fields.
 */

export type MissingMetadataField = "contributors" | "description" | "age_range" | "format" | "visual_style";

export interface CompletenessInput {
  hasContributors: boolean;
  hasDescription: boolean;
  hasAgeRange: boolean;
  hasFormat: boolean;
  hasVisualStyle: boolean;
}

const FIELD_ORDER: MissingMetadataField[] = ["contributors", "description", "age_range", "format", "visual_style"];

const FIELD_LABELS: Record<MissingMetadataField, string> = {
  contributors: "authors/illustrators",
  description: "description",
  age_range: "age range",
  format: "format",
  visual_style: "visual style",
};

const FIELD_CHECKS: Record<MissingMetadataField, (input: CompletenessInput) => boolean> = {
  contributors: (input) => !input.hasContributors,
  description: (input) => !input.hasDescription,
  age_range: (input) => !input.hasAgeRange,
  format: (input) => !input.hasFormat,
  visual_style: (input) => !input.hasVisualStyle,
};

/** Returns the missing fields in a fixed, stable order — never dependent on object
 * key iteration order, so the resulting sentence is deterministic across calls. */
export function computeMissingMetadataFields(input: CompletenessInput): MissingMetadataField[] {
  return FIELD_ORDER.filter((field) => FIELD_CHECKS[field](input));
}

/** Renders a plain-language sentence fragment — `null` when nothing is missing (a
 * caller checks this before deciding whether to surface a "missing metadata" reason
 * at all). Uses a standard English list join (Oxford comma at 3+ items, "and" at
 * exactly 2, the bare label at 1) — e.g. "Missing age range, format, and visual
 * style" for three fields, matching the phase brief's own example verbatim. */
export function describeMissingMetadata(fields: MissingMetadataField[]): string | null {
  if (fields.length === 0) return null;
  const labels = fields.map((f) => FIELD_LABELS[f]);
  if (labels.length === 1) return `Missing ${labels[0]}`;
  if (labels.length === 2) return `Missing ${labels[0]} and ${labels[1]}`;
  return `Missing ${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
}
