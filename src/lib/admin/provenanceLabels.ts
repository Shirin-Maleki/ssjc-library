/**
 * Final closure pass (§5/§6) — restrained, human-readable labels for
 * provenance/confidence and saved metadata-provider candidates in Admin
 * Review. Pure and dependency-light (no DB, no session) so the exact mapping
 * is directly unit-testable. Never leads with a raw table name, enum value,
 * UUID, or a confidence decimal — the whole point of this module is to be the
 * one place that translation happens, instead of leaking `book_field_provenance`
 * internals into the UI ad hoc.
 */

export type ProvenanceSourceType = "external_provider" | "ai_inferred" | "cover_visible" | "human_corrected" | "human_verified";
export type ConfidenceLevel = "high" | "medium" | "low" | null;

const SOURCE_LABELS: Record<ProvenanceSourceType, string> = {
  external_provider: "From Open Library",
  cover_visible: "From cover",
  ai_inferred: "AI suggested",
  human_corrected: "Corrected by staff",
  human_verified: "Verified by staff",
};

/** `sourceLabel` (a free-text column, e.g. a specific provider name) is
 * preferred when present — "From Google Books" instead of the generic
 * Open-Library-shaped default — so this module never claims a specific
 * provider that isn't actually what happened. */
export function describeProvenanceSource(sourceType: ProvenanceSourceType, sourceLabel?: string | null): string {
  if (sourceType === "external_provider" && sourceLabel) return `From ${sourceLabel}`;
  return SOURCE_LABELS[sourceType] ?? sourceType;
}

/** Never a raw decimal — "Needs review" covers both a genuinely low
 * confidence value and the absence of a recorded confidence level at all
 * (most `human_corrected`/`human_verified` rows never get one, and treating
 * "no level recorded" as anything but "needs a look" would be a fabrication). */
export function describeConfidence(level: ConfidenceLevel): string {
  if (level === "high") return "High";
  if (level === "medium") return "Medium";
  return "Needs review";
}

const PROVIDER_LABELS: Record<string, string> = {
  open_library: "Open Library",
  google_books: "Google Books",
};

export function describeProvider(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider;
}

/** Plain field names for the `book_field_provenance.field_key` vocabulary
 * (`lib/metadata/fieldRegistry.ts`) — client-safe (no DB import) mirror of the
 * same labels `reviewQueueSource.ts` uses server-side, kept here so a "use
 * client" component can use them without importing a DB-facing module. */
const FIELD_KEY_LABELS: Record<string, string> = {
  title: "Title",
  contributors: "Authors/illustrators",
  publisher: "Publisher",
  isbn: "ISBN",
  language: "Language",
  physical_category: "Category",
  age_range: "Age range",
  visual_media_type: "Visual style",
  visual_realism: "Visual realism",
  format: "Format",
  fiction_status: "Fiction/nonfiction",
  description: "Description",
};

export function describeFieldKey(fieldKey: string): string {
  return FIELD_KEY_LABELS[fieldKey] ?? fieldKey;
}

const RECONCILIATION_LABELS: Record<string, string> = {
  high_confidence: "Confirmed match",
  ambiguous: "Possible match, not confirmed",
  unresolved: "Not confirmed",
};

export function describeReconciliationOutcome(outcome: string | null): string {
  if (!outcome) return "Not confirmed";
  return RECONCILIATION_LABELS[outcome] ?? outcome;
}
