import { eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import {
  auditLog,
  bookContributors,
  bookCopies,
  bookLanguages,
  books,
  bookTags,
  contributors,
  ingestionItems,
  physicalCategories,
  publishers,
  reviewFlags,
  tags,
  bookFieldProvenance,
} from "@/db/schema";
import { normalizeSearchText, normalizeTitle } from "@/lib/search/normalize";
import { computeSortTitle } from "@/lib/catalog/sortTitle";
import { buildSearchIndexText } from "@/lib/embeddings/document";
import type { Format, IllustrationStyle, LanguageCode, VisualRealism } from "@/lib/catalog/types";
import type { MetadataFieldKey } from "@/lib/metadata/fieldRegistry";
import type { IntakeDraft } from "./draft";

/** The exact type Drizzle's `db.transaction(async (tx) => ...)` callback receives —
 * structurally close to but not identical to `Database` (it lacks `$client`), so a
 * helper function called from inside a transaction needs this type, not `Database`
 * itself. */
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * Dedicated, transactional new-book/another-copy/review-later persistence (Phase 7,
 * §33/§34/§31 of the phase brief) — never a giant Server Action doing raw inserts
 * inline. Every multi-table mutation here runs inside one `db.transaction`; a
 * failure anywhere rolls back the entire catalog mutation (§33: "Do not leave a new
 * active `books` row without its intended physical copy").
 */

export interface ProvenanceInput {
  fieldKey: MetadataFieldKey;
  sourceType: "external_provider" | "ai_inferred" | "cover_visible" | "human_corrected" | "human_verified";
  sourceLabel?: string;
  confidenceLevel?: "high" | "medium" | "low";
}

export interface NewBookInput {
  title: string;
  subtitle?: string;
  authors: string[];
  illustrators?: string[];
  publisherName?: string;
  imprint?: string;
  languageCode: LanguageCode;
  additionalLanguageCodes?: LanguageCode[];
  isbn10?: string;
  isbn13?: string;
  description?: string;
  physicalCategorySlug: string;
  fictionType?: "fiction" | "nonfiction";
  format?: Format;
  ageMinMonths?: number;
  ageMaxMonths?: number;
  readAloudMinutes?: number;
  visualMediaTypes?: IllustrationStyle[];
  visualRealism?: VisualRealism;
  tags?: string[];
  displayCoverUrl?: string;
  coverDriveFileId: string;
  coverDriveFolderId: string;
  coverFilename: string;
  coverMimeType: string;
  provenance: ProvenanceInput[];
  ingestionItemId: string;
  actorLabel: string;
}

export interface NewBookResult {
  bookId: string;
  copyId: string;
}

async function upsertPublisher(tx: Transaction, name: string): Promise<string> {
  const [row] = await tx
    .insert(publishers)
    .values({ name, normalizedName: normalizeSearchText(name) })
    .onConflictDoUpdate({ target: publishers.name, set: { name } })
    .returning({ id: publishers.id });
  return row.id;
}

async function upsertContributor(tx: Transaction, name: string): Promise<string> {
  const normalizedName = normalizeSearchText(name);
  const [row] = await tx
    .insert(contributors)
    .values({ name, normalizedName })
    .onConflictDoUpdate({ target: contributors.normalizedName, set: { name } })
    .returning({ id: contributors.id });
  return row.id;
}

async function upsertTag(tx: Transaction, name: string): Promise<string> {
  const normalizedName = normalizeSearchText(name);
  const [row] = await tx
    .insert(tags)
    .values({ name, normalizedName })
    .onConflictDoUpdate({ target: tags.normalizedName, set: { name } })
    .returning({ id: tags.id });
  return row.id;
}

/**
 * Minimum-data invariant for a new ACTIVE catalog record (§32 of the phase brief) —
 * checked here as well as by callers, since this is the one place that can never be
 * bypassed by a future new call site. Author/ISBN/publisher/age/visual
 * style/duration may all be genuinely unknown; title, language, and a real physical
 * category may not.
 */
function assertMinimumData(input: NewBookInput): void {
  if (!input.title.trim()) throw new Error("A new book requires a title.");
  if (!input.languageCode) throw new Error("A new book requires a primary language.");
  if (!input.physicalCategorySlug) throw new Error("A new book requires a physical category to shelve it.");
  if (!input.coverDriveFileId) throw new Error("A new book requires a confirmed Drive source cover.");
}

export async function saveNewBook(db: Database, input: NewBookInput): Promise<NewBookResult> {
  assertMinimumData(input);

  return db.transaction(async (tx) => {
    const [category] = await tx
      .select({ id: physicalCategories.id, label: physicalCategories.label })
      .from(physicalCategories)
      .where(eq(physicalCategories.slug, input.physicalCategorySlug))
      .limit(1);
    if (!category) throw new Error(`Unknown physical category slug: ${input.physicalCategorySlug}`);

    const publisherId = input.publisherName ? await upsertPublisher(tx, input.publisherName) : undefined;

    const document = {
      title: input.title,
      subtitle: input.subtitle,
      description: input.description,
      authors: input.authors,
      illustrators: input.illustrators,
      publisher: input.publisherName,
      imprint: input.imprint,
      categoryLabel: category.label,
      tags: input.tags ?? [],
      languageCode: input.languageCode,
      additionalLanguageCodes: input.additionalLanguageCodes,
      fictionType: input.fictionType,
      format: input.format,
      illustrationStyles: input.visualMediaTypes ?? [],
      visualRealism: input.visualRealism,
      ageMinMonths: input.ageMinMonths,
      ageMaxMonths: input.ageMaxMonths,
      readAloudMinutes: input.readAloudMinutes,
    };
    const searchText = buildSearchIndexText(document);

    const [bookRow] = await tx
      .insert(books)
      .values({
        title: input.title,
        subtitle: input.subtitle,
        normalizedTitle: normalizeTitle(input.title),
        sortTitle: computeSortTitle(input.title),
        shortDescription: input.description,
        languageCode: input.languageCode,
        fictionStatus: input.fictionType ?? "unknown_mixed",
        ageMinMonths: input.ageMinMonths,
        ageMaxMonths: input.ageMaxMonths,
        readAloudMinutesEstimate: input.readAloudMinutes != null ? input.readAloudMinutes.toFixed(1) : null,
        format: input.format,
        visualMediaType: input.visualMediaTypes,
        visualRealism: input.visualRealism,
        publisherId,
        imprint: input.imprint,
        isbn10: input.isbn10,
        isbn13: input.isbn13,
        physicalCategoryId: category.id,
        coverDriveFileId: input.coverDriveFileId,
        coverDriveFolderId: input.coverDriveFolderId,
        coverFilename: input.coverFilename,
        coverMimeType: input.coverMimeType,
        coverSourceType: "teacher_upload",
        displayCoverUrl: input.displayCoverUrl,
        displayCoverSource: input.displayCoverUrl ? "external_provider_thumbnail" : undefined,
        reviewStatus: "active",
        searchText,
      })
      .returning({ id: books.id });
    const bookId = bookRow.id;

    for (const [index, author] of input.authors.entries()) {
      const contributorId = await upsertContributor(tx, author);
      await tx.insert(bookContributors).values({ bookId, contributorId, role: "author", sortOrder: index });
    }
    for (const [index, illustrator] of (input.illustrators ?? []).entries()) {
      const contributorId = await upsertContributor(tx, illustrator);
      await tx.insert(bookContributors).values({ bookId, contributorId, role: "illustrator", sortOrder: index });
    }

    for (const tagName of input.tags ?? []) {
      const tagId = await upsertTag(tx, tagName);
      await tx.insert(bookTags).values({ bookId, tagId }).onConflictDoNothing();
    }

    for (const languageCode of input.additionalLanguageCodes ?? []) {
      await tx.insert(bookLanguages).values({ bookId, languageCode }).onConflictDoNothing();
    }

    for (const provenance of input.provenance) {
      await tx.insert(bookFieldProvenance).values({
        bookId,
        fieldKey: provenance.fieldKey,
        sourceType: provenance.sourceType,
        sourceLabel: provenance.sourceLabel,
        confidenceLevel: provenance.confidenceLevel,
      });
    }

    const [copyRow] = await tx
      .insert(bookCopies)
      .values({ bookId, sourceIngestionItemId: input.ingestionItemId })
      .returning({ id: bookCopies.id });

    await tx
      .update(ingestionItems)
      .set({ status: "completed", resultingCopyId: copyRow.id, completedAt: new Date() })
      .where(eq(ingestionItems.id, input.ingestionItemId));

    await tx.insert(auditLog).values({
      actorLabel: input.actorLabel,
      action: "book_created",
      entityType: "book",
      entityId: bookId,
      detail: { title: input.title, ingestionItemId: input.ingestionItemId },
    });

    return { bookId, copyId: copyRow.id };
  });
}

export interface AnotherCopyInput {
  bookId: string;
  ingestionItemId: string;
  actorLabel: string;
}

export interface AnotherCopyResult {
  copyId: string;
}

/**
 * The exact-existing-edition path (§18/§34 of the phase brief) — never creates a
 * second `books` row, never overwrites the existing book's bibliographic/source-
 * cover metadata (the newly photographed source stays preserved only through the
 * ingestion item / Drive identity it already has, exactly as required).
 */
export async function addAnotherCopy(db: Database, input: AnotherCopyInput): Promise<AnotherCopyResult> {
  return db.transaction(async (tx) => {
    const [book] = await tx.select({ id: books.id }).from(books).where(eq(books.id, input.bookId)).limit(1);
    if (!book) throw new Error(`Book ${input.bookId} not found.`);

    const [copyRow] = await tx
      .insert(bookCopies)
      .values({ bookId: input.bookId, sourceIngestionItemId: input.ingestionItemId })
      .returning({ id: bookCopies.id });

    await tx
      .update(ingestionItems)
      .set({ status: "completed", resultingCopyId: copyRow.id, completedAt: new Date() })
      .where(eq(ingestionItems.id, input.ingestionItemId));

    await tx.insert(auditLog).values({
      actorLabel: input.actorLabel,
      action: "copy_added",
      entityType: "book",
      entityId: input.bookId,
      detail: { ingestionItemId: input.ingestionItemId },
    });

    return { copyId: copyRow.id };
  });
}

export interface SaveForReviewInput {
  ingestionItemId: string;
  draft: IntakeDraft;
  reviewReason: string;
  actorLabel: string;
  /** Present only when enough trustworthy minimum data exists to create a real
   * `pending_review` book row (§31 of the phase brief) — omitted entirely rather
   * than ever populated with invented title/language data. */
  pendingBook?: {
    title: string;
    languageCode: LanguageCode;
    authors?: string[];
    description?: string;
    coverDriveFileId: string;
    coverDriveFolderId: string;
    coverFilename: string;
    coverMimeType: string;
  };
}

export interface SaveForReviewResult {
  bookId?: string;
}

/**
 * Persists a resumable Review Later state (§31) — sets `ingestion_items.status =
 * 'needs_review'` with the full validated draft, so a later review session can
 * resume without re-uploading or re-running any provider call. Optionally creates a
 * `pending_review` book (kept out of normal Find by the existing, unchanged
 * `review_status` visibility rule) plus a `review_flags` row, only when real
 * minimum bibliographic data was actually established.
 */
export async function saveForReview(db: Database, input: SaveForReviewInput): Promise<SaveForReviewResult> {
  return db.transaction(async (tx) => {
    let bookId: string | undefined;

    if (input.pendingBook) {
      const [bookRow] = await tx
        .insert(books)
        .values({
          title: input.pendingBook.title,
          normalizedTitle: normalizeTitle(input.pendingBook.title),
          sortTitle: computeSortTitle(input.pendingBook.title),
          shortDescription: input.pendingBook.description,
          languageCode: input.pendingBook.languageCode,
          coverDriveFileId: input.pendingBook.coverDriveFileId,
          coverDriveFolderId: input.pendingBook.coverDriveFolderId,
          coverFilename: input.pendingBook.coverFilename,
          coverMimeType: input.pendingBook.coverMimeType,
          coverSourceType: "teacher_upload",
          reviewStatus: "pending_review",
        })
        .returning({ id: books.id });
      bookId = bookRow.id;

      for (const [index, author] of (input.pendingBook.authors ?? []).entries()) {
        const contributorId = await upsertContributor(tx, author);
        await tx.insert(bookContributors).values({ bookId, contributorId, role: "author", sortOrder: index });
      }

      await tx.insert(reviewFlags).values({
        bookId,
        flagType: "low_identification_confidence",
        detail: input.reviewReason,
      });
    }

    await tx
      .update(ingestionItems)
      .set({ status: "needs_review", reviewReason: input.reviewReason, intakeDraft: input.draft })
      .where(eq(ingestionItems.id, input.ingestionItemId));

    await tx.insert(auditLog).values({
      actorLabel: input.actorLabel,
      action: "intake_marked_for_review",
      entityType: "ingestion_item",
      entityId: input.ingestionItemId,
      detail: { reviewReason: input.reviewReason, bookId: bookId ?? null },
    });

    return { bookId };
  });
}
