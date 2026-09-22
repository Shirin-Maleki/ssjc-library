import { eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import { books, ingestionItems, reviewFlags } from "@/db/schema";
import { readIntakeDraft, type IntakeDraft } from "@/lib/intake/draft";
import { DrizzleBookRepository } from "@/db/repositories/bookRepository";
import { DrizzleCategoryRepository, type PhysicalCategoryOption } from "@/db/repositories/categoryRepository";
import type { Book } from "@/lib/catalog/types";

/**
 * Loads everything the Admin Review detail screen needs for ONE queue item's
 * `key` (Phase 8, §9) — parses the `key` format `reviewQueue.ts` produces
 * (`book:{id}` or `ingestion:{id}`) rather than requiring the caller to already
 * know which kind of entity it is. Never re-runs any Phase 7 provider call —
 * everything here is read from already-persisted state (the validated intake
 * draft, or the book's own relational data).
 */
export interface AdminReviewDetail {
  key: string;
  ingestionItemId?: string;
  bookId?: string;
  draft?: IntakeDraft;
  draftInvalid: boolean;
  book?: Book;
  bookUpdatedAt?: Date;
  openReviewFlags: { id: string; flagType: string; detail: string | null; createdAt: Date }[];
  duplicateCandidates: Book[];
  activeCategories: PhysicalCategoryOption[];
}

export async function loadAdminReviewDetail(db: Database, key: string): Promise<AdminReviewDetail | undefined> {
  const bookRepository = new DrizzleBookRepository(db);
  const categoryRepository = new DrizzleCategoryRepository(db);
  const activeCategories = await categoryRepository.listActiveCategories();

  const bookMatch = key.match(/^book:(.+)$/);
  const ingestionMatch = key.match(/^ingestion:(.+)$/);

  if (ingestionMatch) {
    const ingestionItemId = ingestionMatch[1];
    const [item] = await db.select().from(ingestionItems).where(eq(ingestionItems.id, ingestionItemId)).limit(1);
    if (!item) return undefined;
    const draft = readIntakeDraft(item.intakeDraft);
    const duplicateCandidates = draft?.duplicateCandidateBookIds?.length ? await bookRepository.getBooksByIds(draft.duplicateCandidateBookIds) : [];
    return {
      key,
      ingestionItemId,
      bookId: item.pendingBookId ?? undefined,
      draft,
      draftInvalid: draft == null,
      openReviewFlags: [],
      duplicateCandidates,
      activeCategories,
    };
  }

  if (bookMatch) {
    const bookId = bookMatch[1];
    const [bookRow, book, updatedAtRow] = await Promise.all([
      db.select().from(reviewFlags).where(eq(reviewFlags.bookId, bookId)),
      bookRepository.getBookById(bookId),
      db.select({ updatedAt: books.updatedAt }).from(books).where(eq(books.id, bookId)).limit(1),
    ]);
    if (!book) return undefined;

    // A book-keyed queue item MAY also have an ingestion-item origin (a Review
    // Later item whose pendingBookId points here) — find it so the detail screen
    // can still show source-cover access and draft evidence when available.
    const [linkedItem] = await db.select().from(ingestionItems).where(eq(ingestionItems.pendingBookId, bookId)).limit(1);
    const draft = linkedItem ? readIntakeDraft(linkedItem.intakeDraft) : undefined;
    const duplicateCandidates = draft?.duplicateCandidateBookIds?.length ? await bookRepository.getBooksByIds(draft.duplicateCandidateBookIds) : [];

    const openFlags = bookRow.filter((f) => f.status === "open").map((f) => ({ id: f.id, flagType: f.flagType, detail: f.detail, createdAt: f.createdAt }));

    return {
      key,
      ingestionItemId: linkedItem?.id,
      bookId,
      draft,
      draftInvalid: linkedItem != null && draft == null,
      book,
      bookUpdatedAt: updatedAtRow[0]?.updatedAt,
      openReviewFlags: openFlags,
      duplicateCandidates,
      activeCategories,
    };
  }

  return undefined;
}
