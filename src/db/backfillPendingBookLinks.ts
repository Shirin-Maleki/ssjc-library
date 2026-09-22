import { and, eq, isNull, sql } from "drizzle-orm";
import type { Database } from "./client";
import { auditLog, books, ingestionItems } from "./schema";

/**
 * One-time, idempotent backfill for `ingestion_items.pending_book_id` (Phase 8,
 * migration `0004`) — populates the new durable link for pre-existing Phase 7
 * `needs_review` rows from the only prior record of "which book, if any, did this
 * item create": the `intake_marked_for_review` `audit_log` row's `detail.bookId`.
 * Deliberately conservative (§54's "if an existing row is ambiguous, leave the new
 * FK null and handle it as an ingestion-only review item rather than guessing"):
 * only backfills a row when there is EXACTLY ONE `intake_marked_for_review` audit
 * event for that ingestion item with a non-null `bookId`, that book still exists,
 * is still `pending_review`, and no other ingestion item is already linked to it.
 * Never touches a row that already has `pending_book_id` set, and never touches
 * `resultingCopyId`/completed items (those already have their own durable link).
 * Safe to run on every `db:migrate` invocation — a from-zero database has no
 * `needs_review` rows to consider, so this is a fast no-op there.
 */
export interface BackfillPendingBookLinksResult {
  considered: number;
  linked: number;
  skippedAmbiguous: number;
}

export async function backfillPendingBookLinks(db: Database): Promise<BackfillPendingBookLinksResult> {
  const candidates = await db
    .select({ id: ingestionItems.id })
    .from(ingestionItems)
    .where(and(eq(ingestionItems.status, "needs_review"), isNull(ingestionItems.pendingBookId)));

  if (candidates.length === 0) {
    return { considered: 0, linked: 0, skippedAmbiguous: 0 };
  }

  let linked = 0;
  let skippedAmbiguous = 0;

  for (const item of candidates) {
    const auditRows = await db
      .select({ bookId: sql<string | null>`${auditLog.detail}->>'bookId'` })
      .from(auditLog)
      .where(and(eq(auditLog.entityType, "ingestion_item"), eq(auditLog.entityId, item.id), eq(auditLog.action, "intake_marked_for_review")));

    const distinctBookIds = [...new Set(auditRows.map((r) => r.bookId).filter((id): id is string => id != null))];
    if (distinctBookIds.length !== 1) {
      if (distinctBookIds.length > 1) skippedAmbiguous += 1;
      continue;
    }
    const candidateBookId = distinctBookIds[0];

    const [book] = await db
      .select({ id: books.id, reviewStatus: books.reviewStatus })
      .from(books)
      .where(eq(books.id, candidateBookId))
      .limit(1);
    if (!book || book.reviewStatus !== "pending_review") {
      skippedAmbiguous += 1;
      continue;
    }

    const [alreadyLinked] = await db
      .select({ id: ingestionItems.id })
      .from(ingestionItems)
      .where(eq(ingestionItems.pendingBookId, candidateBookId))
      .limit(1);
    if (alreadyLinked) {
      skippedAmbiguous += 1;
      continue;
    }

    await db.update(ingestionItems).set({ pendingBookId: candidateBookId }).where(eq(ingestionItems.id, item.id));
    linked += 1;
  }

  return { considered: candidates.length, linked, skippedAmbiguous };
}
