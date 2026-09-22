import { describe, expect, it, afterAll, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { books, bookCopies, ingestionItems, ingestionJobs, auditLog, reviewFlags, bookFieldProvenance } from "@/db/schema";
import { saveNewBook, addAnotherCopy, saveForReview, type NewBookInput } from "@/lib/intake/persistence";
import { createInitialDraft } from "@/lib/intake/draft";
import { DrizzleSearchRepository } from "@/db/repositories/searchRepository";
import { EMPTY_FILTERS } from "@/lib/search/filters";
import { requireTestDatabaseUrl, createTestDb } from "./testDb";

const hasTestDb = (() => {
  try {
    requireTestDatabaseUrl();
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!hasTestDb)("intake/persistence (against a real Postgres database)", () => {
  const { db, client } = hasTestDb ? createTestDb() : ({} as ReturnType<typeof createTestDb>);
  const searchRepository = hasTestDb ? new DrizzleSearchRepository(db) : (undefined as unknown as DrizzleSearchRepository);
  const createdBookIds: string[] = [];
  const createdIngestionItemIds: string[] = [];
  const createdJobIds: string[] = [];

  afterEach(async () => {
    // book_copies.source_ingestion_item_id and ingestion_items.resulting_copy_id
    // are a genuine circular FK with no ON DELETE CASCADE on either side — the
    // ingestion_items -> book_copies reference must be nulled out before books
    // (which cascades to book_copies) or ingestion_jobs (which cascades to
    // ingestion_items) can be deleted.
    // `ingestion_items.pending_book_id` (Phase 8) is a second FK into `books` with
    // no cascade — must also be nulled before a `books` row it points to can be
    // deleted, exactly like `resulting_copy_id` above.
    for (const id of createdIngestionItemIds.splice(0)) {
      await db.update(ingestionItems).set({ resultingCopyId: null, pendingBookId: null }).where(eq(ingestionItems.id, id));
    }
    for (const id of createdBookIds.splice(0)) {
      await db.delete(books).where(eq(books.id, id));
    }
    for (const id of createdJobIds.splice(0)) {
      await db.delete(ingestionJobs).where(eq(ingestionJobs.id, id));
    }
  });

  afterAll(async () => {
    if (hasTestDb) await client.end();
  });

  async function makeIngestionItem(): Promise<string> {
    const [job] = await db
      .insert(ingestionJobs)
      .values({ jobType: "single_add", source: "teacher_capture", status: "running", totalItems: 1 })
      .returning({ id: ingestionJobs.id });
    createdJobIds.push(job.id);
    const [item] = await db
      .insert(ingestionItems)
      .values({ jobId: job.id, driveFileId: `test-drive-file-${crypto.randomUUID()}`, status: "processing" })
      .returning({ id: ingestionItems.id });
    createdIngestionItemIds.push(item.id);
    return item.id;
  }

  function baseInput(overrides: Partial<NewBookInput> = {}, ingestionItemId: string): NewBookInput {
    return {
      title: "Persistence Test Fixture Book",
      authors: ["Test Author"],
      languageCode: "en",
      physicalCategorySlug: "stories-imagination",
      coverDriveFileId: "test-drive-file-id",
      coverDriveFolderId: "test-drive-folder-id",
      coverFilename: "cover.jpg",
      coverMimeType: "image/jpeg",
      provenance: [],
      ingestionItemId,
      actorLabel: "staff",
      ...overrides,
    };
  }

  it("AI-first catalog draft correction §11/§13: a human-corrected description is stored as human_corrected provenance, never ai_inferred", async () => {
    const ingestionItemId = await makeIngestionItem();
    const result = await saveNewBook(
      db,
      baseInput(
        {
          description: "A teacher-written description replacing the AI suggestion.",
          provenance: [{ fieldKey: "description", sourceType: "human_corrected" }],
        },
        ingestionItemId
      )
    );
    createdBookIds.push(result.bookId);

    const [row] = await db.select().from(bookFieldProvenance).where(eq(bookFieldProvenance.bookId, result.bookId));
    expect(row.fieldKey).toBe("description");
    expect(row.sourceType).toBe("human_corrected");
  });

  it("an AI-suggested description a teacher never touched is stored as ai_inferred provenance — it must never mysteriously disappear on save", async () => {
    const ingestionItemId = await makeIngestionItem();
    const result = await saveNewBook(
      db,
      baseInput(
        {
          description: "An AI-generated description the teacher confirmed as-is.",
          provenance: [{ fieldKey: "description", sourceType: "ai_inferred" }],
        },
        ingestionItemId
      )
    );
    createdBookIds.push(result.bookId);

    const [bookRow] = await db.select().from(books).where(eq(books.id, result.bookId)).limit(1);
    expect(bookRow.shortDescription).toBe("An AI-generated description the teacher confirmed as-is.");

    const [row] = await db.select().from(bookFieldProvenance).where(eq(bookFieldProvenance.bookId, result.bookId));
    expect(row.fieldKey).toBe("description");
    expect(row.sourceType).toBe("ai_inferred");
  });

  it("saveNewBook creates a book, its physical copy, and marks the ingestion item completed — all in one transaction", async () => {
    const ingestionItemId = await makeIngestionItem();
    const result = await saveNewBook(db, baseInput({}, ingestionItemId));
    createdBookIds.push(result.bookId);

    const [bookRow] = await db.select().from(books).where(eq(books.id, result.bookId)).limit(1);
    expect(bookRow.title).toBe("Persistence Test Fixture Book");
    expect(bookRow.reviewStatus).toBe("active");

    const [copyRow] = await db.select().from(bookCopies).where(eq(bookCopies.id, result.copyId)).limit(1);
    expect(copyRow.bookId).toBe(result.bookId);

    const [itemRow] = await db.select().from(ingestionItems).where(eq(ingestionItems.id, ingestionItemId)).limit(1);
    expect(itemRow.status).toBe("completed");
    expect(itemRow.resultingCopyId).toBe(result.copyId);

    const auditRows = await db.select().from(auditLog).where(eq(auditLog.entityId, result.bookId));
    expect(auditRows.some((r) => r.action === "book_created")).toBe(true);
  });

  it("rejects a title-less book before ever opening a transaction (minimum-data invariant, §32)", async () => {
    const ingestionItemId = await makeIngestionItem();
    await expect(saveNewBook(db, baseInput({ title: "   " }, ingestionItemId))).rejects.toThrow(/title/i);
  });

  it("rolls back the entire transaction when the physical category slug doesn't exist — never a half-created book", async () => {
    const ingestionItemId = await makeIngestionItem();
    await expect(saveNewBook(db, baseInput({ physicalCategorySlug: "not-a-real-category" }, ingestionItemId))).rejects.toThrow();

    const orphanedBooks = await db.select().from(books).where(eq(books.title, "Persistence Test Fixture Book"));
    expect(orphanedBooks).toEqual([]);
    const [itemRow] = await db.select().from(ingestionItems).where(eq(ingestionItems.id, ingestionItemId)).limit(1);
    expect(itemRow.status).toBe("processing"); // never marked completed by a rolled-back save
  });

  it("addAnotherCopy inserts a copy without mutating the existing book's bibliographic fields", async () => {
    const firstIngestionItemId = await makeIngestionItem();
    const created = await saveNewBook(db, baseInput({}, firstIngestionItemId));
    createdBookIds.push(created.bookId);

    const secondIngestionItemId = await makeIngestionItem();
    const result = await addAnotherCopy(db, { bookId: created.bookId, ingestionItemId: secondIngestionItemId, actorLabel: "staff" });

    const copies = await db.select().from(bookCopies).where(eq(bookCopies.bookId, created.bookId));
    expect(copies.length).toBe(2);
    expect(copies.some((c) => c.id === result.copyId)).toBe(true);

    const [bookRow] = await db.select().from(books).where(eq(books.id, created.bookId)).limit(1);
    expect(bookRow.title).toBe("Persistence Test Fixture Book"); // untouched

    const [itemRow] = await db.select().from(ingestionItems).where(eq(ingestionItems.id, secondIngestionItemId)).limit(1);
    expect(itemRow.status).toBe("completed");
  });

  it("addAnotherCopy throws for a nonexistent book id, never silently creating an orphan copy", async () => {
    const ingestionItemId = await makeIngestionItem();
    await expect(
      addAnotherCopy(db, { bookId: "00000000-0000-0000-0000-000000000000", ingestionItemId, actorLabel: "staff" })
    ).rejects.toThrow();
  });

  it("saveForReview marks the ingestion item needs_review with the full draft, and creates no book when pendingBook is omitted", async () => {
    const ingestionItemId = await makeIngestionItem();
    const draft = createInitialDraft({ fileId: "drive-1", filename: "cover.jpg", mimeType: "image/jpeg", sizeBytes: 100, checksum: null });
    draft.reviewReason = "Ambiguous identification.";

    const result = await saveForReview(db, { ingestionItemId, draft, reviewReason: "Ambiguous identification.", actorLabel: "staff" });
    expect(result.bookId).toBeUndefined();

    const [itemRow] = await db.select().from(ingestionItems).where(eq(ingestionItems.id, ingestionItemId)).limit(1);
    expect(itemRow.status).toBe("needs_review");
    expect(itemRow.reviewReason).toBe("Ambiguous identification.");
    expect(itemRow.intakeDraft).toMatchObject({ reviewReason: "Ambiguous identification." });
  });

  it("saveNewBook marks the parent ingestion_jobs row completed, with coherent processed_items/completed_at (Phase 7 correction pass §6)", async () => {
    const ingestionItemId = await makeIngestionItem();
    const [beforeItem] = await db.select({ jobId: ingestionItems.jobId }).from(ingestionItems).where(eq(ingestionItems.id, ingestionItemId)).limit(1);
    const [beforeJob] = await db.select().from(ingestionJobs).where(eq(ingestionJobs.id, beforeItem.jobId)).limit(1);
    expect(beforeJob.status).toBe("running");
    expect(beforeJob.processedItems).toBe(0);

    const result = await saveNewBook(db, baseInput({}, ingestionItemId));
    createdBookIds.push(result.bookId);

    const [afterJob] = await db.select().from(ingestionJobs).where(eq(ingestionJobs.id, beforeItem.jobId)).limit(1);
    expect(afterJob.status).toBe("completed");
    expect(afterJob.processedItems).toBe(1);
    expect(afterJob.completedAt).not.toBeNull();
  });

  it("addAnotherCopy also marks its own parent job completed", async () => {
    const firstIngestionItemId = await makeIngestionItem();
    const created = await saveNewBook(db, baseInput({}, firstIngestionItemId));
    createdBookIds.push(created.bookId);

    const secondIngestionItemId = await makeIngestionItem();
    const [item] = await db.select({ jobId: ingestionItems.jobId }).from(ingestionItems).where(eq(ingestionItems.id, secondIngestionItemId)).limit(1);
    await addAnotherCopy(db, { bookId: created.bookId, ingestionItemId: secondIngestionItemId, actorLabel: "staff" });

    const [job] = await db.select().from(ingestionJobs).where(eq(ingestionJobs.id, item.jobId)).limit(1);
    expect(job.status).toBe("completed");
    expect(job.processedItems).toBe(1);
    expect(job.completedAt).not.toBeNull();
  });

  it("saveForReview marks the parent job completed — the automated run is done even though the ITEM still needs human review (Phase 7 final closure pass §2)", async () => {
    const ingestionItemId = await makeIngestionItem();
    const [item] = await db.select({ jobId: ingestionItems.jobId }).from(ingestionItems).where(eq(ingestionItems.id, ingestionItemId)).limit(1);
    const draft = createInitialDraft({ fileId: "drive-3", filename: "cover.jpg", mimeType: "image/jpeg", sizeBytes: 100, checksum: null });

    await saveForReview(db, { ingestionItemId, draft, reviewReason: "Needs a human look.", actorLabel: "staff" });

    const [job] = await db.select().from(ingestionJobs).where(eq(ingestionJobs.id, item.jobId)).limit(1);
    expect(job.status).toBe("completed");
    expect(job.processedItems).toBe(1);
    expect(job.completedAt).not.toBeNull();

    const [itemRow] = await db.select().from(ingestionItems).where(eq(ingestionItems.id, ingestionItemId)).limit(1);
    expect(itemRow.status).toBe("needs_review");
    expect(itemRow.intakeDraft).not.toBeNull();
  });

  it("saveForReview creates a real pending_review book + review_flags row when real minimum data was established, and it stays excluded from normal Find", async () => {
    const ingestionItemId = await makeIngestionItem();
    const draft = createInitialDraft({ fileId: "drive-2", filename: "cover.jpg", mimeType: "image/jpeg", sizeBytes: 100, checksum: null });

    const result = await saveForReview(db, {
      ingestionItemId,
      draft,
      reviewReason: "Category unclear.",
      actorLabel: "staff",
      pendingBook: {
        title: "Review Later Test Fixture Book",
        languageCode: "en",
        coverDriveFileId: "drive-2",
        coverDriveFolderId: "folder-1",
        coverFilename: "cover.jpg",
        coverMimeType: "image/jpeg",
      },
    });
    expect(result.bookId).toBeDefined();
    createdBookIds.push(result.bookId!);

    const [bookRow] = await db.select().from(books).where(eq(books.id, result.bookId!)).limit(1);
    expect(bookRow.reviewStatus).toBe("pending_review");

    const flags = await db.select().from(reviewFlags).where(eq(reviewFlags.bookId, result.bookId!));
    expect(flags.length).toBe(1);
    expect(flags[0].flagType).toBe("low_identification_confidence");

    // The pending_review book this Review Later run created must never surface in
    // normal teacher Find, exactly like any other non-"active" book (visibility.ts).
    const { ids } = await searchRepository.findVisibleBookIdsPage({ filters: EMPTY_FILTERS, limit: 500 });
    expect(ids).not.toContain(result.bookId);
  });
});
