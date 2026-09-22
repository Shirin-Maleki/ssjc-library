import { and, eq, inArray, ne } from "drizzle-orm";
import type { Database } from "@/db/client";
import { bookContributors, bookDuplicates, bookFieldProvenance, books, ingestionItems, reviewFlags } from "@/db/schema";
import { readIntakeDraft } from "@/lib/intake/draft";
import { computeMissingMetadataFields, describeMissingMetadata } from "./completeness";
import {
  buildAdminReviewQueue,
  buildLowConfidenceSignal,
  classifyNeedsReviewReason,
  reasonCodeForReviewFlagType,
  type AdminReviewItem,
  type ReviewQueueSignal,
} from "./reviewQueue";

const FIELD_KEY_LABELS: Record<string, string> = {
  title: "title",
  contributors: "authors/illustrators",
  publisher: "publisher",
  isbn: "ISBN",
  language: "language",
  physical_category: "category",
  age_range: "age range",
  visual_media_type: "visual style",
  visual_realism: "visual realism",
  format: "format",
  fiction_status: "fiction/nonfiction",
  description: "description",
};

/**
 * The DB-facing counterpart to `reviewQueue.ts`'s pure aggregator (Phase 8, §6) —
 * every real source the queue draws from, in one place, so it's obvious at a
 * glance which tables feed the queue: `ingestion_items.status = 'needs_review'`
 * (the primary Phase 7 Review Later source — including ingestion-only items with
 * no `books` row at all), open `review_flags`, pending `book_duplicates`,
 * low-confidence `book_field_provenance`, and computed missing-metadata on active
 * books. Never queries a `review_queue` table, because none exists — this
 * function IS the queue, computed fresh on every call.
 */
