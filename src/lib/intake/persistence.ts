import { eq, sql } from "drizzle-orm";
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
  ingestionJobs,
  physicalCategories,
  publishers,
  reviewFlags,
  tags,
  bookFieldProvenance,
  reviewFlagTypeEnum,
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
 * itself. Exported for Phase 8's admin persistence layer, which composes its own
 * transactions calling into `upsertPublisher`/`upsertContributor`/`upsertTag`. */
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** The `review_flags.flag_type` enum's real value union — derived from the schema's
 * own `pgEnum`, never a hand-maintained parallel list (mirrors
 * `src/lib/admin/persistence.ts`'s identical local derivation). */
type ReviewFlagType = (typeof reviewFlagTypeEnum.enumValues)[number];

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
  /** `"teacher_upload"` (default, unchanged Phase 7 behavior) or `"bulk_import"`
   * (Phase 9) — `books.cover_source_type` already had this second enum value
   * declared and unused since Phase 4; this is the first caller to actually set
   * it, so a bulk-imported record is truthfully distinguishable from a teacher's
   * own single-add capture rather than silently mislabeled. */
  coverSourceType?: "teacher_upload" | "bulk_import";
}

export interface NewBookResult {
  bookId: string;
  copyId: string;
}

/** Exported for Phase 8's admin persistence layer (`src/lib/admin/persistence.ts`)
 * — reused rather than re-implemented, per §32's "use the established normalized
 * publisher logic" for any admin metadata correction that touches publisher name. */
export async function upsertPublisher(tx: Transaction, name: string): Promise<string> {
  const [row] = await tx
    .insert(publishers)
    .values({ name, normalizedName: normalizeSearchText(name) })
    .onConflictDoUpdate({ target: publishers.name, set: { name } })
    .returning({ id: publishers.id });
  return row.id;
}

/** Exported for Phase 8's admin persistence layer — see `upsertPublisher`'s comment. */
export async function upsertContributor(tx: Transaction, name: string): Promise<string> {
  const normalizedName = normalizeSearchText(name);
  const [row] = await tx
    .insert(contributors)
    .values({ name, normalizedName })
    .onConflictDoUpdate({ target: contributors.normalizedName, set: { name } })
    .returning({ id: contributors.id });
  return row.id;
}

/** Exported for Phase 8's admin persistence layer — see `upsertPublisher`'s comment. */
export async function upsertTag(tx: Transaction, name: string): Promise<string> {
  const normalizedName = normalizeSearchText(name);
  const [row] = await tx
    .insert(tags)
    .values({ name, normalizedName })
    .onConflictDoUpdate({ target: tags.normalizedName, set: { name } })
    .returning({ id: tags.id });
  return row.id;
}

/**
 * Records that one `ingestion_items` row under `jobId` reached a terminal outcome,
 * and marks the parent `ingestion_jobs` row `"completed"` once every one of its
 * `total_items` has been accounted for (`processed + failed + skipped >= total`) —
 * never unconditionally after just one item, which would have been wrong the
 * moment a job legitimately contained more than one item.
 *
 * Phase 7's `single_add`/`teacher_capture` jobs always set `totalItems: 1` at
 * creation (`ingestionRecord.ts`), so for every existing caller this reaches the
 * same outcome as before — the job completes immediately after its one item
 * finishes — with byte-for-byte identical behavior to the previous
 * `completeParentJob` this replaces. Phase 9's multi-item `bulk_import` jobs are
 * the first real caller where the distinction matters: a job with `totalItems: 25`
 * must not read as `"completed"` after its first item alone.
 *
 * The counter increment is a single atomic `UPDATE ... SET x = x + 1 RETURNING`
 * (never a separate read-then-write), so concurrent bulk-import workers finishing
 * different items of the same job at the same moment can never lose an increment
 * to a race — the same reasoning `docs/DECISIONS.md`'s claim-before-mutate entries
 * already establish for `ingestion_items` status transitions, applied here to
 * `ingestion_jobs`' own counters.
 */
/** Exported for Phase 9's bulk-import worker, which reaches a `"failed"`/`"skipped"`
 * terminal outcome directly (e.g. a permanently corrupt/unsupported source image)
 * without ever calling `saveNewBook`/`saveForReview` — it still needs the exact
 * same job-counter/completion bookkeeping those two already get for free. */
