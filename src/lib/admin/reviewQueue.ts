import { describeMissingMetadata, type MissingMetadataField } from "./completeness";

/**
 * The normalized, database-agnostic Admin Review queue projection (Phase 8, §6/§7
 * of the phase brief) — a real aggregation across multiple existing tables
 * (`ingestion_items.status = needs_review`, `review_flags`, `book_duplicates`,
 * low-confidence `book_field_provenance`, and computed missing-metadata/category
 * issues), never a new `review_queue` table. This module is pure and
 * dependency-light (no `@/db/client`, no session) so both the priority/dedup logic
 * and the queue-building logic are directly unit-testable — matching this
 * codebase's established pattern for `confirmFieldResolution.ts`,
 * `enrichmentMerge.ts`, etc. `reviewQueueSource.ts` is the DB-facing counterpart
 * that fetches real rows and turns them into the plain `ReviewQueueSignal[]` this
 * file consumes.
 */

export type AdminReviewReasonCode =
  | "identity_needs_review"
  | "possible_duplicate"
  | "category_missing"
  | "category_uncertain"
  | "metadata_conflict"
  | "low_confidence_field"
  | "missing_metadata";

/** Priority 1 (identity/duplicate) through 4 (non-blocking metadata cleanup) — a
 * simple, deterministic, human-labeled ordering (§7): never an AI-generated score,
 * never a mysterious number shown to the admin. */
export type AdminReviewPriority = 1 | 2 | 3 | 4;

const REASON_PRIORITY: Record<AdminReviewReasonCode, AdminReviewPriority> = {
  identity_needs_review: 1,
  possible_duplicate: 1,
  category_missing: 2,
  category_uncertain: 2,
  metadata_conflict: 3,
  low_confidence_field: 3,
  missing_metadata: 4,
};

const REASON_LABELS: Record<AdminReviewReasonCode, string> = {
  identity_needs_review: "Identity needs review",
  possible_duplicate: "Possible duplicate",
  category_missing: "Category needs confirmation",
  category_uncertain: "Category needs confirmation",
  metadata_conflict: "Metadata conflict",
  low_confidence_field: "Low-confidence metadata",
  missing_metadata: "Missing useful metadata",
};

export interface AdminReviewReason {
  code: AdminReviewReasonCode;
  label: string;
  detail?: string;
}

export interface AdminReviewItem {
  /** Dedup/merge key — `book:{bookId}` when a bibliographic record exists (even a
   * `pending_review` placeholder), otherwise `ingestion:{ingestionItemId}` for a
   * genuinely ingestion-only Review Later item. Never a raw UUID shown to the admin
   * on its own — see `docs/DECISIONS.md`'s "never expose raw UUIDs" convention. */
  key: string;
  bookId?: string;
  ingestionItemId?: string;
  duplicateId?: string;
  /** Always a display-ready string — "Title not identified" when no signal
   * contributed a real title, never an empty string the UI has to guard against. */
  title: string;
  primaryReason: AdminReviewReason;
  secondaryReasonCount: number;
  reasons: AdminReviewReason[];
  priority: AdminReviewPriority;
  enteredReviewAt: Date;
}

/** One raw fact contributing to the queue, already normalized to plain values by
 * `reviewQueueSource.ts` — never a Drizzle row shape. Multiple signals sharing the
 * same `key` are merged into one `AdminReviewItem` (§6: "deduplicate queue items
 * when multiple underlying signals refer to the same pending intake/book"). */
export interface ReviewQueueSignal {
  key: string;
  bookId?: string;
  ingestionItemId?: string;
  duplicateId?: string;
  title?: string | null;
  createdAt: Date;
  reason: AdminReviewReasonCode;
  reasonDetail?: string;
}

interface MergedEntry {
  bookId?: string;
  ingestionItemId?: string;
  duplicateId?: string;
  title?: string | null;
  createdAt: Date;
  reasons: AdminReviewReason[];
  seenCodes: Set<AdminReviewReasonCode>;
}

/** Merges every signal sharing a key, sorts each item's own reasons by priority
 * (most urgent first), then sorts the whole queue by priority and — within the same
 * priority — oldest-entered-review first (§7: "within a priority, prefer oldest
 * unresolved first"). Deterministic: the same input always produces the same
 * output order. */