export async function loadAdminReviewQueue(db: Database): Promise<AdminReviewItem[]> {
  const signals: ReviewQueueSignal[] = [];

  // 1. Review Later / ingestion review — the primary Phase 7 source. A
  // needs_review item may or may not have a pendingBookId; when it does, the key
  // is book-scoped so this merges with any review_flags/provenance signal on the
  // SAME book rather than producing a second queue row for it.
  const needsReviewRows = await db
    .select({
      id: ingestionItems.id,
      pendingBookId: ingestionItems.pendingBookId,
      intakeDraft: ingestionItems.intakeDraft,
      createdAt: ingestionItems.createdAt,
    })
    .from(ingestionItems)
    .where(eq(ingestionItems.status, "needs_review"));

  const pendingBookIds = needsReviewRows.map((r) => r.pendingBookId).filter((id): id is string => id != null);
  const pendingBookTitles =
    pendingBookIds.length > 0
      ? await db.select({ id: books.id, title: books.title }).from(books).where(inArray(books.id, pendingBookIds))
      : [];
  const pendingTitleById = new Map(pendingBookTitles.map((b) => [b.id, b.title]));

  for (const row of needsReviewRows) {
    const draft = readIntakeDraft(row.intakeDraft);
    const key = row.pendingBookId ? `book:${row.pendingBookId}` : `ingestion:${row.id}`;
    const title = row.pendingBookId ? (pendingTitleById.get(row.pendingBookId) ?? null) : (draft?.proposedBookValues?.title ?? null);

    const unresolvedDuplicateOutcomes = new Set(["exact_copy_same_edition", "same_title_different_edition", "same_work_different_language", "ambiguous_similar_title"]);
    const reason = classifyNeedsReviewReason({
      draftValid: draft != null,
      title,
      hasUnresolvedDuplicate: draft != null && draft.duplicateOutcome != null && unresolvedDuplicateOutcomes.has(draft.duplicateOutcome),
      hasConfirmedCategory: Boolean(draft?.teacherEdits?.physicalCategorySlug),
    });

    signals.push({
      key,
      bookId: row.pendingBookId ?? undefined,
      ingestionItemId: row.id,
      title,
      createdAt: row.createdAt,
      reason: reason.code,
      reasonDetail: reason.detail,
    });
  }

  // 2. Open review flags.
  const openFlagRows = await db
    .select({ flagType: reviewFlags.flagType, detail: reviewFlags.detail, createdAt: reviewFlags.createdAt, bookId: reviewFlags.bookId, title: books.title, reviewStatus: books.reviewStatus })
    .from(reviewFlags)
    .innerJoin(books, eq(books.id, reviewFlags.bookId))
    .where(and(eq(reviewFlags.status, "open"), ne(books.reviewStatus, "archived")));

  for (const row of openFlagRows) {
    signals.push({
      key: `book:${row.bookId}`,
      bookId: row.bookId,
      title: row.title,
      createdAt: row.createdAt,
      reason: reasonCodeForReviewFlagType(row.flagType),
      reasonDetail: row.detail ?? undefined,
    });
  }

  // 3. Pending duplicate relationships — `bookIdA` is treated as "the record under
  // review" by convention (the side a future admin-created relationship names
  // first); Phase 7's own duplicate detection does not populate this table today
  // (its outcome lives in the intake draft instead, source #1 above) — this exists
  // for when a real relationship between two already-catalogued books is recorded.
  const pendingDuplicateRows = await db
    .select({ id: bookDuplicates.id, bookIdA: bookDuplicates.bookIdA, createdAt: bookDuplicates.createdAt, title: books.title })
    .from(bookDuplicates)
    .innerJoin(books, eq(books.id, bookDuplicates.bookIdA))
    .where(eq(bookDuplicates.status, "pending"));

  for (const row of pendingDuplicateRows) {
    signals.push({
      key: `book:${row.bookIdA}`,
      bookId: row.bookIdA,
      duplicateId: row.id,
      title: row.title,
      createdAt: row.createdAt,
      reason: "possible_duplicate",
    });
  }

  // 4. Low-confidence current provenance — combined per book, never one queue row
  // per field (reviewQueue.ts's own `buildLowConfidenceSignal` handles the merge).
  const lowConfidenceRows = await db
    .select({ bookId: bookFieldProvenance.bookId, fieldKey: bookFieldProvenance.fieldKey, createdAt: bookFieldProvenance.createdAt, title: books.title })
    .from(bookFieldProvenance)
    .innerJoin(books, eq(books.id, bookFieldProvenance.bookId))
    .where(and(eq(bookFieldProvenance.isCurrent, true), eq(bookFieldProvenance.confidenceLevel, "low"), ne(books.reviewStatus, "archived")));

  const lowConfidenceByBook = new Map<string, { title: string | null; fields: string[]; createdAt: Date }>();
  for (const row of lowConfidenceRows) {
    const entry = lowConfidenceByBook.get(row.bookId) ?? { title: row.title, fields: [], createdAt: row.createdAt };
    entry.fields.push(FIELD_KEY_LABELS[row.fieldKey] ?? row.fieldKey);
    if (row.createdAt < entry.createdAt) entry.createdAt = row.createdAt;
    lowConfidenceByBook.set(row.bookId, entry);
  }
  for (const [bookId, entry] of lowConfidenceByBook) {
    const signal = buildLowConfidenceSignal({ key: `book:${bookId}`, bookId, title: entry.title, fieldLabels: entry.fields, createdAt: entry.createdAt });
    if (signal) signals.push(signal);
  }

  // 5. Missing useful metadata — active books only (a pending_review book is
  // expected to be incomplete before admin approval and is already represented
  // via source #1 when it has an ingestion link).
  const activeBookRows = await db
    .select({
      id: books.id,
      title: books.title,
      shortDescription: books.shortDescription,
      ageMinMonths: books.ageMinMonths,
      ageMaxMonths: books.ageMaxMonths,
      format: books.format,
      visualMediaType: books.visualMediaType,
      visualRealism: books.visualRealism,
      createdAt: books.createdAt,
    })
    .from(books)
    .where(eq(books.reviewStatus, "active"));

  if (activeBookRows.length > 0) {
    const contributorRows = await db
      .select({ bookId: bookContributors.bookId })
      .from(bookContributors)
      .where(inArray(bookContributors.bookId, activeBookRows.map((b) => b.id)));
    const bookIdsWithContributors = new Set(contributorRows.map((r) => r.bookId));

    for (const book of activeBookRows) {
      const missing = computeMissingMetadataFields({
        hasContributors: bookIdsWithContributors.has(book.id),
        hasDescription: Boolean(book.shortDescription && book.shortDescription.trim()),
        hasAgeRange: book.ageMinMonths != null || book.ageMaxMonths != null,
        hasFormat: book.format != null,
        hasVisualStyle: (book.visualMediaType && book.visualMediaType.length > 0) || book.visualRealism != null,
      });
      const detail = describeMissingMetadata(missing);
      if (!detail) continue;
      signals.push({ key: `book:${book.id}`, bookId: book.id, title: book.title, createdAt: book.createdAt, reason: "missing_metadata", reasonDetail: detail });
    }
  }

  return buildAdminReviewQueue(signals);
}
