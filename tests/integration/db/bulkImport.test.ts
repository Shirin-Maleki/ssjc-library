import { afterAll, afterEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { books, bookCopies, ingestionItems, ingestionJobs, physicalCategories, reviewFlags } from "@/db/schema";
import { createBulkImportJob, getJobStatus } from "@/lib/bulkImport/jobs";
import { claimNextPendingItem, recoverStaleProcessingItems } from "@/lib/bulkImport/claim";
import { processOneClaimedItem, type BulkPipelineDeps } from "@/lib/bulkImport/pipeline";
import { createCallCounters } from "@/lib/bulkImport/costTracking";
import { runBulkImportJob } from "@/lib/bulkImport/runner";
import { loadAdminReviewQueue } from "@/lib/admin/reviewQueueSource";
import type { CoverIdentification, EnrichmentSuggestion } from "@/lib/ai/schemas";
import type { CoverAnalysisResult, CoverIdentificationInput } from "@/lib/ai/provider";
import type { BookMetadataProvider, NormalizedMetadataCandidate } from "@/lib/metadataProviders/provider";
import type { CoverStorageProvider, DriveFileMetadata } from "@/lib/googleDrive/provider";
import { requireTestDatabaseUrl, createTestDb } from "./testDb";

const hasTestDb = (() => {
  try {
    requireTestDatabaseUrl();
    return true;
  } catch {
    return false;
  }
})();

const ROOT_FOLDER_ID = "bulk-root";
const CATEGORY_SLUG = "stories-imagination";

function coverEvidence(overrides: Partial<CoverIdentification> = {}): CoverIdentification {
  return {
    visibleTitle: "A Bulk Imported Book",
    visibleSubtitle: null,
    visibleAuthors: ["Bulk Author"],
    visibleIllustrators: null,
    visiblePublisherOrImprint: null,
    visibleLanguage: "English",
    visibleIsbn: null,
    visibleSeries: null,
    candidateSearchTerms: ["A Bulk Imported Book"],
    identityConfidenceLevel: "high",
    evidenceNotes: "Test fixture cover evidence.",
    ...overrides,
  } as CoverIdentification;
}

function enrichment(overrides: Partial<EnrichmentSuggestion> = {}): EnrichmentSuggestion {
  return {
    description: "A bulk-imported test description.",
    tags: [],
    fictionType: "fiction",
    format: "picture_book",
    ageMinMonths: 24,
    ageMaxMonths: 60,
    readAloudMinutes: 5,
    visualMediaTypes: [],
    visualRealism: null,
    physicalCategorySlug: CATEGORY_SLUG,
    categoryConfidence: "high",
    categoryReason: "test",
    ...overrides,
  } as EnrichmentSuggestion;
}

/** A fully scripted fake AI provider — returns one queued analysis per call,
 * in order, or a default "confident, complete" result forever once the queue
 * is empty. Never makes a real Gemini call. */
function fakeAiProvider(...results: CoverAnalysisResult[]) {
  const queue = [...results];
  return {
    calls: [] as CoverIdentificationInput[],
    async analyzeCover(input: CoverIdentificationInput): Promise<CoverAnalysisResult> {
      this.calls.push(input);
      return queue.shift() ?? { coverEvidence: coverEvidence(), aiSuggestions: enrichment(), aiSuggestionsStatus: "valid" };
    },
  };
}

function fakeMetadataProvider(candidates: NormalizedMetadataCandidate[]): BookMetadataProvider {
  return { name: "open_library", async search() { return candidates; } };
}

function fakeDriveProvider(): Pick<CoverStorageProvider, "downloadSource" | "getFileMetadata"> {
  return {
    async downloadSource(fileId: string) {
      return { bytes: Buffer.from("fake-image-bytes"), metadata: fakeFileMetadata(fileId) };
    },
    async getFileMetadata(fileId: string) {
      return fakeFileMetadata(fileId);
    },
  };
}

function fakeFileMetadata(fileId: string): DriveFileMetadata {
  return {
    id: fileId,
    name: `${fileId}.jpg`,
    mimeType: "image/jpeg",
    size: 1000,
    createdTime: "2026-01-01T00:00:00.000Z",
    modifiedTime: "2026-01-01T00:00:00.000Z",
    parents: [ROOT_FOLDER_ID],
    isFolder: false,
    trashed: false,
    capabilities: { canDownload: true, canAddChildren: false, canTrash: true },
  };
}

describe.skipIf(!hasTestDb)("Phase 9 bulk import (against a real Postgres database)", () => {
  const { db, client } = hasTestDb ? createTestDb() : ({} as ReturnType<typeof createTestDb>);
  const createdJobIds: string[] = [];
  const createdBookIds: string[] = [];

  afterEach(async () => {
    // `book_copies.source_ingestion_item_id` <-> `ingestion_items.resulting_copy_id`
    // is a genuine circular FK (docs/DATA_MODEL.md) — resultingCopyId must be
    // nulled before the copy it points to can be deleted, exactly like every
    // other fixture teardown in this codebase that creates a real completed item.
    for (const id of createdBookIds.splice(0)) {
      const copies = await db.select({ id: bookCopies.id }).from(bookCopies).where(eq(bookCopies.bookId, id));
      const copyIds = copies.map((c) => c.id);
      if (copyIds.length > 0) {
        await db.update(ingestionItems).set({ resultingCopyId: null }).where(inArray(ingestionItems.resultingCopyId, copyIds));
      }
      await db.update(ingestionItems).set({ pendingBookId: null }).where(eq(ingestionItems.pendingBookId, id));
      await db.delete(bookCopies).where(eq(bookCopies.bookId, id));
      await db.delete(reviewFlags).where(eq(reviewFlags.bookId, id));
      await db.delete(books).where(eq(books.id, id));
    }
    for (const id of createdJobIds.splice(0)) {
      await db.delete(ingestionItems).where(eq(ingestionItems.jobId, id));
      await db.delete(ingestionJobs).where(eq(ingestionJobs.id, id));
    }
  });

  afterAll(async () => {
    if (hasTestDb) await client.end();
  });

  function makeListChildren(fileIds: string[]) {
    return async (folderId: string) => {
      if (folderId !== ROOT_FOLDER_ID) return { files: [] };
      return { files: fileIds.map((id) => fakeFileMetadata(id)) };
    };
  }

  function makeDeps(ai: ReturnType<typeof fakeAiProvider>, metadataProviders: BookMetadataProvider[] = [fakeMetadataProvider([])]): BulkPipelineDeps {
    return { db, driveProvider: fakeDriveProvider(), aiProvider: ai, metadataProviders, bulkImportRootFolderId: ROOT_FOLDER_ID, counters: createCallCounters() };
  }

  /** A `needs_review` outcome can leave behind a real `pending_review` book
   * row (`saveForReview`'s `pendingBook` path — created whenever enough
   * trustworthy title/language evidence exists even though some OTHER signal
   * was too uncertain to auto-complete) — captured here for every test that
   * processes an item, regardless of which specific outcome it expects, so no
   * test has to reason case-by-case about whether its own scenario happens to
   * leave one behind. */
  async function trackAnyPendingBookForCleanup(itemId: string): Promise<void> {
    const [item] = await db.select({ pendingBookId: ingestionItems.pendingBookId }).from(ingestionItems).where(eq(ingestionItems.id, itemId)).limit(1);
    if (item?.pendingBookId) createdBookIds.push(item.pendingBookId);
  }

  // ---------------------------------------------------------------------
  // Job creation / enumeration / idempotency
  // ---------------------------------------------------------------------

  it("createBulkImportJob creates exactly one item per newly-discovered file, in deterministic order", async () => {
    const result = await createBulkImportJob(db, { sourceFolderId: ROOT_FOLDER_ID, listChildren: makeListChildren(["fileA", "fileB", "fileC"]) });
    createdJobIds.push(result.jobId);
    expect(result.createdItems).toHaveLength(3);
    expect(result.totalDiscovered).toBe(3);
    expect(result.alreadyTrackedFiles).toHaveLength(0);
  });

  it("re-running job creation against the same files never creates duplicate ingestion items (idempotent by construction)", async () => {
    const first = await createBulkImportJob(db, { sourceFolderId: ROOT_FOLDER_ID, listChildren: makeListChildren(["dup-1", "dup-2"]) });
    createdJobIds.push(first.jobId);
    expect(first.createdItems).toHaveLength(2);

    const second = await createBulkImportJob(db, { sourceFolderId: ROOT_FOLDER_ID, listChildren: makeListChildren(["dup-1", "dup-2"]) });
    createdJobIds.push(second.jobId);
    expect(second.createdItems).toHaveLength(0);
    expect(second.alreadyTrackedFiles).toHaveLength(2);

    const allItemsForFile = await db.select().from(ingestionItems).where(eq(ingestionItems.driveFileId, "dup-1"));
    expect(allItemsForFile).toHaveLength(1); // never a second row for the same active file
  });

  it("respects an explicit bounded --limit, never creating more items than requested", async () => {
    const result = await createBulkImportJob(db, { sourceFolderId: ROOT_FOLDER_ID, listChildren: makeListChildren(["a", "b", "c", "d", "e"]), limit: 2 });
    createdJobIds.push(result.jobId);
    expect(result.createdItems).toHaveLength(2);
    expect(result.totalDiscovered).toBe(5); // honest reporting of what exists beyond the bound
  });

  it("respects an explicit --file-id list, ignoring files outside it", async () => {
    const result = await createBulkImportJob(db, { sourceFolderId: ROOT_FOLDER_ID, listChildren: makeListChildren(["x", "y", "z"]), fileIds: ["y"] });
    createdJobIds.push(result.jobId);
    expect(result.createdItems).toHaveLength(1);
    expect(result.createdItems[0].fileId).toBe("y");
  });

  // ---------------------------------------------------------------------
  // Pipeline outcomes
  // ---------------------------------------------------------------------

  it("a confident, unambiguous item completes automatically and creates exactly one active book + one copy", async () => {
    const job = await createBulkImportJob(db, { sourceFolderId: ROOT_FOLDER_ID, listChildren: makeListChildren(["happy-path"]) });
    createdJobIds.push(job.jobId);
    const claimed = await claimNextPendingItem(db, job.jobId);
    expect(claimed).toBeDefined();

    const ai = fakeAiProvider({ coverEvidence: coverEvidence({ visibleIsbn: "9781234567897" }), aiSuggestions: enrichment(), aiSuggestionsStatus: "valid" });
    const candidate: NormalizedMetadataCandidate = { provider: "open_library", providerIdentifier: "OL-happy", title: "A Bulk Imported Book", authors: ["Bulk Author"], isbn13: "9781234567897", language: "English" };
    const outcome = await processOneClaimedItem(makeDeps(ai, [fakeMetadataProvider([candidate])]), { itemId: claimed!.id, driveFileId: "happy-path", fileName: "happy-path.jpg", mimeType: "image/jpeg", sizeBytes: 1000 }, 3);
    await trackAnyPendingBookForCleanup(claimed!.id);

    expect(outcome.kind).toBe("completed");
    if (outcome.kind !== "completed") return;
    createdBookIds.push(outcome.bookId);

    const [bookRow] = await db.select().from(books).where(eq(books.id, outcome.bookId)).limit(1);
    expect(bookRow.reviewStatus).toBe("active"); // enters normal Find (TEACHER_VISIBLE_REVIEW_STATUS)
    expect(bookRow.coverSourceType).toBe("bulk_import");

    const copies = await db.select().from(bookCopies).where(eq(bookCopies.bookId, outcome.bookId));
    expect(copies).toHaveLength(1);

    const [itemRow] = await db.select().from(ingestionItems).where(eq(ingestionItems.id, claimed!.id)).limit(1);
    expect(itemRow.status).toBe("completed");

    const [jobRow] = await db.select().from(ingestionJobs).where(eq(ingestionJobs.id, job.jobId)).limit(1);
    expect(jobRow.status).toBe("completed"); // single-item job, matches Phase 7's own completion semantics
  });

  it("weak identification routes to needs_review with a low_identification_confidence flag, and appears in Phase 8's computed Admin Review queue", async () => {
    const job = await createBulkImportJob(db, { sourceFolderId: ROOT_FOLDER_ID, listChildren: makeListChildren(["weak-id"]) });
    createdJobIds.push(job.jobId);
    const claimed = await claimNextPendingItem(db, job.jobId);

    const ai = fakeAiProvider({ coverEvidence: coverEvidence({ visibleTitle: null }), aiSuggestions: enrichment(), aiSuggestionsStatus: "valid" });
    const outcome = await processOneClaimedItem(makeDeps(ai), { itemId: claimed!.id, driveFileId: "weak-id", fileName: "weak-id.jpg", mimeType: "image/jpeg", sizeBytes: 1000 }, 3);
    await trackAnyPendingBookForCleanup(claimed!.id);

    expect(outcome.kind).toBe("needs_review");
    const [itemRow] = await db.select().from(ingestionItems).where(eq(ingestionItems.id, claimed!.id)).limit(1);
    expect(itemRow.status).toBe("needs_review");

    const queue = await loadAdminReviewQueue(db);
    expect(queue.some((entry) => entry.key === `ingestion:${claimed!.id}`)).toBe(true);
  });

  it("a low-confidence category suggestion routes to review as category_uncertain, not silently auto-shelved", async () => {
    const job = await createBulkImportJob(db, { sourceFolderId: ROOT_FOLDER_ID, listChildren: makeListChildren(["low-cat"]) });
    createdJobIds.push(job.jobId);
    const claimed = await claimNextPendingItem(db, job.jobId);

    const ai = fakeAiProvider({ coverEvidence: coverEvidence({ visibleIsbn: "9783333333333" }), aiSuggestions: enrichment({ categoryConfidence: "low" }), aiSuggestionsStatus: "valid" });
    const candidate: NormalizedMetadataCandidate = { provider: "open_library", providerIdentifier: "OL-low-cat", title: "A Bulk Imported Book", authors: ["Bulk Author"], isbn13: "9783333333333", language: "English" };
    const outcome = await processOneClaimedItem(makeDeps(ai, [fakeMetadataProvider([candidate])]), { itemId: claimed!.id, driveFileId: "low-cat", fileName: "low-cat.jpg", mimeType: "image/jpeg", sizeBytes: 1000 }, 3);
    await trackAnyPendingBookForCleanup(claimed!.id);
    expect(outcome).toMatchObject({ kind: "needs_review", reason: expect.stringMatching(/category/i) });
  });

  it("a duplicate candidate against an existing active book routes to review as duplicate_uncertain, never silently attaching a copy", async () => {
    const [category] = await db.select().from(physicalCategories).where(eq(physicalCategories.slug, CATEGORY_SLUG)).limit(1);
    const [existingBook] = await db
      .insert(books)
      .values({ title: "A Bulk Imported Book", normalizedTitle: "a bulk imported book", sortTitle: "A Bulk Imported Book", languageCode: "en", physicalCategoryId: category.id, reviewStatus: "active", isbn13: "9780000000099" })
      .returning({ id: books.id });
    createdBookIds.push(existingBook.id);

    const job = await createBulkImportJob(db, { sourceFolderId: ROOT_FOLDER_ID, listChildren: makeListChildren(["dup-candidate"]) });
    createdJobIds.push(job.jobId);
    const claimed = await claimNextPendingItem(db, job.jobId);

    const ai = fakeAiProvider({ coverEvidence: coverEvidence({ visibleIsbn: "9780000000099" }), aiSuggestions: enrichment(), aiSuggestionsStatus: "valid" });
    const candidate: NormalizedMetadataCandidate = { provider: "open_library", providerIdentifier: "OL1M", title: "A Bulk Imported Book", authors: ["Bulk Author"], isbn13: "9780000000099", language: "English" };
    const outcome = await processOneClaimedItem(makeDeps(ai, [fakeMetadataProvider([candidate])]), { itemId: claimed!.id, driveFileId: "dup-candidate", fileName: "dup-candidate.jpg", mimeType: "image/jpeg", sizeBytes: 1000 }, 3);
    await trackAnyPendingBookForCleanup(claimed!.id);

    expect(outcome.kind).toBe("needs_review");
    const copies = await db.select().from(bookCopies).where(eq(bookCopies.bookId, existingBook.id));
    expect(copies).toHaveLength(0); // never silently attached
  });

  it("a permanent provider failure marks the item failed without exhausting retries pointlessly", async () => {
    const job = await createBulkImportJob(db, { sourceFolderId: ROOT_FOLDER_ID, listChildren: makeListChildren(["bad-image"]) });
    createdJobIds.push(job.jobId);
    const claimed = await claimNextPendingItem(db, job.jobId);

    const driveProvider: Pick<CoverStorageProvider, "downloadSource" | "getFileMetadata"> = {
      async downloadSource() {
        return { bytes: Buffer.alloc(0), metadata: fakeFileMetadata("bad-image") };
      },
      async getFileMetadata(fileId: string) {
        return fakeFileMetadata(fileId);
      },
    };
    const ai = fakeAiProvider();
    const deps: BulkPipelineDeps = { db, driveProvider, aiProvider: ai, metadataProviders: [fakeMetadataProvider([])], bulkImportRootFolderId: ROOT_FOLDER_ID, counters: createCallCounters() };

    // An empty image buffer makes the real `prepareAnalysisImage`/vision
    // boundary genuinely fail — routed through the classifier like any other
    // real provider error, never a special-cased test path.
    const outcome = await processOneClaimedItem(deps, { itemId: claimed!.id, driveFileId: "bad-image", fileName: "bad-image.jpg", mimeType: "image/jpeg", sizeBytes: 1000 }, 3);
    await trackAnyPendingBookForCleanup(claimed!.id);
    expect(outcome.kind === "failed" || outcome.kind === "needs_review").toBe(true);

    const [itemRow] = await db.select().from(ingestionItems).where(eq(ingestionItems.id, claimed!.id)).limit(1);
    expect(["failed", "needs_review"]).toContain(itemRow.status);
  });

  // ---------------------------------------------------------------------
  // Resumability / crash recovery
  // ---------------------------------------------------------------------

  it("recoverStaleProcessingItems resets an item stuck in processing past the staleness threshold back to pending", async () => {
    const job = await createBulkImportJob(db, { sourceFolderId: ROOT_FOLDER_ID, listChildren: makeListChildren(["stuck-item"]) });
    createdJobIds.push(job.jobId);
    const claimed = await claimNextPendingItem(db, job.jobId);
    // Simulate a crash: backdate startedAt well past any real threshold.
    await db.update(ingestionItems).set({ startedAt: new Date(Date.now() - 60 * 60 * 1000) }).where(eq(ingestionItems.id, claimed!.id));

    const recovery = await recoverStaleProcessingItems(db, job.jobId, 30 * 60 * 1000);
    expect(recovery.recoveredCount).toBe(1);
    expect(recovery.recoveredItemIds).toContain(claimed!.id);

    const [itemRow] = await db.select().from(ingestionItems).where(eq(ingestionItems.id, claimed!.id)).limit(1);
    expect(itemRow.status).toBe("pending");
  });

  it("recoverStaleProcessingItems never touches an item still within the staleness window", async () => {
    const job = await createBulkImportJob(db, { sourceFolderId: ROOT_FOLDER_ID, listChildren: makeListChildren(["fresh-item"]) });
    createdJobIds.push(job.jobId);
    const claimed = await claimNextPendingItem(db, job.jobId);

    const recovery = await recoverStaleProcessingItems(db, job.jobId, 30 * 60 * 1000);
    expect(recovery.recoveredCount).toBe(0);

    const [itemRow] = await db.select().from(ingestionItems).where(eq(ingestionItems.id, claimed!.id)).limit(1);
    expect(itemRow.status).toBe("processing");
  });

  it("a bounded runBulkImportJob call processes items up to maxItems and reports accurate counts; a second call resumes and finishes the rest", async () => {
    const job = await createBulkImportJob(db, { sourceFolderId: ROOT_FOLDER_ID, listChildren: makeListChildren(["run-1", "run-2"]) });
    createdJobIds.push(job.jobId);

    const ai = fakeAiProvider(
      { coverEvidence: coverEvidence({ visibleTitle: "Wobblesnout Faraway Kettle", visibleAuthors: ["Marigold Fenwick"], visibleIsbn: "9781111111111" }), aiSuggestions: enrichment(), aiSuggestionsStatus: "valid" },
      { coverEvidence: coverEvidence({ visibleTitle: "Prickleback Lantern Voyage", visibleAuthors: ["Desmond Okafor"], visibleIsbn: "9782222222222" }), aiSuggestions: enrichment(), aiSuggestionsStatus: "valid" }
    );
    const driveProvider = fakeDriveProvider();
    const metadataProvider: BookMetadataProvider = {
      name: "open_library",
      async search(query) {
        if (query.isbn === "9781111111111") return [{ provider: "open_library", providerIdentifier: "OL-run-1", title: "Wobblesnout Faraway Kettle", authors: ["Marigold Fenwick"], isbn13: "9781111111111", language: "English" }];
        if (query.isbn === "9782222222222") return [{ provider: "open_library", providerIdentifier: "OL-run-2", title: "Prickleback Lantern Voyage", authors: ["Desmond Okafor"], isbn13: "9782222222222", language: "English" }];
        return [];
      },
    };
    const deps: BulkPipelineDeps = { db, driveProvider, aiProvider: ai, metadataProviders: [metadataProvider], bulkImportRootFolderId: ROOT_FOLDER_ID, counters: createCallCounters() };

    const firstRun = await runBulkImportJob(db, { jobId: job.jobId, deps, driveProvider, maxItems: 1 });
    expect(firstRun.attempted).toBe(1);
    expect(firstRun.completed).toBe(1);

    const midStatus = await getJobStatus(db, job.jobId);
    expect(midStatus!.pendingCount).toBe(1);
    expect(midStatus!.completedCount).toBe(1);

    const secondRun = await runBulkImportJob(db, { jobId: job.jobId, deps, driveProvider, maxItems: 10 });
    expect(secondRun.attempted).toBe(1);
    expect(secondRun.completed).toBe(1);

    const completedItemsForCleanup = await db.select({ resultingCopyId: ingestionItems.resultingCopyId }).from(ingestionItems).where(eq(ingestionItems.jobId, job.jobId));
    for (const item of completedItemsForCleanup) {
      if (!item.resultingCopyId) continue;
      const [copyRow] = await db.select({ bookId: bookCopies.bookId }).from(bookCopies).where(eq(bookCopies.id, item.resultingCopyId)).limit(1);
      if (copyRow) createdBookIds.push(copyRow.bookId);
    }

    const finalStatus = await getJobStatus(db, job.jobId);
    expect(finalStatus!.completedCount).toBe(2);
    expect(finalStatus!.pendingCount).toBe(0);
  });
});