export async function advanceParentJob(tx: Transaction, jobId: string, outcome: "processed" | "failed" | "skipped" = "processed"): Promise<void> {
  const setClause =
    outcome === "failed"
      ? { failedItems: sql`${ingestionJobs.failedItems} + 1` }
      : outcome === "skipped"
        ? { skippedItems: sql`${ingestionJobs.skippedItems} + 1` }
        : { processedItems: sql`${ingestionJobs.processedItems} + 1` };

  const [job] = await tx
    .update(ingestionJobs)
    .set(setClause)
    .where(eq(ingestionJobs.id, jobId))
    .returning({ totalItems: ingestionJobs.totalItems, processedItems: ingestionJobs.processedItems, failedItems: ingestionJobs.failedItems, skippedItems: ingestionJobs.skippedItems });

  if (job && job.processedItems + job.failedItems + job.skippedItems >= job.totalItems) {
    await tx.update(ingestionJobs).set({ status: "completed", completedAt: new Date() }).where(eq(ingestionJobs.id, jobId));
  }
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
        coverSourceType: input.coverSourceType ?? "teacher_upload",
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

    const [completedItem] = await tx
      .update(ingestionItems)
      .set({ status: "completed", resultingCopyId: copyRow.id, completedAt: new Date() })
      .where(eq(ingestionItems.id, input.ingestionItemId))
      .returning({ jobId: ingestionItems.jobId });
    await advanceParentJob(tx, completedItem.jobId, "processed");

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

    const [completedItem] = await tx
      .update(ingestionItems)
      .set({ status: "completed", resultingCopyId: copyRow.id, completedAt: new Date() })
      .where(eq(ingestionItems.id, input.ingestionItemId))
      .returning({ jobId: ingestionItems.jobId });
    await advanceParentJob(tx, completedItem.jobId, "processed");

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
    /** `"teacher_upload"` (default, unchanged Phase 7 behavior) or `"bulk_import"` —
     * see `NewBookInput.coverSourceType`'s identical comment. */
    coverSourceType?: "teacher_upload" | "bulk_import";
  };
  /** The `review_flags.flag_type` this needs-review outcome actually represents —
   * defaults to `"low_identification_confidence"`, Phase 7's only real case (a
   * teacher's own free-text "review this later" reason is never about a specific
   * *kind* of uncertainty the system itself detected). Phase 9's bulk importer
   * routes many distinct kinds of uncertainty here (weak identity, an unresolved
   * duplicate, an uncertain category, conflicting candidates, a corrupt/unsupported
   * image) and must record the flag type that actually matches, so Phase 8's
   * computed Admin Review queue labels/prioritizes it correctly instead of every
   * bulk-import review reading as the same generic reason. */
  flagType?: ReviewFlagType;
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
 *
 * **Marks the parent `ingestion_jobs` row `"completed"`** (Phase 7 final closure
 * pass §2, revising the correction pass's earlier "leave it running" choice): the
 * automated single-add *processing run* is what a job tracks, and that run is done
 * — cover captured, identified (or honestly not), reconciled, duplicate-checked —
 * the same as any other single-item job. What remains is a future HUMAN review of
 * the resulting ITEM, which `ingestion_items.status = 'needs_review'` (plus the
 * preserved draft) already represents; that pending work belongs to the item, not
 * to the job that produced it. No new `ingestion_job_status` enum value, no
 * workflow engine — this reuses the exact same `advanceParentJob()` helper the
 * other two terminal save paths already use.
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
          coverSourceType: input.pendingBook.coverSourceType ?? "teacher_upload",
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
        flagType: input.flagType ?? "low_identification_confidence",
        detail: input.reviewReason,
      });
    }

    const [updatedItem] = await tx
      .update(ingestionItems)
      .set({
        status: "needs_review",
        reviewReason: input.reviewReason,
        intakeDraft: input.draft,
        ...(bookId ? { pendingBookId: bookId } : {}),
      })
      .where(eq(ingestionItems.id, input.ingestionItemId))
      .returning({ jobId: ingestionItems.jobId });

    await advanceParentJob(tx, updatedItem.jobId, "processed");

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
