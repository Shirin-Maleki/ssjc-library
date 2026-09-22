import { afterAll, afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  auditLog,
  bookContributors,
  bookCopies,
  bookDuplicates,
  bookFieldProvenance,
  books,
  contributors,
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
    await markNeedsReview(ingestionItemId, baseDraft({ duplicateOutcome: "exact_copy_same_edition" }));

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
    await markNeedsReview(ingestionItemId, baseDraft({ duplicateOutcome: "exact_copy_same_edition" }), placeholder.id);

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
    await markNeedsReview(ingestionItemId, baseDraft({ duplicateOutcome: "ambiguous_similar_title" }), pendingBook.id);

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
});