export function buildAdminReviewQueue(signals: ReviewQueueSignal[]): AdminReviewItem[] {
  const byKey = new Map<string, MergedEntry>();

  for (const signal of signals) {
    let entry = byKey.get(signal.key);
    if (!entry) {
      entry = {
        bookId: signal.bookId,
        ingestionItemId: signal.ingestionItemId,
        duplicateId: signal.duplicateId,
        title: signal.title,
        createdAt: signal.createdAt,
        reasons: [],
        seenCodes: new Set(),
      };
      byKey.set(signal.key, entry);
    }
    entry.bookId ??= signal.bookId;
    entry.ingestionItemId ??= signal.ingestionItemId;
    entry.duplicateId ??= signal.duplicateId;
    if (!entry.title && signal.title) entry.title = signal.title;
    if (signal.createdAt.getTime() < entry.createdAt.getTime()) entry.createdAt = signal.createdAt;
    if (!entry.seenCodes.has(signal.reason)) {
      entry.seenCodes.add(signal.reason);
      entry.reasons.push({ code: signal.reason, label: REASON_LABELS[signal.reason], detail: signal.reasonDetail });
    }
  }

  const items: AdminReviewItem[] = [...byKey.entries()].map(([key, entry]) => {
    const sortedReasons = [...entry.reasons].sort((a, b) => REASON_PRIORITY[a.code] - REASON_PRIORITY[b.code]);
    const primaryReason = sortedReasons[0];
    const title = entry.title && entry.title.trim() ? entry.title.trim() : "Title not identified";
    return {
      key,
      bookId: entry.bookId,
      ingestionItemId: entry.ingestionItemId,
      duplicateId: entry.duplicateId,
      title,
      primaryReason,
      secondaryReasonCount: sortedReasons.length - 1,
      reasons: sortedReasons,
      priority: REASON_PRIORITY[primaryReason.code],
      enteredReviewAt: entry.createdAt,
    };
  });

  items.sort((a, b) => a.priority - b.priority || a.enteredReviewAt.getTime() - b.enteredReviewAt.getTime());
  return items;
}

/** Maps a `review_flags.flag_type` value to the reason code the queue uses —
 * centralized so `reviewQueueSource.ts` never hand-rolls this mapping inline, and
 * so it's covered by the same unit tests as the rest of this module. */
export function reasonCodeForReviewFlagType(flagType: string): AdminReviewReasonCode {
  switch (flagType) {
    case "duplicate_uncertain":
      return "possible_duplicate";
    case "category_uncertain":
      return "category_uncertain";
    case "metadata_conflict":
      return "metadata_conflict";
    case "missing_metadata":
    case "visual_style_uncertain":
      return "missing_metadata";
    case "low_identification_confidence":
    case "user_flagged":
    case "teacher_requested_review":
    case "import_error":
    default:
      return "identity_needs_review";
  }
}

/** A plain summary of one `needs_review` ingestion item's validated draft (or the
 * lack of one), already normalized by `reviewQueueSource.ts` from
 * `readIntakeDraft()`'s result — kept independent of `IntakeDraft`'s real shape so
 * this module never needs to import `lib/intake/draft.ts` just to classify a
 * reason. */
export interface NeedsReviewDraftSummary {
  /** `false` when `readIntakeDraft()` returned `undefined` for a stale/invalid
   * stored draft — the queue must still show a calm, real entry, never crash. */
  draftValid: boolean;
  title: string | null;
  hasUnresolvedDuplicate: boolean;
  hasConfirmedCategory: boolean;
}

/** The one place a Review Later ingestion item's draft content becomes a queue
 * reason (§6.1) — a stale/unreadable draft is itself worth an admin's attention
 * (`identity_needs_review`), an unresolved duplicate candidate takes priority over
 * a merely-missing category, and a merely-missing category takes priority over the
 * generic "this item is still awaiting a decision" fallback. */
export function classifyNeedsReviewReason(summary: NeedsReviewDraftSummary): { code: AdminReviewReasonCode; detail?: string } {
  if (!summary.draftValid) {
    return { code: "identity_needs_review", detail: "This item's saved progress could not be read and needs a fresh look." };
  }
  if (summary.hasUnresolvedDuplicate) {
    return { code: "possible_duplicate" };
  }
  if (!summary.title) {
    return { code: "identity_needs_review", detail: "No title was identified yet." };
  }
  if (!summary.hasConfirmedCategory) {
    return { code: "category_missing" };
  }
  return { code: "identity_needs_review", detail: "Still awaiting an admin decision." };
}

/** Combines every low-confidence field on the SAME book into one `low_confidence_field`
 * signal with a plain-language detail listing them (§6.4: "do not show every numeric
 * confidence value in the queue") — never one queue reason per field. `fieldLabels`
 * are already human-readable field names (e.g. "category", "age range"), not raw
 * `field_key` strings. Returns `undefined` when there is nothing low-confidence to
 * report. */
export function buildLowConfidenceSignal(params: {
  key: string;
  bookId: string;
  title: string | null;
  fieldLabels: string[];
  createdAt: Date;
}): ReviewQueueSignal | undefined {
  if (params.fieldLabels.length === 0) return undefined;
  return {
    key: params.key,
    bookId: params.bookId,
    title: params.title,
    createdAt: params.createdAt,
    reason: "low_confidence_field",
    reasonDetail: `Low confidence: ${params.fieldLabels.join(", ")}`,
  };
}

export { describeMissingMetadata };
export type { MissingMetadataField };
