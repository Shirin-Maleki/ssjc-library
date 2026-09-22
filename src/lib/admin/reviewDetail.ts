import { and, eq, inArray } from "drizzle-orm";
import type { Database } from "@/db/client";
import { books, bookFieldProvenance, ingestionItems, reviewFlags } from "@/db/schema";
import { readIntakeDraft, type IntakeDraft } from "@/lib/intake/draft";
import { DrizzleBookRepository } from "@/db/repositories/bookRepository";
import { DrizzleCategoryRepository, type PhysicalCategoryOption } from "@/db/repositories/categoryRepository";
import type { Book } from "@/lib/catalog/types";
import { isValidId } from "./validation";

/**
 * Loads everything the Admin Review detail screen needs for ONE queue item's
 * `key` (Phase 8, §9) — parses the `key` format `reviewQueue.ts` produces
 * (`book:{id}` or `ingestion:{id}`) rather than requiring the caller to already
 * know which kind of entity it is. Never re-runs any Phase 7 provider call —
 * everything here is read from already-persisted state (the validated intake
 * draft, or the book's own relational data).
 *
 * Final closure pass: the id captured out of `key` is now checked with the
 * same `isValidId()` (a plain UUID-shape check) every other Phase 8 id
 * argument is — this function is reachable from a route param
 * (`/admin/review/[key]`) that a browser URL can trivially malform, and a raw
 * non-UUID string reaching a Drizzle `eq(...)` comparison against a `uuid`
 * column throws a Postgres "invalid input syntax for type uuid" error rather
 * than the calm not-found (`undefined`) this function already promises.
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
  duplicateCandidates: DuplicateCandidateView[];
  activeCategories: PhysicalCategoryOption[];
  /** Current `book_field_provenance` for `book` (§5) — empty for an
   * ingestion-only/pending item, which has no book row (or, for a pending
   * placeholder, genuinely no provenance rows written yet). Restrained,
   * human-readable evidence for the Review Detail screen, never a raw table
   * dump. */
  provenance: ProvenanceSummaryEntry[];
}

export interface ProvenanceSummaryEntry {
  fieldKey: string;
  sourceType: "external_provider" | "ai_inferred" | "cover_visible" | "human_corrected" | "human_verified";
  sourceLabel: string | null;
  confidenceLevel: "high" | "medium" | "low" | null;
}

/** A duplicate-comparison candidate, extended with `edition` and real
 * `isbn10`/`isbn13` values (§7). `Book.isbn10`/`isbn13` are declared on the
 * shared domain type but `DrizzleBookRepository`'s projection never populates
 * them (Phase 5 correction — they exist on the type only for the fixture
 * catalog's search-evaluation cases, never surfaced in Find/Book Detail), so a
 * real duplicate candidate loaded through `bookRepository` would otherwise
 * always show `undefined` here. Fetched via one small supplementary query
 * scoped to this admin-only view, rather than widening what the repository
 * projects for every other caller. */
export interface DuplicateCandidateView extends Book {
  edition?: string;
  isbn10?: string;
  isbn13?: string;
}

export async function loadAdminReviewDetail(db: Database, key: string): Promise<AdminReviewDetail | undefined> {
  const bookRepository = new DrizzleBookRepository(db);
  const categoryRepository = new DrizzleCategoryRepository(db);
  const activeCategories = await categoryRepository.listActiveCategories();

  const bookMatch = key.match(/^book:(.+)$/);
  const ingestionMatch = key.match(/^ingestion:(.+)$/);

  if (ingestionMatch) {
    const ingestionItemId = ingestionMatch[1];
    if (!isValidId(ingestionItemId)) return undefined;
    const [item] = await db.select().from(ingestionItems).where(eq(ingestionItems.id, ingestionItemId)).limit(1);
    if (!item) return undefined;
    const draft = readIntakeDraft(item.intakeDraft);
    const duplicateCandidates = draft?.duplicateCandidateBookIds?.length ? await loadDuplicateCandidates(db, bookRepository, draft.duplicateCandidateBookIds) : [];
    return {
      key,
      ingestionItemId,
      bookId: item.pendingBookId ?? undefined,
      draft,
      draftInvalid: draft == null,
      openReviewFlags: [],
      duplicateCandidates,
      activeCategories,
      provenance: [],
    };
  }

  if (bookMatch) {
    const bookId = bookMatch[1];
    if (!isValidId(bookId)) return undefined;
    const [bookRow, book, updatedAtRow, currentProvenanceRows] = await Promise.all([
      db.select().from(reviewFlags).where(eq(reviewFlags.bookId, bookId)),
      bookRepository.getBookById(bookId),
      db.select({ updatedAt: books.updatedAt }).from(books).where(eq(books.id, bookId)).limit(1),
      // Only the CURRENT provenance row per field is meaningful to an admin
      // deciding what needs attention now (§5) — history stays queryable in
      // the database but is never surfaced here.
      db
        .select({ fieldKey: bookFieldProvenance.fieldKey, sourceType: bookFieldProvenance.sourceType, sourceLabel: bookFieldProvenance.sourceLabel, confidenceLevel: bookFieldProvenance.confidenceLevel })
        .from(bookFieldProvenance)
        .where(and(eq(bookFieldProvenance.bookId, bookId), eq(bookFieldProvenance.isCurrent, true))),
    ]);
    if (!book) return undefined;

    // A book-keyed queue item MAY also have an ingestion-item origin (a Review
    // Later item whose pendingBookId points here) — find it so the detail screen
    // can still show source-cover access and draft evidence when available.
    const [linkedItem] = await db.select().from(ingestionItems).where(eq(ingestionItems.pendingBookId, bookId)).limit(1);
    const draft = linkedItem ? readIntakeDraft(linkedItem.intakeDraft) : undefined;
    const duplicateCandidates = draft?.duplicateCandidateBookIds?.length ? await loadDuplicateCandidates(db, bookRepository, draft.duplicateCandidateBookIds) : [];

    const openFlags = bookRow.filter((f) => f.status === "open").map((f) => ({ id: f.id, flagType: f.flagType, detail: f.detail, createdAt: f.createdAt }));
    const provenance = currentProvenanceRows.map((row) => ({ fieldKey: row.fieldKey, sourceType: row.sourceType, sourceLabel: row.sourceLabel, confidenceLevel: row.confidenceLevel }));

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
      provenance,
    };
  }

  return undefined;
}

async function loadDuplicateCandidates(db: Database, bookRepository: DrizzleBookRepository, bookIds: string[]): Promise<DuplicateCandidateView[]> {
  const [candidates, supplementalRows] = await Promise.all([
    bookRepository.getBooksByIds(bookIds),
    db.select({ id: books.id, edition: books.edition, isbn10: books.isbn10, isbn13: books.isbn13 }).from(books).where(inArray(books.id, bookIds)),
  ]);
  const supplementalById = new Map(supplementalRows.map((r) => [r.id, r]));
  return candidates.map((candidate) => {
    const supplemental = supplementalById.get(candidate.id);
    return { ...candidate, edition: supplemental?.edition ?? undefined, isbn10: supplemental?.isbn10 ?? undefined, isbn13: supplemental?.isbn13 ?? undefined };
  });
}
