import { afterAll, afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import {
  auditLog,
  bookContributors,
  bookCopies,
  bookDuplicates,
  bookFieldProvenance,
  books,
  contributors,
  EMBEDDING_DIMENSIONS,
  ingestionItems,
  ingestionJobs,
  physicalCategories,
  reviewFlags,
  taxonomySuggestions,
} from "@/db/schema";
import { createInitialDraft, parseIntakeDraft, type IntakeDraft } from "@/lib/intake/draft";
import { loadAdminReviewQueue } from "@/lib/admin/reviewQueueSource";
import { loadAdminReviewDetail } from "@/lib/admin/reviewDetail";
import {
  approveReviewLater,
  resolveDuplicate,
  updateBookMetadata,
  archiveBook,
  createCategory,
  updateCategory,
  setCategoryActive,
  approveTaxonomySuggestion,
  rejectTaxonomySuggestion,
  mergeTaxonomySuggestionIntoCategory,
  resolveReviewFlag,
} from "@/lib/admin/persistence";
import { requireTestDatabaseUrl, createTestDb } from "./testDb";

const hasTestDb = (() => {
  try {
    requireTestDatabaseUrl();
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!hasTestDb)("Phase 8 admin review + taxonomy (against a real Postgres database)", () => {
  const { db, client } = hasTestDb ? createTestDb() : ({} as ReturnType<typeof createTestDb>);
  const createdBookIds: string[] = [];
  const createdIngestionItemIds: string[] = [];
  const createdJobIds: string[] = [];
  const createdCategoryIds: string[] = [];
  const createdSuggestionIds: string[] = [];

  afterEach(async () => {
    for (const id of createdIngestionItemIds.splice(0)) {
      await db.update(ingestionItems).set({ resultingCopyId: null, pendingBookId: null }).where(eq(ingestionItems.id, id));
    }
    for (const id of createdSuggestionIds.splice(0)) {
      await db.delete(taxonomySuggestions).where(eq(taxonomySuggestions.id, id));
    }
    for (const id of createdBookIds.splice(0)) {
      await db.delete(bookDuplicates).where(eq(bookDuplicates.bookIdA, id));
      await db.delete(bookDuplicates).where(eq(bookDuplicates.bookIdB, id));
      await db.delete(books).where(eq(books.id, id));
    }
    for (const id of createdJobIds.splice(0)) {
      await db.delete(ingestionJobs).where(eq(ingestionJobs.id, id));
    }
    for (const id of createdCategoryIds.splice(0)) {
      await db.delete(physicalCategories).where(eq(physicalCategories.id, id));
    }
  });

  afterAll(async () => {
    if (hasTestDb) await client.end();
  });

  async function makeIngestionItem(): Promise<string> {
    const [job] = await db.insert(ingestionJobs).values({ jobType: "single_add", source: "teacher_capture", status: "running", totalItems: 1 }).returning({ id: ingestionJobs.id });
    createdJobIds.push(job.id);
    const [item] = await db.insert(ingestionItems).values({ jobId: job.id, driveFileId: `test-drive-file-${crypto.randomUUID()}`, status: "processing" }).returning({ id: ingestionItems.id });
    createdIngestionItemIds.push(item.id);
    return item.id;
  }

  function baseDraft(overrides: Partial<IntakeDraft> = {}): IntakeDraft {
    const draft = createInitialDraft({
      fileId: `test-drive-file-${crypto.randomUUID()}`,
      filename: "cover.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 12345,
      checksum: null,
    });
    return parseIntakeDraft({ ...draft, ...overrides });
  }

  async function markNeedsReview(ingestionItemId: string, draft: IntakeDraft, pendingBookId?: string): Promise<void> {
    await db
      .update(ingestionItems)
      .set({ status: "needs_review", reviewReason: "Test fixture", intakeDraft: draft, pendingBookId: pendingBookId ?? null })
      .where(eq(ingestionItems.id, ingestionItemId));
  }

  // ---------------------------------------------------------------------
  // Review queue sourcing (§42)
  // ---------------------------------------------------------------------

  it("a needs_review ingestion item with NO book row still appears in the queue", async () => {
    const ingestionItemId = await makeIngestionItem();
    const draft = baseDraft({ proposedBookValues: { title: "Ingestion Only Book", subtitle: null, authors: ["A. Author"], illustrators: [], publisher: null, languageCode: "en", additionalLanguageCodes: [], isbn10: null, isbn13: null } });
    await markNeedsReview(ingestionItemId, draft);

    const queue = await loadAdminReviewQueue(db);
    const item = queue.find((i) => i.ingestionItemId === ingestionItemId);
    expect(item).toBeDefined();
    expect(item!.bookId).toBeUndefined();
    expect(item!.title).toBe("Ingestion Only Book");
  });

  it("an unreadable/invalid stored draft does not crash the queue — it shows a calm identity_needs_review reason", async () => {
    const ingestionItemId = await makeIngestionItem();
    await db.update(ingestionItems).set({ status: "needs_review", intakeDraft: { garbage: true } }).where(eq(ingestionItems.id, ingestionItemId));

    const queue = await loadAdminReviewQueue(db);
    const item = queue.find((i) => i.ingestionItemId === ingestionItemId);
    expect(item).toBeDefined();
    expect(item!.primaryReason.code).toBe("identity_needs_review");
  });

  it("a resolved (completed) ingestion item does not appear in the queue", async () => {
    const ingestionItemId = await makeIngestionItem();
    await markNeedsReview(ingestionItemId, baseDraft());
    await db.update(ingestionItems).set({ status: "completed" }).where(eq(ingestionItems.id, ingestionItemId));

    const queue = await loadAdminReviewQueue(db);
    expect(queue.find((i) => i.ingestionItemId === ingestionItemId)).toBeUndefined();
  });

  it("an open review flag on an active book appears in the queue; resolving it removes it", async () => {
    const [category] = await db.select().from(physicalCategories).limit(1);
    const [book] = await db
      .insert(books)
      .values({
        title: "Flagged Active Book",
        normalizedTitle: "flagged active book",
        sortTitle: "Flagged Active Book",
        languageCode: "en",
        physicalCategoryId: category.id,
        reviewStatus: "active",
        // Otherwise-complete metadata (§45 test isolation) — this test's only
        // signal should be the review flag itself, not an incidental
        // missing_metadata reason from a bare-minimum fixture row.
        shortDescription: "A complete description so this book has no missing-metadata signal of its own.",
        ageMinMonths: 24,
        ageMaxMonths: 60,
        format: "picture_book",
        visualRealism: "cartoon",
      })
      .returning({ id: books.id });
    createdBookIds.push(book.id);
    const [author] = await db.insert(contributors).values({ name: "Test Author For Flag Fixture", normalizedName: `test author for flag fixture ${crypto.randomUUID()}` }).returning({ id: contributors.id });
    await db.insert(bookContributors).values({ bookId: book.id, contributorId: author.id, role: "author", sortOrder: 0 });
    const [flag] = await db.insert(reviewFlags).values({ bookId: book.id, flagType: "category_uncertain", detail: "Test flag" }).returning({ id: reviewFlags.id });

    let queue = await loadAdminReviewQueue(db);
    let item = queue.find((i) => i.bookId === book.id);
    expect(item).toBeDefined();
    expect(item!.reasons.some((r) => r.code === "category_uncertain")).toBe(true);

    await db.update(reviewFlags).set({ status: "resolved" }).where(eq(reviewFlags.id, flag.id));
    queue = await loadAdminReviewQueue(db);
    item = queue.find((i) => i.bookId === book.id);
    expect(item).toBeUndefined();
  });

  it("loadAdminReviewDetail resolves an ingestion-keyed item and a book-keyed item by their queue key", async () => {
    const ingestionItemId = await makeIngestionItem();
    const draft = baseDraft({ proposedBookValues: { title: "Detail Test Book", subtitle: null, authors: [], illustrators: [], publisher: null, languageCode: "en", additionalLanguageCodes: [], isbn10: null, isbn13: null } });
    await markNeedsReview(ingestionItemId, draft);

    const detail = await loadAdminReviewDetail(db, `ingestion:${ingestionItemId}`);
    expect(detail).toBeDefined();
    expect(detail!.draft?.proposedBookValues?.title).toBe("Detail Test Book");
    expect(detail!.draftInvalid).toBe(false);
  });

  // ---------------------------------------------------------------------
  // Review Later resolution (§43)
  // ---------------------------------------------------------------------

  it("approveReviewLater on an ingestion-only item creates a real active book, its first copy, exactly once, and completes the ingestion item", async () => {
    const ingestionItemId = await makeIngestionItem();
    const draft = baseDraft({ proposedBookValues: { title: "Newly Approved Book", subtitle: null, authors: ["Admin Approved Author"], illustrators: [], publisher: null, languageCode: "en", additionalLanguageCodes: [], isbn10: null, isbn13: null } });
    await markNeedsReview(ingestionItemId, draft);

    const result = await approveReviewLater(db, { ingestionItemId, edits: {}, categorySlug: "stories-imagination" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    createdBookIds.push(result.bookId);

    const [bookRow] = await db.select().from(books).where(eq(books.id, result.bookId)).limit(1);
    expect(bookRow.title).toBe("Newly Approved Book");
    expect(bookRow.reviewStatus).toBe("active");

    const copies = await db.select().from(bookCopies).where(eq(bookCopies.bookId, result.bookId));
    expect(copies).toHaveLength(1);

    const [itemRow] = await db.select().from(ingestionItems).where(eq(ingestionItems.id, ingestionItemId)).limit(1);
    expect(itemRow.status).toBe("completed");
  });

  it("approveReviewLater on an item with an existing pending_review book FINALIZES it rather than creating a second book, and creates exactly one copy", async () => {
    const ingestionItemId = await makeIngestionItem();
    const [category] = await db.select().from(physicalCategories).where(eq(physicalCategories.slug, "stories-imagination")).limit(1);
    const [pendingBook] = await db
      .insert(books)
      .values({ title: "Pending Placeholder Book", normalizedTitle: "pending placeholder book", sortTitle: "Pending Placeholder Book", languageCode: "en", reviewStatus: "pending_review" })
      .returning({ id: books.id });
    createdBookIds.push(pendingBook.id);

    const draft = baseDraft({ proposedBookValues: { title: "Pending Placeholder Book", subtitle: null, authors: [], illustrators: [], publisher: null, languageCode: "en", additionalLanguageCodes: [], isbn10: null, isbn13: null } });
    await markNeedsReview(ingestionItemId, draft, pendingBook.id);

    const result = await approveReviewLater(db, { ingestionItemId, edits: {}, categorySlug: category.slug });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bookId).toBe(pendingBook.id); // the SAME book, never a second one

    const [bookRow] = await db.select().from(books).where(eq(books.id, pendingBook.id)).limit(1);
    expect(bookRow.reviewStatus).toBe("active");

    const allBooksWithThisTitle = await db.select().from(books).where(eq(books.title, "Pending Placeholder Book"));
    expect(allBooksWithThisTitle).toHaveLength(1); // no second active bibliographic record

    const copies = await db.select().from(bookCopies).where(eq(bookCopies.bookId, pendingBook.id));
    expect(copies).toHaveLength(1);
  });

  it("approving an already-resolved (not needs_review) item fails calmly rather than double-processing", async () => {
    const ingestionItemId = await makeIngestionItem();
    await markNeedsReview(ingestionItemId, baseDraft());
    await db.update(ingestionItems).set({ status: "completed" }).where(eq(ingestionItems.id, ingestionItemId));

    const result = await approveReviewLater(db, { ingestionItemId, edits: {}, categorySlug: "stories-imagination" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("already_resolved");
  });

  it("approving without a title fails with insufficient_data, never silently saving a titleless record", async () => {
    const ingestionItemId = await makeIngestionItem();
    await markNeedsReview(ingestionItemId, baseDraft());
    const result = await approveReviewLater(db, { ingestionItemId, edits: {}, categorySlug: "stories-imagination" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("insufficient_data");
  });

  // ---------------------------------------------------------------------
  // Duplicate resolution (§44)
  // ---------------------------------------------------------------------

  it("SAME EDITION: adds a physical copy to the existing book, creates no second active bibliographic record, and completes the ingestion item", async () => {
    const [category] = await db.select().from(physicalCategories).where(eq(physicalCategories.slug, "stories-imagination")).limit(1);
    const [existingBook] = await db
      .insert(books)
      .values({ title: "Existing Canonical Book", normalizedTitle: "existing canonical book", sortTitle: "Existing Canonical Book", languageCode: "en", physicalCategoryId: category.id, reviewStatus: "active" })
      .returning({ id: books.id });
    createdBookIds.push(existingBook.id);

    const ingestionItemId = await makeIngestionItem();
    await markNeedsReview(ingestionItemId, baseDraft({ duplicateOutcome: "exact_copy_same_edition", duplicateCandidateBookIds: [existingBook.id] }));

    const result = await resolveDuplicate(db, { ingestionItemId, action: "same_edition", existingBookId: existingBook.id });
    expect(result.ok).toBe(true);

    const copies = await db.select().from(bookCopies).where(eq(bookCopies.bookId, existingBook.id));
    expect(copies).toHaveLength(1);

    const [itemRow] = await db.select().from(ingestionItems).where(eq(ingestionItems.id, ingestionItemId)).limit(1);
    expect(itemRow.status).toBe("completed");
  });

  it("SAME EDITION with a pending placeholder: archives the placeholder (never hard-deletes it) and resolves its open review flags", async () => {
    const [category] = await db.select().from(physicalCategories).where(eq(physicalCategories.slug, "stories-imagination")).limit(1);
    const [existingBook] = await db
      .insert(books)
      .values({ title: "Existing Canonical Book 2", normalizedTitle: "existing canonical book 2", sortTitle: "Existing Canonical Book 2", languageCode: "en", physicalCategoryId: category.id, reviewStatus: "active" })
      .returning({ id: books.id });
    createdBookIds.push(existingBook.id);

    const [placeholder] = await db
      .insert(books)
      .values({ title: "Placeholder To Archive", normalizedTitle: "placeholder to archive", sortTitle: "Placeholder To Archive", languageCode: "en", reviewStatus: "pending_review" })
      .returning({ id: books.id });
    createdBookIds.push(placeholder.id);
    await db.insert(reviewFlags).values({ bookId: placeholder.id, flagType: "duplicate_uncertain" });

    const ingestionItemId = await makeIngestionItem();
    await markNeedsReview(ingestionItemId, baseDraft({ duplicateOutcome: "exact_copy_same_edition", duplicateCandidateBookIds: [existingBook.id] }), placeholder.id);

    const result = await resolveDuplicate(db, { ingestionItemId, action: "same_edition", existingBookId: existingBook.id });
    expect(result.ok).toBe(true);

    const [placeholderRow] = await db.select().from(books).where(eq(books.id, placeholder.id)).limit(1);
    expect(placeholderRow).toBeDefined(); // never hard-deleted
    expect(placeholderRow.reviewStatus).toBe("archived");

    const flags = await db.select().from(reviewFlags).where(eq(reviewFlags.bookId, placeholder.id));
    expect(flags.every((f) => f.status === "resolved")).toBe(true);
  });

  it("DIFFERENT EDITION: preserves a separate bibliographic record and records the relationship, and clears the item's stored duplicate outcome so approval can proceed afterward", async () => {
    const [category] = await db.select().from(physicalCategories).where(eq(physicalCategories.slug, "stories-imagination")).limit(1);
    const [existingBook] = await db
      .insert(books)
      .values({ title: "Existing Different Edition Target", normalizedTitle: "existing different edition target", sortTitle: "x", languageCode: "en", physicalCategoryId: category.id, reviewStatus: "active" })
      .returning({ id: books.id });
    createdBookIds.push(existingBook.id);

    const [pendingBook] = await db
      .insert(books)
      .values({ title: "New Edition Of Existing Book", normalizedTitle: "new edition of existing book", sortTitle: "New Edition Of Existing Book", languageCode: "en", reviewStatus: "pending_review" })
      .returning({ id: books.id });
    createdBookIds.push(pendingBook.id);

    const ingestionItemId = await makeIngestionItem();
    const draft = baseDraft({
      duplicateOutcome: "same_title_different_edition",
      duplicateCandidateBookIds: [existingBook.id],
      proposedBookValues: { title: "New Edition Of Existing Book", subtitle: null, authors: [], illustrators: [], publisher: null, languageCode: "en", additionalLanguageCodes: [], isbn10: null, isbn13: null },
    });
    await markNeedsReview(ingestionItemId, draft, pendingBook.id);

    const result = await resolveDuplicate(db, { ingestionItemId, action: "different_edition", existingBookId: existingBook.id });
    expect(result.ok).toBe(true);

    const relationships = await db.select().from(bookDuplicates).where(eq(bookDuplicates.bookIdA, pendingBook.id));
    expect(relationships).toHaveLength(1);
    expect(relationships[0].relationshipType).toBe("same_title_different_edition");

    // The pending book still exists, distinct from the existing one.
    const [pendingRow] = await db.select().from(books).where(eq(books.id, pendingBook.id)).limit(1);
    expect(pendingRow.reviewStatus).toBe("pending_review"); // not yet finalized by resolveDuplicate itself

    // The stored draft's duplicateOutcome must now be cleared, or a subsequent
    // approveReviewLater call would stay permanently blocked.
    const [itemRow] = await db.select({ intakeDraft: ingestionItems.intakeDraft }).from(ingestionItems).where(eq(ingestionItems.id, ingestionItemId)).limit(1);
    expect((itemRow.intakeDraft as IntakeDraft).duplicateOutcome).toBe("no_match");

    const approval = await approveReviewLater(db, { ingestionItemId, edits: {}, categorySlug: category.slug });
    expect(approval.ok).toBe(true);
  });

  it("FALSE MATCH: never merges, and the resolution is persisted as a rejected relationship", async () => {
    const [category] = await db.select().from(physicalCategories).limit(1);
    const [existingBook] = await db
      .insert(books)
      .values({ title: "Coincidentally Similar Title", normalizedTitle: "coincidentally similar title", sortTitle: "x", languageCode: "en", physicalCategoryId: category.id, reviewStatus: "active" })
      .returning({ id: books.id });
    createdBookIds.push(existingBook.id);
    const [pendingBook] = await db
      .insert(books)
      .values({ title: "Coincidentally Similar Title Two", normalizedTitle: "x", sortTitle: "x", languageCode: "en", reviewStatus: "pending_review" })
      .returning({ id: books.id });
    createdBookIds.push(pendingBook.id);

    const ingestionItemId = await makeIngestionItem();
    await markNeedsReview(ingestionItemId, baseDraft({ duplicateOutcome: "ambiguous_similar_title", duplicateCandidateBookIds: [existingBook.id] }), pendingBook.id);

    const result = await resolveDuplicate(db, { ingestionItemId, action: "false_match", existingBookId: existingBook.id });
    expect(result.ok).toBe(true);

    const relationships = await db.select().from(bookDuplicates).where(eq(bookDuplicates.bookIdA, pendingBook.id));
    expect(relationships[0].relationshipType).toBe("false_match");
    const [pendingRow] = await db.select().from(books).where(eq(books.id, pendingBook.id)).limit(1);
    expect(pendingRow.reviewStatus).toBe("pending_review"); // never archived/merged by a false match
  });

  it("UNRESOLVED: leaves the item exactly as it was — still needs_review, no relationship created", async () => {
    const ingestionItemId = await makeIngestionItem();
    await markNeedsReview(ingestionItemId, baseDraft({ duplicateOutcome: "ambiguous_similar_title" }));

    const result = await resolveDuplicate(db, { ingestionItemId, action: "unresolved" });
    expect(result.ok).toBe(true);

    const [itemRow] = await db.select().from(ingestionItems).where(eq(ingestionItems.id, ingestionItemId)).limit(1);
    expect(itemRow.status).toBe("needs_review");
  });

  // ---------------------------------------------------------------------
  // Metadata editing / provenance (§45)
  // ---------------------------------------------------------------------

  it("changing only description writes exactly one human_corrected provenance row for description, and untouched fields are unaffected", async () => {
    const [category] = await db.select().from(physicalCategories).limit(1);
    const [book] = await db
      .insert(books)
      .values({ title: "Metadata Edit Target", normalizedTitle: "metadata edit target", sortTitle: "x", languageCode: "en", physicalCategoryId: category.id, reviewStatus: "active" })
      .returning({ id: books.id });
    createdBookIds.push(book.id);
    await db.insert(bookFieldProvenance).values({ bookId: book.id, fieldKey: "physical_category", sourceType: "ai_inferred", isCurrent: true });

    const result = await updateBookMetadata(db, { bookId: book.id, patch: { description: "A new admin-written description." } });
    expect(result.ok).toBe(true);

    const provenanceRows = await db.select().from(bookFieldProvenance).where(eq(bookFieldProvenance.bookId, book.id));
    const currentDescription = provenanceRows.filter((r) => r.fieldKey === "description" && r.isCurrent);
    expect(currentDescription).toHaveLength(1);
    expect(currentDescription[0].sourceType).toBe("human_corrected");

    const currentCategory = provenanceRows.filter((r) => r.fieldKey === "physical_category" && r.isCurrent);
    expect(currentCategory).toHaveLength(1);
    expect(currentCategory[0].sourceType).toBe("ai_inferred"); // untouched, unaffected

    const [bookRow] = await db.select().from(books).where(eq(books.id, book.id)).limit(1);
    expect(bookRow.shortDescription).toBe("A new admin-written description.");
    expect(bookRow.searchText).toContain("A new admin-written description");
  });

  it("explicitly clearing a nullable field (description -> null) persists null, never falling back to the previous value", async () => {
    const [category] = await db.select().from(physicalCategories).limit(1);
    const [book] = await db
      .insert(books)
      .values({ title: "Clear Field Target", normalizedTitle: "clear field target", sortTitle: "x", languageCode: "en", physicalCategoryId: category.id, reviewStatus: "active", shortDescription: "Original description." })
      .returning({ id: books.id });
    createdBookIds.push(book.id);

    const result = await updateBookMetadata(db, { bookId: book.id, patch: { description: null } });
    expect(result.ok).toBe(true);

    const [bookRow] = await db.select().from(books).where(eq(books.id, book.id)).limit(1);
    expect(bookRow.shortDescription).toBeNull();
  });

  it("the current-provenance unique index is never violated across two successive corrections to the same field", async () => {
    const [category] = await db.select().from(physicalCategories).limit(1);
    const [book] = await db
      .insert(books)
      .values({ title: "Double Edit Target", normalizedTitle: "double edit target", sortTitle: "x", languageCode: "en", physicalCategoryId: category.id, reviewStatus: "active" })
      .returning({ id: books.id });
    createdBookIds.push(book.id);

    await updateBookMetadata(db, { bookId: book.id, patch: { description: "First edit." } });
    await expect(updateBookMetadata(db, { bookId: book.id, patch: { description: "Second edit." } })).resolves.toMatchObject({ ok: true });

    const currentRows = await db.select().from(bookFieldProvenance).where(eq(bookFieldProvenance.bookId, book.id));
    const currentDescriptionRows = currentRows.filter((r) => r.fieldKey === "description" && r.isCurrent);
    expect(currentDescriptionRows).toHaveLength(1);
    expect(currentDescriptionRows[0].sourceType).toBe("human_corrected");
  });

  it("explicitly verifying an untouched field records human_verified, never converting unrelated fields", async () => {
    const [category] = await db.select().from(physicalCategories).limit(1);
    const [book] = await db
      .insert(books)
      .values({ title: "Verify Field Target", normalizedTitle: "verify field target", sortTitle: "x", languageCode: "en", physicalCategoryId: category.id, reviewStatus: "active" })
      .returning({ id: books.id });
    createdBookIds.push(book.id);

    const result = await updateBookMetadata(db, { bookId: book.id, patch: { description: "changed" }, explicitlyVerifiedFields: ["physical_category"] });
    expect(result.ok).toBe(true);

    const rows = await db.select().from(bookFieldProvenance).where(eq(bookFieldProvenance.bookId, book.id));
    const category_ = rows.find((r) => r.fieldKey === "physical_category" && r.isCurrent);
    expect(category_?.sourceType).toBe("human_verified");
    expect(rows.some((r) => r.fieldKey === "fiction_status")).toBe(false);
  });

  it("a stale update (expectedUpdatedAt mismatch) is rejected rather than silently overwritten", async () => {
    const [category] = await db.select().from(physicalCategories).limit(1);
    const [book] = await db
      .insert(books)
      .values({ title: "Stale Edit Target", normalizedTitle: "stale edit target", sortTitle: "x", languageCode: "en", physicalCategoryId: category.id, reviewStatus: "active" })
      .returning({ id: books.id });
    createdBookIds.push(book.id);

    const result = await updateBookMetadata(db, { bookId: book.id, patch: { description: "x" }, expectedUpdatedAt: new Date("2000-01-01") });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("stale");
  });

  // ---------------------------------------------------------------------
  // Categories (§46)
  // ---------------------------------------------------------------------

  it("creates a category with a generated slug, real counts of zero, and renaming it preserves the id/slug while updating the label + affected search text", async () => {
    const created = await createCategory(db, { label: "Test Only Category" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    createdCategoryIds.push(created.id);

    const [book] = await db
      .insert(books)
      .values({ title: "Category Rename Target", normalizedTitle: "category rename target", sortTitle: "x", languageCode: "en", physicalCategoryId: created.id, reviewStatus: "active", searchText: "old text Test Only Category" })
      .returning({ id: books.id });
    createdBookIds.push(book.id);

    const renameResult = await updateCategory(db, { categoryId: created.id, label: "Renamed Test Category" });
    expect(renameResult.ok).toBe(true);

    const [categoryRow] = await db.select().from(physicalCategories).where(eq(physicalCategories.id, created.id)).limit(1);
    expect(categoryRow.id).toBe(created.id); // id preserved
    expect(categoryRow.slug).toBe(created.slug); // slug preserved
    expect(categoryRow.label).toBe("Renamed Test Category");

    const [bookRow] = await db.select().from(books).where(eq(books.id, book.id)).limit(1);
    expect(bookRow.searchText).toContain("Renamed Test Category");
    expect(bookRow.searchText).not.toContain("Test Only Category");
  });

  it("a category referenced by an active book cannot be deactivated; a zero-use category can be", async () => {
    const created = await createCategory(db, { label: "Zero Use Category" });
    if (!created.ok) return;
    createdCategoryIds.push(created.id);

    const zeroUseResult = await setCategoryActive(db, created.id, false);
    expect(zeroUseResult.ok).toBe(true);
    await setCategoryActive(db, created.id, true); // reactivate for cleanliness

    const [book] = await db
      .insert(books)
      .values({ title: "Referencing Book", normalizedTitle: "referencing book", sortTitle: "x", languageCode: "en", physicalCategoryId: created.id, reviewStatus: "active" })
      .returning({ id: books.id });
    createdBookIds.push(book.id);

    const blockedResult = await setCategoryActive(db, created.id, false);
    expect(blockedResult.ok).toBe(false);
    if (blockedResult.ok) return;
    expect(blockedResult.error).toBe("blocked_referenced");
    expect(blockedResult.message).toMatch(/re-categorize/i);

    const [categoryRow] = await db.select().from(physicalCategories).where(eq(physicalCategories.id, created.id)).limit(1);
    expect(categoryRow.isActive).toBe(true); // never silently orphaned/deactivated
  });

  // ---------------------------------------------------------------------
  // Taxonomy suggestions (§47)
  // ---------------------------------------------------------------------

  it("approving a taxonomy suggestion creates a real, admin-confirmed category and records the resolution", async () => {
    const [suggestion] = await db.insert(taxonomySuggestions).values({ suggestedName: "Ocean Life", reason: "Several recent books about marine animals." }).returning({ id: taxonomySuggestions.id });
    createdSuggestionIds.push(suggestion.id);

    const result = await approveTaxonomySuggestion(db, suggestion.id, "Ocean Life");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    createdCategoryIds.push(result.categoryId!);

    const [categoryRow] = await db.select().from(physicalCategories).where(eq(physicalCategories.id, result.categoryId!)).limit(1);
    expect(categoryRow.label).toBe("Ocean Life");

    const [suggestionRow] = await db.select().from(taxonomySuggestions).where(eq(taxonomySuggestions.id, suggestion.id)).limit(1);
    expect(suggestionRow.status).toBe("approved");
    expect(suggestionRow.resolvedCategoryId).toBe(result.categoryId);
  });

  it("rejecting a suggestion never creates a category", async () => {
    const [suggestion] = await db.insert(taxonomySuggestions).values({ suggestedName: "Rejected Concept", reason: "Not enough evidence." }).returning({ id: taxonomySuggestions.id });
    createdSuggestionIds.push(suggestion.id);

    const before = await db.select().from(physicalCategories);
    const result = await rejectTaxonomySuggestion(db, suggestion.id);
    expect(result.ok).toBe(true);
    const after = await db.select().from(physicalCategories);
    expect(after).toHaveLength(before.length);

    const [suggestionRow] = await db.select().from(taxonomySuggestions).where(eq(taxonomySuggestions.id, suggestion.id)).limit(1);
    expect(suggestionRow.status).toBe("rejected");
  });

  it("merging a suggestion into an existing category records that category, never creates a new one, and never moves existing books", async () => {
    const [existingCategory] = await db.select().from(physicalCategories).limit(1);
    const [book] = await db.select({ id: books.id, physicalCategoryId: books.physicalCategoryId }).from(books).where(eq(books.reviewStatus, "active")).limit(1);

    const [suggestion] = await db.insert(taxonomySuggestions).values({ suggestedName: "Merge Concept", reason: "Overlaps an existing category." }).returning({ id: taxonomySuggestions.id });
    createdSuggestionIds.push(suggestion.id);

    const before = await db.select().from(physicalCategories);
    const result = await mergeTaxonomySuggestionIntoCategory(db, suggestion.id, existingCategory.id);
    expect(result.ok).toBe(true);
    const after = await db.select().from(physicalCategories);
    expect(after).toHaveLength(before.length); // no new category created

    const [suggestionRow] = await db.select().from(taxonomySuggestions).where(eq(taxonomySuggestions.id, suggestion.id)).limit(1);
    expect(suggestionRow.status).toBe("merged");
    expect(suggestionRow.resolvedCategoryId).toBe(existingCategory.id);

    if (book) {
      const [bookRowAfter] = await db.select({ physicalCategoryId: books.physicalCategoryId }).from(books).where(eq(books.id, book.id)).limit(1);
      expect(bookRowAfter.physicalCategoryId).toBe(book.physicalCategoryId); // unchanged
    }
  });

  // ---------------------------------------------------------------------
  // Audit (§48)
  // ---------------------------------------------------------------------

  it("archiving a book records a meaningful audit entry with real action/entity semantics", async () => {
    const [category] = await db.select().from(physicalCategories).limit(1);
    const [book] = await db
      .insert(books)
      .values({ title: "Audit Archive Target", normalizedTitle: "audit archive target", sortTitle: "x", languageCode: "en", physicalCategoryId: category.id, reviewStatus: "active" })
      .returning({ id: books.id });
    createdBookIds.push(book.id);

    const result = await archiveBook(db, book.id, "Duplicate of another record, resolved separately.");
    expect(result.ok).toBe(true);

    const [bookRow] = await db.select().from(books).where(eq(books.id, book.id)).limit(1);
    expect(bookRow.reviewStatus).toBe("archived");

    const auditRows = await db.select().from(auditLog).where(eq(auditLog.entityId, book.id));
    const archiveEntry = auditRows.find((r) => r.action === "book_archived");
    expect(archiveEntry).toBeDefined();
    expect(archiveEntry!.entityType).toBe("book");
    expect((archiveEntry!.detail as { note?: string })?.note).toContain("Duplicate");
  });

  // ---------------------------------------------------------------------
  // Correction pass §2 — Review Later metadata parity + display cover
  // ---------------------------------------------------------------------

  function draftWithFullMetadata(overrides: Partial<IntakeDraft> = {}): IntakeDraft {
    return baseDraft({
      proposedBookValues: {
        title: "Parity Test Book",
        subtitle: "A Parity Subtitle",
        authors: ["Parity Author"],
        illustrators: ["Parity Illustrator"],
        publisher: "Parity Publisher",
        languageCode: "en",
        additionalLanguageCodes: [],
        // No ISBN here — `books.isbn13` has a real partial UNIQUE index, and
        // this helper is shared by both approval branches in the same test;
        // ISBN-10/13 parity is proven separately below with one book at a time.
        isbn10: null,
        isbn13: null,
      },
      enrichmentSuggestion: {
        description: "A parity-test description.",
        tags: ["parity-tag"],
        fictionType: "fiction",
        format: "picture_book",
        ageMinMonths: 24,
        ageMaxMonths: 60,
        readAloudMinutes: 5,
        visualMediaTypes: ["watercolor"],
        visualRealism: "stylized_illustration",
        physicalCategorySlug: "stories-imagination",
        categoryConfidence: "high",
        categoryReason: "test",
      },
      aiSuggestionsStatus: "valid",
      categorySuggestion: { slug: "stories-imagination", label: "Stories & Imagination", confidence: "high", reason: "test" },
      ...overrides,
    });
  }

  it("ingestion-only and existing-pending-book approval preserve the SAME relevant metadata given equivalent drafts (subtitle, illustrators, publisher, ISBN)", async () => {
    const [category] = await db.select().from(physicalCategories).where(eq(physicalCategories.slug, "stories-imagination")).limit(1);

    // Ingestion-only branch.
    const ingestionOnlyItemId = await makeIngestionItem();
    await markNeedsReview(ingestionOnlyItemId, draftWithFullMetadata({ proposedBookValues: { ...draftWithFullMetadata().proposedBookValues!, title: "Parity Test Book A" } }));
    const ingestionOnlyResult = await approveReviewLater(db, { ingestionItemId: ingestionOnlyItemId, edits: {}, categorySlug: category.slug });
    expect(ingestionOnlyResult.ok).toBe(true);
    if (!ingestionOnlyResult.ok) return;
    createdBookIds.push(ingestionOnlyResult.bookId);

    // Existing-pending-book branch, same input metadata.
    const [pendingBook] = await db
      .insert(books)
      .values({ title: "Parity Test Book B", normalizedTitle: "parity test book b", sortTitle: "Parity Test Book B", languageCode: "en", reviewStatus: "pending_review" })
      .returning({ id: books.id });
    createdBookIds.push(pendingBook.id);
    const pendingItemId = await makeIngestionItem();
    await markNeedsReview(pendingItemId, draftWithFullMetadata({ proposedBookValues: { ...draftWithFullMetadata().proposedBookValues!, title: "Parity Test Book B" } }), pendingBook.id);
    const pendingResult = await approveReviewLater(db, { ingestionItemId: pendingItemId, edits: {}, categorySlug: category.slug });
    expect(pendingResult.ok).toBe(true);
    if (!pendingResult.ok) return;

    const [bookA] = await db.select().from(books).where(eq(books.id, ingestionOnlyResult.bookId)).limit(1);
    const [bookB] = await db.select().from(books).where(eq(books.id, pendingResult.bookId)).limit(1);

    for (const [field, a, b] of [
      ["subtitle", bookA.subtitle, bookB.subtitle],
      ["languageCode", bookA.languageCode, bookB.languageCode],
      ["fictionStatus", bookA.fictionStatus, bookB.fictionStatus],
      ["format", bookA.format, bookB.format],
      ["ageMinMonths", bookA.ageMinMonths, bookB.ageMinMonths],
      ["ageMaxMonths", bookA.ageMaxMonths, bookB.ageMaxMonths],
      ["visualRealism", bookA.visualRealism, bookB.visualRealism],
      ["physicalCategoryId", bookA.physicalCategoryId, bookB.physicalCategoryId],
    ] as const) {
      expect(a, `expected ${field} to match between the two approval branches`).toEqual(b);
    }
    expect(bookA.subtitle).toBe("A Parity Subtitle");
    expect(bookB.subtitle).toBe("A Parity Subtitle"); // previously always null — finalizePendingBook dropped subtitle entirely
    expect(bookA.publisherId).not.toBeNull();
    expect(bookB.publisherId).not.toBeNull(); // previously always null — finalizePendingBook dropped publisher entirely

    const contributorsA = await db.select({ role: bookContributors.role }).from(bookContributors).where(eq(bookContributors.bookId, ingestionOnlyResult.bookId));
    const contributorsB = await db.select({ role: bookContributors.role }).from(bookContributors).where(eq(bookContributors.bookId, pendingResult.bookId));
    expect(contributorsA.some((c) => c.role === "illustrator")).toBe(true);
    expect(contributorsB.some((c) => c.role === "illustrator")).toBe(true); // previously always false — finalizePendingBook dropped illustrators entirely
  });

  it("the existing-pending-book approval branch also persists ISBN-10/13 (previously always dropped)", async () => {
    const [category] = await db.select().from(physicalCategories).where(eq(physicalCategories.slug, "stories-imagination")).limit(1);
    const [pendingBook] = await db
      .insert(books)
      .values({ title: "Isbn Parity Pending Book", normalizedTitle: "isbn parity pending book", sortTitle: "Isbn Parity Pending Book", languageCode: "en", reviewStatus: "pending_review" })
      .returning({ id: books.id });
    createdBookIds.push(pendingBook.id);

    const itemId = await makeIngestionItem();
    await markNeedsReview(
      itemId,
      draftWithFullMetadata({ proposedBookValues: { ...draftWithFullMetadata().proposedBookValues!, title: "Isbn Parity Pending Book", isbn10: "0000000099", isbn13: "0000000000099" } }),
      pendingBook.id
    );
    const result = await approveReviewLater(db, { ingestionItemId: itemId, edits: {}, categorySlug: category.slug });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const [bookRow] = await db.select().from(books).where(eq(books.id, result.bookId)).limit(1);
    expect(bookRow.isbn10).toBe("0000000099");
    expect(bookRow.isbn13).toBe("0000000000099");
  });

  it("a trusted, high-confidence provider candidate's thumbnail becomes the display cover on BOTH approval branches", async () => {
    const [category] = await db.select().from(physicalCategories).where(eq(physicalCategories.slug, "stories-imagination")).limit(1);
    const trustedThumbnail = "http://books.google.com/books/content?id=abc&printsec=frontcover";

    const [pendingBook] = await db
      .insert(books)
      .values({ title: "Trusted Cover Book", normalizedTitle: "trusted cover book", sortTitle: "Trusted Cover Book", languageCode: "en", reviewStatus: "pending_review" })
      .returning({ id: books.id });
    createdBookIds.push(pendingBook.id);

    const itemId = await makeIngestionItem();
    const draft = draftWithFullMetadata({
      proposedBookValues: { ...draftWithFullMetadata().proposedBookValues!, title: "Trusted Cover Book" },
      reconciliationOutcome: "high_confidence",
      selectedCandidateProviderIdentifier: "provider-1",
      metadataCandidates: [
        { provider: "google_books", providerIdentifier: "provider-1", title: "Trusted Cover Book", matchScore: 1, matchedSignals: ["title"], thumbnailUrl: trustedThumbnail },
      ],
    });
    await markNeedsReview(itemId, draft, pendingBook.id);

    const result = await approveReviewLater(db, { ingestionItemId: itemId, edits: {}, categorySlug: category.slug });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const [bookRow] = await db.select().from(books).where(eq(books.id, result.bookId)).limit(1);
    expect(bookRow.displayCoverUrl).toBe("https://books.google.com/books/content?id=abc&printsec=frontcover");
    expect(bookRow.displayCoverSource).toBe("external_provider_thumbnail");
  });

  it("an ambiguous (not high-confidence) candidate's thumbnail never becomes the display cover, even if one was supplied", async () => {
    const [category] = await db.select().from(physicalCategories).where(eq(physicalCategories.slug, "stories-imagination")).limit(1);

    const itemId = await makeIngestionItem();
    const draft = draftWithFullMetadata({
      proposedBookValues: { ...draftWithFullMetadata().proposedBookValues!, title: "Ambiguous Cover Book" },
      reconciliationOutcome: "ambiguous",
      selectedCandidateProviderIdentifier: null,
      metadataCandidates: [
        { provider: "google_books", providerIdentifier: "provider-2", title: "Ambiguous Cover Book", matchScore: 0.5, matchedSignals: ["title"], thumbnailUrl: "http://books.google.com/books/content?id=xyz" },
      ],
    });
    await markNeedsReview(itemId, draft);

    const result = await approveReviewLater(db, { ingestionItemId: itemId, edits: {}, categorySlug: category.slug });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    createdBookIds.push(result.bookId);

    const [bookRow] = await db.select().from(books).where(eq(books.id, result.bookId)).limit(1);
    expect(bookRow.displayCoverUrl).toBeNull();
  });

  // ---------------------------------------------------------------------
  // Correction pass §3 — review-flag lifecycle
  // ---------------------------------------------------------------------

  it("Review Later approval resolves the low_identification_confidence flag it addressed, but an unrelated missing_metadata flag survives", async () => {
    const [category] = await db.select().from(physicalCategories).where(eq(physicalCategories.slug, "stories-imagination")).limit(1);
    const [pendingBook] = await db
      .insert(books)
      .values({ title: "Flag Lifecycle Book", normalizedTitle: "flag lifecycle book", sortTitle: "Flag Lifecycle Book", languageCode: "en", reviewStatus: "pending_review" })
      .returning({ id: books.id });
    createdBookIds.push(pendingBook.id);
    await db.insert(reviewFlags).values({ bookId: pendingBook.id, flagType: "low_identification_confidence" });
    await db.insert(reviewFlags).values({ bookId: pendingBook.id, flagType: "missing_metadata", detail: "Unrelated pre-existing concern." });

    const itemId = await makeIngestionItem();
    await markNeedsReview(itemId, draftWithFullMetadata({ proposedBookValues: { ...draftWithFullMetadata().proposedBookValues!, title: "Flag Lifecycle Book" } }), pendingBook.id);

    const result = await approveReviewLater(db, { ingestionItemId: itemId, edits: {}, categorySlug: category.slug });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const flags = await db.select().from(reviewFlags).where(eq(reviewFlags.bookId, result.bookId));
    const identityFlag = flags.find((f) => f.flagType === "low_identification_confidence");
    const unrelatedFlag = flags.find((f) => f.flagType === "missing_metadata");
    expect(identityFlag?.status).toBe("resolved");
    expect(unrelatedFlag?.status).toBe("open"); // never falsely resolved

    // The newly-active book must not immediately reappear in Needs Review
    // because of the flag approval just addressed.
    const queue = await loadAdminReviewQueue(db);
    const queueItem = queue.find((i) => i.bookId === result.bookId);
    expect(queueItem?.reasons.some((r) => r.code === "identity_needs_review" && r.detail == null)).toBeFalsy();
  });

  it("SAME EDITION duplicate resolution resolves duplicate_uncertain on the archived placeholder but leaves an unrelated metadata_conflict flag open", async () => {
    const [category] = await db.select().from(physicalCategories).where(eq(physicalCategories.slug, "stories-imagination")).limit(1);
    const [existingBook] = await db
      .insert(books)
      .values({ title: "Flag Narrowing Existing Book", normalizedTitle: "flag narrowing existing book", sortTitle: "x", languageCode: "en", physicalCategoryId: category.id, reviewStatus: "active" })
      .returning({ id: books.id });
    createdBookIds.push(existingBook.id);
    const [placeholder] = await db
      .insert(books)
      .values({ title: "Flag Narrowing Placeholder", normalizedTitle: "flag narrowing placeholder", sortTitle: "x", languageCode: "en", reviewStatus: "pending_review" })
      .returning({ id: books.id });
    createdBookIds.push(placeholder.id);
    await db.insert(reviewFlags).values({ bookId: placeholder.id, flagType: "duplicate_uncertain" });
    await db.insert(reviewFlags).values({ bookId: placeholder.id, flagType: "metadata_conflict", detail: "Unrelated conflict." });

    const itemId = await makeIngestionItem();
    await markNeedsReview(itemId, baseDraft({ duplicateOutcome: "exact_copy_same_edition", duplicateCandidateBookIds: [existingBook.id] }), placeholder.id);

    const result = await resolveDuplicate(db, { ingestionItemId: itemId, action: "same_edition", existingBookId: existingBook.id });
    expect(result.ok).toBe(true);

    const flags = await db.select().from(reviewFlags).where(eq(reviewFlags.bookId, placeholder.id));
    expect(flags.find((f) => f.flagType === "duplicate_uncertain")?.status).toBe("resolved");
    expect(flags.find((f) => f.flagType === "metadata_conflict")?.status).toBe("open");
  });

  // ---------------------------------------------------------------------
  // Correction pass §4 — semantic embedding invalidation
  // ---------------------------------------------------------------------

  async function setFakeEmbedding(bookId: string): Promise<void> {
    await db
      .update(books)
      .set({
        embedding: Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.01),
        embeddingModel: "test-fake-model",
        embeddingDimension: EMBEDDING_DIMENSIONS,
        embeddingCompositionVersion: 1,
        embeddingSourceHash: "fake-stale-hash",
        embeddingGeneratedAt: new Date(),
      })
      .where(eq(books.id, bookId));
  }

  it("an admin metadata change invalidates a previously-stored embedding immediately, even with no embedding provider configured", async () => {
    const [category] = await db.select().from(physicalCategories).limit(1);
    const [book] = await db
      .insert(books)
      .values({ title: "Embedding Invalidation Target", normalizedTitle: "embedding invalidation target", sortTitle: "x", languageCode: "en", physicalCategoryId: category.id, reviewStatus: "active" })
      .returning({ id: books.id });
    createdBookIds.push(book.id);
    await setFakeEmbedding(book.id);

    const before = await db.select({ embedding: books.embedding, embeddingSourceHash: books.embeddingSourceHash }).from(books).where(eq(books.id, book.id)).limit(1);
    expect(before[0].embedding).not.toBeNull();

    const result = await updateBookMetadata(db, { bookId: book.id, patch: { description: "A brand-new description that changes the embedding document." } });
    expect(result.ok).toBe(true);

    const after = await db.select({ embedding: books.embedding, embeddingModel: books.embeddingModel, embeddingSourceHash: books.embeddingSourceHash, searchText: books.searchText }).from(books).where(eq(books.id, book.id)).limit(1);
    expect(after[0].embedding).toBeNull();
    expect(after[0].embeddingModel).toBeNull();
    expect(after[0].embeddingSourceHash).toBeNull();
    // Conventional search sees the new content immediately regardless.
    expect(after[0].searchText).toContain("brand-new description");
  });

  it("an ISBN-only patch does NOT invalidate the embedding — it never appears in the composed document", async () => {
    const [category] = await db.select().from(physicalCategories).limit(1);
    const [book] = await db
      .insert(books)
      .values({ title: "Isbn Only Patch Target", normalizedTitle: "isbn only patch target", sortTitle: "x", languageCode: "en", physicalCategoryId: category.id, reviewStatus: "active" })
      .returning({ id: books.id });
    createdBookIds.push(book.id);
    await setFakeEmbedding(book.id);

    const result = await updateBookMetadata(db, { bookId: book.id, patch: { isbn13: "9999999999999" } });
    expect(result.ok).toBe(true);

    const after = await db.select({ embedding: books.embedding }).from(books).where(eq(books.id, book.id)).limit(1);
    expect(after[0].embedding).not.toBeNull(); // untouched — isbn changes never affect the embedding document
  });

  it("a category label rename invalidates the embedding for every affected book", async () => {
    const created = await createCategory(db, { label: "Embedding Rename Test Category" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    createdCategoryIds.push(created.id);

    const [book] = await db
      .insert(books)
      .values({ title: "Category Rename Embedding Target", normalizedTitle: "category rename embedding target", sortTitle: "x", languageCode: "en", physicalCategoryId: created.id, reviewStatus: "active" })
      .returning({ id: books.id });
    createdBookIds.push(book.id);
    await setFakeEmbedding(book.id);

    const renameResult = await updateCategory(db, { categoryId: created.id, label: "Renamed Embedding Test Category" });
    expect(renameResult.ok).toBe(true);

    const after = await db.select({ embedding: books.embedding }).from(books).where(eq(books.id, book.id)).limit(1);
    expect(after[0].embedding).toBeNull();
  });

  it("a category guidance-only edit does NOT invalidate embeddings for its books (the label, the only thing that matters, didn't change)", async () => {
    const created = await createCategory(db, { label: "Guidance Only Embedding Category" });
    if (!created.ok) return;
    createdCategoryIds.push(created.id);
    const [book] = await db
      .insert(books)
      .values({ title: "Guidance Only Embedding Target", normalizedTitle: "guidance only embedding target", sortTitle: "x", languageCode: "en", physicalCategoryId: created.id, reviewStatus: "active" })
      .returning({ id: books.id });
    createdBookIds.push(book.id);
    await setFakeEmbedding(book.id);

    const result = await updateCategory(db, { categoryId: created.id, description: "New shelving guidance text." });
    expect(result.ok).toBe(true);

    const after = await db.select({ embedding: books.embedding }).from(books).where(eq(books.id, book.id)).limit(1);
    expect(after[0].embedding).not.toBeNull();
  });

  // ---------------------------------------------------------------------
  // Correction pass §5 — the admin editor can resolve every queue reason it creates
  // ---------------------------------------------------------------------

  it("fixing missing contributors through updateBookMetadata makes the missing-metadata queue item disappear", async () => {
    const [category] = await db.select().from(physicalCategories).limit(1);
    const [book] = await db
      .insert(books)
      .values({
        title: "Missing Contributors Fixable Book",
        normalizedTitle: "missing contributors fixable book",
        sortTitle: "x",
        languageCode: "en",
        physicalCategoryId: category.id,
        reviewStatus: "active",
        shortDescription: "Already has a description.",
        ageMinMonths: 24,
        ageMaxMonths: 60,
        format: "picture_book",
        visualRealism: "cartoon",
      })
      .returning({ id: books.id });
    createdBookIds.push(book.id);

    let queue = await loadAdminReviewQueue(db);
    let item = queue.find((i) => i.bookId === book.id);
    expect(item).toBeDefined();
    expect(item!.reasons.some((r) => r.code === "missing_metadata" && r.detail?.includes("authors/illustrators"))).toBe(true);

    const result = await updateBookMetadata(db, { bookId: book.id, patch: { authors: ["A Real Author"] } });
    expect(result.ok).toBe(true);

    queue = await loadAdminReviewQueue(db);
    item = queue.find((i) => i.bookId === book.id);
    expect(item).toBeUndefined(); // no more missing-metadata signal at all
  });

  it("fixing missing visual style through updateBookMetadata makes the missing-metadata queue item disappear", async () => {
    const [category] = await db.select().from(physicalCategories).limit(1);
    const [author] = await db.insert(contributors).values({ name: "Visual Fix Author", normalizedName: `visual fix author ${crypto.randomUUID()}` }).returning({ id: contributors.id });
    const [book] = await db
      .insert(books)
      .values({
        title: "Missing Visual Style Fixable Book",
        normalizedTitle: "missing visual style fixable book",
        sortTitle: "x",
        languageCode: "en",
        physicalCategoryId: category.id,
        reviewStatus: "active",
        shortDescription: "Already has a description.",
        ageMinMonths: 24,
        ageMaxMonths: 60,
        format: "picture_book",
      })
      .returning({ id: books.id });
    createdBookIds.push(book.id);
    await db.insert(bookContributors).values({ bookId: book.id, contributorId: author.id, role: "author", sortOrder: 0 });

    let queue = await loadAdminReviewQueue(db);
    expect(queue.find((i) => i.bookId === book.id)?.reasons.some((r) => r.detail?.includes("visual style"))).toBe(true);

    const result = await updateBookMetadata(db, { bookId: book.id, patch: { visualRealism: "cartoon" } });
    expect(result.ok).toBe(true);

    queue = await loadAdminReviewQueue(db);
    expect(queue.find((i) => i.bookId === book.id)).toBeUndefined();
  });

  // ---------------------------------------------------------------------
  // Correction pass §7 — exactly-once concurrency
  // ---------------------------------------------------------------------

  function connectSecondTestConnection() {
    const client = postgres(requireTestDatabaseUrl(), { max: 1 });
    return { db: drizzle(client, { schema }), client };
  }

  it("two near-simultaneous SAME EDITION resolutions of the same item cannot both create a copy — the loser gets a calm already-resolved result", async () => {
    const [category] = await db.select().from(physicalCategories).where(eq(physicalCategories.slug, "stories-imagination")).limit(1);
    const [existingBook] = await db
      .insert(books)
      .values({ title: "Concurrency Same Edition Target", normalizedTitle: "concurrency same edition target", sortTitle: "x", languageCode: "en", physicalCategoryId: category.id, reviewStatus: "active" })
      .returning({ id: books.id });
    createdBookIds.push(existingBook.id);

    const itemId = await makeIngestionItem();
    await markNeedsReview(itemId, baseDraft({ duplicateOutcome: "exact_copy_same_edition", duplicateCandidateBookIds: [existingBook.id] }));

    const { db: db2, client: client2 } = connectSecondTestConnection();
    try {
      const [resultA, resultB] = await Promise.all([
        resolveDuplicate(db, { ingestionItemId: itemId, action: "same_edition", existingBookId: existingBook.id }),
        resolveDuplicate(db2, { ingestionItemId: itemId, action: "same_edition", existingBookId: existingBook.id }),
      ]);

      const outcomes = [resultA, resultB];
      expect(outcomes.filter((r) => r.ok)).toHaveLength(1);
      expect(outcomes.filter((r) => !r.ok)).toHaveLength(1);

      const copies = await db.select().from(bookCopies).where(eq(bookCopies.bookId, existingBook.id));
      expect(copies).toHaveLength(1); // never two, regardless of which caller "won"
    } finally {
      await client2.end();
    }
  });

  it("two near-simultaneous ingestion-only Review Later approvals of the same item cannot both create a book", async () => {
    const [category] = await db.select().from(physicalCategories).where(eq(physicalCategories.slug, "stories-imagination")).limit(1);
    const title = "Concurrency Ingestion Only Book";
    const itemId = await makeIngestionItem();
    await markNeedsReview(itemId, baseDraft({ proposedBookValues: { title, subtitle: null, authors: [], illustrators: [], publisher: null, languageCode: "en", additionalLanguageCodes: [], isbn10: null, isbn13: null } }));

    const { db: db2, client: client2 } = connectSecondTestConnection();
    try {
      const [resultA, resultB] = await Promise.all([
        approveReviewLater(db, { ingestionItemId: itemId, edits: {}, categorySlug: category.slug }),
        approveReviewLater(db2, { ingestionItemId: itemId, edits: {}, categorySlug: category.slug }),
      ]);

      const outcomes = [resultA, resultB];
      const succeeded = outcomes.filter((r) => r.ok);
      expect(succeeded).toHaveLength(1);
      expect(outcomes.filter((r) => !r.ok)).toHaveLength(1);
      if (succeeded[0].ok) createdBookIds.push(succeeded[0].bookId);

      const allBooksWithThisTitle = await db.select().from(books).where(eq(books.title, title));
      expect(allBooksWithThisTitle).toHaveLength(1); // never two
    } finally {
      await client2.end();
    }
  });

  // ---------------------------------------------------------------------
  // Correction pass §8 — duplicate target validation
  // ---------------------------------------------------------------------

  it("rejects an arbitrary book id that isn't among the item's persisted duplicate candidates", async () => {
    const [category] = await db.select().from(physicalCategories).limit(1);
    const [arbitraryBook] = await db
      .insert(books)
      .values({ title: "Arbitrary Non Candidate Book", normalizedTitle: "arbitrary non candidate book", sortTitle: "x", languageCode: "en", physicalCategoryId: category.id, reviewStatus: "active" })
      .returning({ id: books.id });
    createdBookIds.push(arbitraryBook.id);

    const itemId = await makeIngestionItem();
    // No duplicateCandidateBookIds at all — arbitraryBook was never offered as a candidate.
    await markNeedsReview(itemId, baseDraft({ duplicateOutcome: "exact_copy_same_edition" }));

    const result = await resolveDuplicate(db, { ingestionItemId: itemId, action: "same_edition", existingBookId: arbitraryBook.id });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("invalid_target");

    const copies = await db.select().from(bookCopies).where(eq(bookCopies.bookId, arbitraryBook.id));
    expect(copies).toHaveLength(0); // no copy was created
  });

  it("rejects an archived book as a duplicate target even if it was once a legitimate candidate", async () => {
    const [category] = await db.select().from(physicalCategories).limit(1);
    const [archivedBook] = await db
      .insert(books)
      .values({ title: "Now Archived Candidate", normalizedTitle: "now archived candidate", sortTitle: "x", languageCode: "en", physicalCategoryId: category.id, reviewStatus: "archived" })
      .returning({ id: books.id });
    createdBookIds.push(archivedBook.id);

    const itemId = await makeIngestionItem();
    await markNeedsReview(itemId, baseDraft({ duplicateOutcome: "exact_copy_same_edition", duplicateCandidateBookIds: [archivedBook.id] }));

    const result = await resolveDuplicate(db, { ingestionItemId: itemId, action: "same_edition", existingBookId: archivedBook.id });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("invalid_target");
  });

  it("rejects a pending item's own placeholder id as a duplicate target of itself", async () => {
    const [placeholder] = await db
      .insert(books)
      .values({ title: "Self Target Placeholder", normalizedTitle: "self target placeholder", sortTitle: "x", languageCode: "en", reviewStatus: "pending_review" })
      .returning({ id: books.id });
    createdBookIds.push(placeholder.id);

    const itemId = await makeIngestionItem();
    await markNeedsReview(itemId, baseDraft({ duplicateOutcome: "exact_copy_same_edition", duplicateCandidateBookIds: [placeholder.id] }), placeholder.id);

    const result = await resolveDuplicate(db, { ingestionItemId: itemId, action: "same_edition", existingBookId: placeholder.id });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("invalid_target");
  });

  // ---------------------------------------------------------------------
  // Correction pass §9 — runtime validation at the mutation boundary
  // ---------------------------------------------------------------------

  it("updateBookMetadata rejects an invalid language code end-to-end, writing nothing", async () => {
    const [category] = await db.select().from(physicalCategories).limit(1);
    const [book] = await db
      .insert(books)
      .values({ title: "Validation Language Target", normalizedTitle: "validation language target", sortTitle: "x", languageCode: "en", physicalCategoryId: category.id, reviewStatus: "active" })
      .returning({ id: books.id });
    createdBookIds.push(book.id);

    const result = await updateBookMetadata(db, { bookId: book.id, patch: { languageCode: "not-a-real-language" } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("invalid_input");

    const [after] = await db.select({ languageCode: books.languageCode }).from(books).where(eq(books.id, book.id)).limit(1);
    expect(after.languageCode).toBe("en"); // unchanged
  });

  it("updateBookMetadata rejects explicitly clearing the title, never silently keeping the old value while still recording a false human_corrected provenance row", async () => {
    const [category] = await db.select().from(physicalCategories).limit(1);
    const [book] = await db
      .insert(books)
      .values({ title: "Validation Title Target", normalizedTitle: "validation title target", sortTitle: "x", languageCode: "en", physicalCategoryId: category.id, reviewStatus: "active" })
      .returning({ id: books.id });
    createdBookIds.push(book.id);

    const result = await updateBookMetadata(db, { bookId: book.id, patch: { title: null } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("invalid_input");

    const [after] = await db.select({ title: books.title }).from(books).where(eq(books.id, book.id)).limit(1);
    expect(after.title).toBe("Validation Title Target");

    const provenanceRows = await db.select().from(bookFieldProvenance).where(eq(bookFieldProvenance.bookId, book.id));
    expect(provenanceRows.some((r) => r.fieldKey === "title")).toBe(false); // no false provenance claim
  });

  it("updateBookMetadata rejects an out-of-range age, writing nothing", async () => {
    const [category] = await db.select().from(physicalCategories).limit(1);
    const [book] = await db
      .insert(books)
      .values({ title: "Validation Age Target", normalizedTitle: "validation age target", sortTitle: "x", languageCode: "en", physicalCategoryId: category.id, reviewStatus: "active" })
      .returning({ id: books.id });
    createdBookIds.push(book.id);

    const result = await updateBookMetadata(db, { bookId: book.id, patch: { ageMinMonths: 500 } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("invalid_input");
  });

  it("a genuinely nullable field can still be explicitly cleared end-to-end", async () => {
    const [category] = await db.select().from(physicalCategories).limit(1);
    const [book] = await db
      .insert(books)
      .values({ title: "Validation Nullable Clear Target", normalizedTitle: "validation nullable clear target", sortTitle: "x", languageCode: "en", physicalCategoryId: category.id, reviewStatus: "active", shortDescription: "Old description." })
      .returning({ id: books.id });
    createdBookIds.push(book.id);

    const result = await updateBookMetadata(db, { bookId: book.id, patch: { description: null } });
    expect(result.ok).toBe(true);

    const [after] = await db.select({ shortDescription: books.shortDescription }).from(books).where(eq(books.id, book.id)).limit(1);
    expect(after.shortDescription).toBeNull();
  });

  // ---------------------------------------------------------------------
  // Correction pass §10 — audit truthfulness
  // ---------------------------------------------------------------------

  it("a description-only category edit is logged as category_guidance_updated, never falsely as category_renamed", async () => {
    const created = await createCategory(db, { label: "Audit Truthfulness Category" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    createdCategoryIds.push(created.id);

    const result = await updateCategory(db, { categoryId: created.id, description: "New guidance text only." });
    expect(result.ok).toBe(true);

    const auditRows = await db.select().from(auditLog).where(eq(auditLog.entityId, created.id));
    const relevant = auditRows.filter((r) => r.action.startsWith("category_") && r.action !== "category_created");
    expect(relevant).toHaveLength(1);
    expect(relevant[0].action).toBe("category_guidance_updated");
    expect(relevant[0].action).not.toBe("category_renamed");
  });

  it("a real label rename is still logged as category_renamed", async () => {
    const created = await createCategory(db, { label: "Audit Rename Category" });
    if (!created.ok) return;
    createdCategoryIds.push(created.id);

    const result = await updateCategory(db, { categoryId: created.id, label: "Audit Renamed Category" });
    expect(result.ok).toBe(true);

    const auditRows = await db.select().from(auditLog).where(eq(auditLog.entityId, created.id));
    const relevant = auditRows.filter((r) => r.action.startsWith("category_") && r.action !== "category_created");
    expect(relevant.some((r) => r.action === "category_renamed")).toBe(true);
  });

  it("changing both label and description at once is logged as the bounded category_updated event, listing both changed fields", async () => {
    const created = await createCategory(db, { label: "Audit Bounded Category" });
    if (!created.ok) return;
    createdCategoryIds.push(created.id);

    const result = await updateCategory(db, { categoryId: created.id, label: "Audit Bounded Category Renamed", description: "New guidance too." });
    expect(result.ok).toBe(true);

    const auditRows = await db.select().from(auditLog).where(eq(auditLog.entityId, created.id));
    const relevant = auditRows.filter((r) => r.action.startsWith("category_") && r.action !== "category_created");
    expect(relevant[0].action).toBe("category_updated");
    expect((relevant[0].detail as { changedFields: string[] }).changedFields.sort()).toEqual(["description", "label"]);
  });

  // ---------------------------------------------------------------------
  // Final closure pass §2 — runtime id/state validation reaches a calm
  // outcome, never a raw Postgres "invalid input syntax for type uuid" or an
  // unhandled enum-comparison failure.
  // ---------------------------------------------------------------------

  it("every id-taking function returns a calm not-found/invalid_input result for a malformed id, never a raw Postgres uuid syntax error", async () => {
    const malformed = "not-a-real-uuid";

    await expect(updateBookMetadata(db, { bookId: malformed, patch: {} })).resolves.toMatchObject({ ok: false, error: "not_found" });
    await expect(archiveBook(db, malformed)).resolves.toMatchObject({ ok: false });
    await expect(approveReviewLater(db, { ingestionItemId: malformed, edits: {}, categorySlug: "stories-imagination" })).resolves.toMatchObject({ ok: false, error: "not_found" });
    await expect(resolveDuplicate(db, { ingestionItemId: malformed, action: "same_edition", existingBookId: malformed })).resolves.toMatchObject({ ok: false, error: "not_found" });
    await expect(resolveReviewFlag(db, malformed, "resolved")).resolves.toMatchObject({ ok: false });
    await expect(updateCategory(db, { categoryId: malformed, label: "x" })).resolves.toMatchObject({ ok: false, error: "not_found" });
    await expect(setCategoryActive(db, malformed, false)).resolves.toMatchObject({ ok: false, error: "not_found" });
    await expect(approveTaxonomySuggestion(db, malformed, "Confirmed")).resolves.toMatchObject({ ok: false, error: "not_found" });
    await expect(rejectTaxonomySuggestion(db, malformed)).resolves.toMatchObject({ ok: false, error: "not_found" });
    await expect(mergeTaxonomySuggestionIntoCategory(db, malformed, malformed)).resolves.toMatchObject({ ok: false, error: "not_found" });
  });

  it("resolveDuplicate rejects a malformed/unrecognized duplicate action before touching the database", async () => {
    const [category] = await db.select().from(physicalCategories).limit(1);
    const [existingBook] = await db
      .insert(books)
      .values({ title: "Malformed Action Target", normalizedTitle: "malformed action target", sortTitle: "x", languageCode: "en", physicalCategoryId: category.id, reviewStatus: "active" })
      .returning({ id: books.id });
    createdBookIds.push(existingBook.id);

    const ingestionItemId = await makeIngestionItem();
    await markNeedsReview(ingestionItemId, baseDraft({ duplicateOutcome: "exact_copy_same_edition", duplicateCandidateBookIds: [existingBook.id] }));

    const result = await resolveDuplicate(db, { ingestionItemId, action: "delete_everything" as never, existingBookId: existingBook.id });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("invalid_input");

    const [itemRow] = await db.select().from(ingestionItems).where(eq(ingestionItems.id, ingestionItemId)).limit(1);
    expect(itemRow.status).toBe("needs_review"); // untouched
  });

  it("updateBookMetadata rejects an unregistered explicitlyVerifiedFields key, writing nothing", async () => {
    const [category] = await db.select().from(physicalCategories).limit(1);
    const [book] = await db
      .insert(books)
      .values({ title: "Malformed Verified Field Target", normalizedTitle: "malformed verified field target", sortTitle: "x", languageCode: "en", physicalCategoryId: category.id, reviewStatus: "active" })
      .returning({ id: books.id });
    createdBookIds.push(book.id);

    const result = await updateBookMetadata(db, { bookId: book.id, patch: {}, explicitlyVerifiedFields: ["not_a_real_field" as never] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("invalid_input");

    const provenanceRows = await db.select().from(bookFieldProvenance).where(eq(bookFieldProvenance.bookId, book.id));
    expect(provenanceRows).toHaveLength(0);
  });

  // ---------------------------------------------------------------------
  // Final closure pass §3 — effective (post-merge) age-range validation
  // ---------------------------------------------------------------------

  it("Review Later approval rejects an effective age min > max even though the admin only touched the minimum, before any book is created", async () => {
    const ingestionItemId = await makeIngestionItem();
    const draft = baseDraft({
      proposedBookValues: { title: "Effective Age Target", subtitle: null, authors: [], illustrators: [], publisher: null, languageCode: "en", additionalLanguageCodes: [], isbn10: null, isbn13: null },
      enrichmentSuggestion: {
        description: null,
        tags: [],
        fictionType: null,
        format: null,
        ageMinMonths: 24,
        ageMaxMonths: 48,
        readAloudMinutes: null,
        visualMediaTypes: [],
        visualRealism: null,
        physicalCategorySlug: "stories-imagination",
        categoryConfidence: "high",
        categoryReason: "test",
      },
    });
    await markNeedsReview(ingestionItemId, draft);

    // Admin edits ONLY the minimum, past the untouched AI-suggested maximum of 48.
    const result = await approveReviewLater(db, { ingestionItemId, edits: { ageMinMonths: 60 }, categorySlug: "stories-imagination" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("invalid_input");
    expect(result.message).toMatch(/age from cannot be greater/i);

    const [itemRow] = await db.select().from(ingestionItems).where(eq(ingestionItems.id, ingestionItemId)).limit(1);
    expect(itemRow.status).toBe("needs_review"); // no book created, item untouched
  });

  // ---------------------------------------------------------------------
  // Final closure pass §4 — an inactive category can never be a NEW assignment
  // ---------------------------------------------------------------------

  it("approveReviewLater refuses to assign a newly-deactivated category", async () => {
    const created = await createCategory(db, { label: "Deactivated For Approval Test" });
    if (!created.ok) return;
    createdCategoryIds.push(created.id);
    await setCategoryActive(db, created.id, false);

    const ingestionItemId = await makeIngestionItem();
    const draft = baseDraft({ proposedBookValues: { title: "Inactive Category Approval Target", subtitle: null, authors: [], illustrators: [], publisher: null, languageCode: "en", additionalLanguageCodes: [], isbn10: null, isbn13: null } });
    await markNeedsReview(ingestionItemId, draft);

    const result = await approveReviewLater(db, { ingestionItemId, edits: {}, categorySlug: created.slug });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/no longer active/i);

    const [itemRow] = await db.select().from(ingestionItems).where(eq(ingestionItems.id, ingestionItemId)).limit(1);
    expect(itemRow.status).toBe("needs_review");
  });

  it("updateBookMetadata refuses to newly assign a deactivated category to an active book, but leaves its current (grandfathered) category display untouched by this check", async () => {
    const created = await createCategory(db, { label: "Deactivated For Metadata Edit Test" });
    if (!created.ok) return;
    createdCategoryIds.push(created.id);
    await setCategoryActive(db, created.id, false);

    const [otherCategory] = await db.select().from(physicalCategories).where(eq(physicalCategories.isActive, true)).limit(1);
    const [book] = await db
      .insert(books)
      .values({ title: "Inactive Category Edit Target", normalizedTitle: "inactive category edit target", sortTitle: "x", languageCode: "en", physicalCategoryId: otherCategory.id, reviewStatus: "active" })
      .returning({ id: books.id });
    createdBookIds.push(book.id);

    const result = await updateBookMetadata(db, { bookId: book.id, patch: { physicalCategorySlug: created.slug } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("invalid_category");
    expect(result.message).toMatch(/no longer active/i);

    const [after] = await db.select({ physicalCategoryId: books.physicalCategoryId }).from(books).where(eq(books.id, book.id)).limit(1);
    expect(after.physicalCategoryId).toBe(otherCategory.id); // unchanged
  });

  // ---------------------------------------------------------------------
  // Final closure pass §5/§6 — Review Detail loads current provenance and the
  // persisted draft's saved provider candidates, never re-running a provider.
  // ---------------------------------------------------------------------

  it("loadAdminReviewDetail exposes current provenance for an active book, including a low-confidence field, and never a superseded row", async () => {
    const [category] = await db.select().from(physicalCategories).limit(1);
    const [book] = await db
      .insert(books)
      .values({ title: "Provenance Detail Target", normalizedTitle: "provenance detail target", sortTitle: "x", languageCode: "en", physicalCategoryId: category.id, reviewStatus: "active" })
      .returning({ id: books.id });
    createdBookIds.push(book.id);

    await db.insert(bookFieldProvenance).values([
      { bookId: book.id, fieldKey: "physical_category", sourceType: "ai_inferred", confidenceLevel: "low", isCurrent: true },
      { bookId: book.id, fieldKey: "title", sourceType: "external_provider", sourceLabel: "Open Library", confidenceLevel: "high", isCurrent: true },
      { bookId: book.id, fieldKey: "title", sourceType: "ai_inferred", confidenceLevel: "medium", isCurrent: false }, // superseded, must not appear
    ]);

    const detail = await loadAdminReviewDetail(db, `book:${book.id}`);
    expect(detail).toBeDefined();
    if (!detail) return;

    expect(detail.provenance).toHaveLength(2);
    const category_ = detail.provenance.find((p) => p.fieldKey === "physical_category");
    expect(category_?.confidenceLevel).toBe("low");
    const title_ = detail.provenance.find((p) => p.fieldKey === "title");
    expect(title_?.sourceType).toBe("external_provider");
    expect(title_?.sourceLabel).toBe("Open Library");
  });

  it("loadAdminReviewDetail exposes the persisted draft's saved metadata candidates for a Review Later item, without any provider call", async () => {
    const ingestionItemId = await makeIngestionItem();
    const draft = baseDraft({
      metadataCandidates: [
        { provider: "open_library", providerIdentifier: "OL123M", title: "Candidate Title", authors: ["Candidate Author"], publisher: "Candidate Publisher", language: "en", isbn13: "9780000000002", matchScore: 0.9, matchedSignals: ["title"] },
      ],
      selectedCandidateProviderIdentifier: "OL123M",
      reconciliationOutcome: "high_confidence",
    });
    await markNeedsReview(ingestionItemId, draft);

    const detail = await loadAdminReviewDetail(db, `ingestion:${ingestionItemId}`);
    expect(detail).toBeDefined();
    if (!detail) return;

    expect(detail.draft?.metadataCandidates).toHaveLength(1);
    expect(detail.draft?.metadataCandidates[0].title).toBe("Candidate Title");
    expect(detail.draft?.selectedCandidateProviderIdentifier).toBe("OL123M");
    expect(detail.draft?.reconciliationOutcome).toBe("high_confidence");
  });

  // ---------------------------------------------------------------------
  // Final closure pass §7 — duplicate comparison evidence (edition, ISBN, cover)
  // ---------------------------------------------------------------------

  it("loadAdminReviewDetail's duplicate candidates include edition, ISBN, and the display cover when the existing book has them", async () => {
    const [category] = await db.select().from(physicalCategories).limit(1);
    const [existingBook] = await db
      .insert(books)
      .values({
        title: "Duplicate Evidence Target",
        normalizedTitle: "duplicate evidence target",
        sortTitle: "x",
        languageCode: "en",
        physicalCategoryId: category.id,
        reviewStatus: "active",
        edition: "2nd Edition",
        isbn10: "0000000001",
        isbn13: "9780000000001",
        displayCoverUrl: "https://covers.openlibrary.org/b/id/1-M.jpg",
      })
      .returning({ id: books.id });
    createdBookIds.push(existingBook.id);

    const ingestionItemId = await makeIngestionItem();
    await markNeedsReview(ingestionItemId, baseDraft({ duplicateOutcome: "exact_copy_same_edition", duplicateCandidateBookIds: [existingBook.id] }));

    const detail = await loadAdminReviewDetail(db, `ingestion:${ingestionItemId}`);
    expect(detail).toBeDefined();
    if (!detail) return;

    expect(detail.duplicateCandidates).toHaveLength(1);
    const candidate = detail.duplicateCandidates[0];
    expect(candidate.edition).toBe("2nd Edition");
    expect(candidate.isbn10).toBe("0000000001");
    expect(candidate.isbn13).toBe("9780000000001");
    expect(candidate.cover.displayUrl).toBe("https://covers.openlibrary.org/b/id/1-M.jpg");
  });

  // ---------------------------------------------------------------------
  // Final closure pass §8 — truthful human-verification audit semantics
  // ---------------------------------------------------------------------

  it("the real Keep-current-category flow (empty patch, explicitlyVerifiedFields only) audits as metadata_verified, never metadata_corrected", async () => {
    const [category] = await db.select().from(physicalCategories).limit(1);
    const [book] = await db
      .insert(books)
      .values({ title: "Verify Only Audit Target", normalizedTitle: "verify only audit target", sortTitle: "x", languageCode: "en", physicalCategoryId: category.id, reviewStatus: "active" })
      .returning({ id: books.id });
    createdBookIds.push(book.id);

    const result = await updateBookMetadata(db, { bookId: book.id, patch: {}, explicitlyVerifiedFields: ["physical_category"] });
    expect(result.ok).toBe(true);

    const auditRows = await db.select().from(auditLog).where(eq(auditLog.entityId, book.id));
    const relevant = auditRows.filter((r) => r.action.startsWith("metadata_"));
    expect(relevant).toHaveLength(1);
    expect(relevant[0].action).toBe("metadata_verified");
    expect((relevant[0].detail as { verifiedFields: string[] }).verifiedFields).toEqual(["physical_category"]);
  });

  it("a correction-only save still audits as metadata_corrected, and a save mixing a correction with a verification audits as the bounded metadata_updated", async () => {
    const [category] = await db.select().from(physicalCategories).limit(1);
    const [book] = await db
      .insert(books)
      .values({ title: "Mixed Audit Target", normalizedTitle: "mixed audit target", sortTitle: "x", languageCode: "en", physicalCategoryId: category.id, reviewStatus: "active" })
      .returning({ id: books.id });
    createdBookIds.push(book.id);

    const correctionOnly = await updateBookMetadata(db, { bookId: book.id, patch: { description: "corrected" } });
    expect(correctionOnly.ok).toBe(true);
    let auditRows = await db.select().from(auditLog).where(eq(auditLog.entityId, book.id));
    expect(auditRows.filter((r) => r.action.startsWith("metadata_"))[0].action).toBe("metadata_corrected");

    const mixed = await updateBookMetadata(db, { bookId: book.id, patch: { description: "corrected again" }, explicitlyVerifiedFields: ["physical_category"] });
    expect(mixed.ok).toBe(true);
    auditRows = await db.select().from(auditLog).where(eq(auditLog.entityId, book.id));
    const mixedEntry = auditRows.filter((r) => r.action.startsWith("metadata_"))[1];
    expect(mixedEntry.action).toBe("metadata_updated");
    const detail = mixedEntry.detail as { correctedFields: string[]; verifiedFields: string[] };
    expect(detail.correctedFields).toEqual(["description"]);
    expect(detail.verifiedFields).toEqual(["physical_category"]);
  });

  // ---------------------------------------------------------------------
  // Final closure pass §9 — an actual correction resolves the flag it addresses
  // ---------------------------------------------------------------------

  it("correcting physicalCategorySlug resolves an open category_uncertain flag, but an unrelated visual_style_uncertain flag survives", async () => {
    const [category] = await db.select().from(physicalCategories).where(eq(physicalCategories.isActive, true)).limit(1);
    const [otherCategory] = await db.select().from(physicalCategories).where(eq(physicalCategories.isActive, true)).limit(1).offset(1);
    const targetCategory = otherCategory ?? category;
    const [book] = await db
      .insert(books)
      .values({ title: "Correction Resolves Flag Target", normalizedTitle: "correction resolves flag target", sortTitle: "x", languageCode: "en", physicalCategoryId: category.id, reviewStatus: "active" })
      .returning({ id: books.id });
    createdBookIds.push(book.id);

    await db.insert(reviewFlags).values([
      { bookId: book.id, flagType: "category_uncertain" },
      { bookId: book.id, flagType: "visual_style_uncertain" },
    ]);

    const result = await updateBookMetadata(db, { bookId: book.id, patch: { physicalCategorySlug: targetCategory.slug } });
    expect(result.ok).toBe(true);

    const flags = await db.select().from(reviewFlags).where(eq(reviewFlags.bookId, book.id));
    const categoryFlag = flags.find((f) => f.flagType === "category_uncertain");
    const visualFlag = flags.find((f) => f.flagType === "visual_style_uncertain");
    expect(categoryFlag?.status).toBe("resolved");
    expect(visualFlag?.status).toBe("open"); // unrelated concern, untouched
  });
});
