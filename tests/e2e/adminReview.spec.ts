import { test, expect } from "@playwright/test";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import * as schema from "../../src/db/schema";
import { createInitialDraft, parseIntakeDraft } from "../../src/lib/intake/draft";
import { loginAsStaff, uniqueName } from "./helpers";
import { E2E_ADMIN_PASSWORD } from "../../playwright.config";

/**
 * Phase 8 admin review E2E coverage — uses disposable fixtures created directly
 * against the shared E2E database (mirroring `tests/e2e/helpers.ts`'s own
 * `uniqueName` convention for Reading Lists, which is genuinely shared Postgres
 * data across the whole run) rather than driving the full multi-step Add Book
 * upload flow just to get a `needs_review` ingestion item to exist. Never mutates
 * real Drive/library records — every row this file creates is its own disposable
 * fixture, deleted in `afterAll`.
 */

function connectE2EDatabase() {
  const url = process.env.E2E_DATABASE_URL;
  if (!url) throw new Error("E2E_DATABASE_URL must be set.");
  const client = postgres(url, { max: 1 });
  return { db: drizzle(client, { schema }), client };
}

async function loginAsAdmin(page: import("@playwright/test").Page) {
  await loginAsStaff(page);
  await page.goto("/admin");
  await page.getByLabel("Admin password", { exact: true }).fill(E2E_ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Unlock" }).click();
  // Waits for the elevated overview to actually render before any subsequent
  // navigation — without this, a following page.goto() can race the Server
  // Action's redirect/cookie-set and land back on the unlock prompt.
  await expect(page.getByRole("link", { name: /Needs Review/ })).toBeVisible();
}

test.describe("Admin Review — Review Later resolution (Scenario A)", () => {
  const { db, client } = connectE2EDatabase();
  const title = uniqueName("E2E Review Later Book");
  let ingestionItemId: string;
  let jobId: string;

  test.beforeAll(async () => {
    const [job] = await db.insert(schema.ingestionJobs).values({ jobType: "single_add", source: "teacher_capture", status: "running", totalItems: 1 }).returning({ id: schema.ingestionJobs.id });
    jobId = job.id;
    const [item] = await db.insert(schema.ingestionItems).values({ jobId, driveFileId: `e2e-drive-${Date.now()}`, status: "processing" }).returning({ id: schema.ingestionItems.id });
    ingestionItemId = item.id;

    const draft = parseIntakeDraft({
      ...createInitialDraft({ fileId: `e2e-drive-${Date.now()}`, filename: "cover.jpg", mimeType: "image/jpeg", sizeBytes: 1000, checksum: null }),
      proposedBookValues: { title, subtitle: null, authors: ["E2E Test Author"], illustrators: [], publisher: null, languageCode: "en", additionalLanguageCodes: [], isbn10: null, isbn13: null },
    });
    await db.update(schema.ingestionItems).set({ status: "needs_review", reviewReason: "E2E fixture", intakeDraft: draft }).where(eq(schema.ingestionItems.id, ingestionItemId));
  });

  test.afterAll(async () => {
    // The approval this test performs creates a real book + copy — the circular
    // ingestion_items <-> book_copies FK (docs/DATA_MODEL.md) means
    // resulting_copy_id must be nulled before either side can be deleted.
    const [approvedBook] = await db.select({ id: schema.books.id }).from(schema.books).where(eq(schema.books.title, title)).limit(1);
    await db.update(schema.ingestionItems).set({ resultingCopyId: null, pendingBookId: null }).where(eq(schema.ingestionItems.id, ingestionItemId));
    if (approvedBook) {
      await db.delete(schema.bookCopies).where(eq(schema.bookCopies.bookId, approvedBook.id));
    }
    await db.delete(schema.ingestionItems).where(eq(schema.ingestionItems.id, ingestionItemId));
    await db.delete(schema.ingestionJobs).where(eq(schema.ingestionJobs.id, jobId));
    if (approvedBook) {
      await db.delete(schema.books).where(eq(schema.books.id, approvedBook.id));
    }
    await client.end();
  });

  test("appears in the queue, can be opened, corrected, given a category, and approved into a findable catalog record", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/review");
    await expect(page.getByRole("link", { name: new RegExp(title) })).toBeVisible();

    await page.getByRole("link", { name: new RegExp(title) }).click();
    await expect(page.getByRole("heading", { name: title })).toBeVisible();

    await page.getByLabel("Physical category").selectOption("stories-imagination");
    await page.getByRole("button", { name: "Approve into catalog" }).click();

    await expect(page).toHaveURL("/admin/review");

    // The approved record is now conventionally searchable (§43).
    await page.goto(`/find?q=${encodeURIComponent(title)}`);
    await expect(page.getByRole("link", { name: new RegExp(title) })).toBeVisible();
  });
});

test.describe("Admin Review — duplicate resolution (Scenario B)", () => {
  const { db, client } = connectE2EDatabase();
  const existingTitle = uniqueName("E2E Existing Canonical Book");
  const pendingTitle = uniqueName("E2E Duplicate Candidate Book");
  let existingBookId: string;
  let pendingBookId: string;
  let ingestionItemId: string;
  let jobId: string;

  test.beforeAll(async () => {
    const [category] = await db.select().from(schema.physicalCategories).where(eq(schema.physicalCategories.slug, "stories-imagination")).limit(1);
    const [existingBook] = await db
      .insert(schema.books)
      .values({ title: existingTitle, normalizedTitle: existingTitle.toLowerCase(), sortTitle: existingTitle, languageCode: "en", physicalCategoryId: category.id, reviewStatus: "active" })
      .returning({ id: schema.books.id });
    existingBookId = existingBook.id;

    const [pendingBook] = await db
      .insert(schema.books)
      .values({ title: pendingTitle, normalizedTitle: pendingTitle.toLowerCase(), sortTitle: pendingTitle, languageCode: "en", reviewStatus: "pending_review" })
      .returning({ id: schema.books.id });
    pendingBookId = pendingBook.id;

    const [job] = await db.insert(schema.ingestionJobs).values({ jobType: "single_add", source: "teacher_capture", status: "running", totalItems: 1 }).returning({ id: schema.ingestionJobs.id });
    jobId = job.id;
    const [item] = await db.insert(schema.ingestionItems).values({ jobId, driveFileId: `e2e-drive-${Date.now()}`, status: "processing" }).returning({ id: schema.ingestionItems.id });
    ingestionItemId = item.id;

    const draft = parseIntakeDraft({
      ...createInitialDraft({ fileId: `e2e-drive-${Date.now()}`, filename: "cover.jpg", mimeType: "image/jpeg", sizeBytes: 1000, checksum: null }),
      duplicateOutcome: "exact_copy_same_edition",
      duplicateCandidateBookIds: [existingBookId],
      proposedBookValues: { title: pendingTitle, subtitle: null, authors: [], illustrators: [], publisher: null, languageCode: "en", additionalLanguageCodes: [], isbn10: null, isbn13: null },
    });
    await db.update(schema.ingestionItems).set({ status: "needs_review", reviewReason: "E2E duplicate fixture", intakeDraft: draft, pendingBookId }).where(eq(schema.ingestionItems.id, ingestionItemId));
  });

  test.afterAll(async () => {
    await db.update(schema.ingestionItems).set({ resultingCopyId: null, pendingBookId: null }).where(eq(schema.ingestionItems.id, ingestionItemId));
    await db.delete(schema.bookCopies).where(eq(schema.bookCopies.bookId, existingBookId));
    await db.delete(schema.ingestionItems).where(eq(schema.ingestionItems.id, ingestionItemId));
    await db.delete(schema.ingestionJobs).where(eq(schema.ingestionJobs.id, jobId));
    await db.delete(schema.books).where(eq(schema.books.id, pendingBookId));
    await db.delete(schema.books).where(eq(schema.books.id, existingBookId));
    await client.end();
  });

  test("Same edition adds a physical copy to the existing book and never creates a second active bibliographic record", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto(`/admin/review/${encodeURIComponent(`book:${pendingBookId}`)}`);
    await expect(page.getByText(existingTitle)).toBeVisible();
    await page.getByRole("button", { name: "Same edition" }).click();
    await expect(page).toHaveURL("/admin/review");

    const copies = await db.select().from(schema.bookCopies).where(eq(schema.bookCopies.bookId, existingBookId));
    expect(copies).toHaveLength(1);
    const [placeholderRow] = await db.select().from(schema.books).where(eq(schema.books.id, pendingBookId)).limit(1);
    expect(placeholderRow.reviewStatus).toBe("archived");
  });
});

test.describe("Admin Taxonomy — category deactivation safety (Scenario I)", () => {
  const { db, client } = connectE2EDatabase();
  const categoryLabel = uniqueName("E2E Referenced Category");
  let categoryId: string;
  let bookId: string;

  test.beforeAll(async () => {
    const [category] = await db.insert(schema.physicalCategories).values({ slug: categoryLabel.toLowerCase().replaceAll(" ", "-"), label: categoryLabel }).returning({ id: schema.physicalCategories.id });
    categoryId = category.id;
    const [book] = await db
      .insert(schema.books)
      .values({ title: uniqueName("E2E Category Reference Book"), normalizedTitle: "x", sortTitle: "x", languageCode: "en", physicalCategoryId: categoryId, reviewStatus: "active" })
      .returning({ id: schema.books.id });
    bookId = book.id;
  });

  test.afterAll(async () => {
    await db.delete(schema.books).where(eq(schema.books.id, bookId));
    await db.delete(schema.physicalCategories).where(eq(schema.physicalCategories.id, categoryId));
    await client.end();
  });

  test("a category referenced by an active book shows a real count and a disabled Deactivate control, never a silent hidden-category state", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/taxonomy");
    await expect(page.getByText(categoryLabel)).toBeVisible();
    await expect(page.getByText(/1 book still use this category. Re-categorize it before deactivating it\./)).toBeVisible();

    const listItem = page.locator("li", { has: page.getByText(categoryLabel) });
    await expect(listItem.getByRole("button", { name: "Deactivate" })).toBeDisabled();

    const [categoryRow] = await db.select().from(schema.physicalCategories).where(eq(schema.physicalCategories.id, categoryId)).limit(1);
    expect(categoryRow.isActive).toBe(true);
  });
});

test.describe("Admin Review — expanded metadata editor resolves a previously-impossible queue reason (correction pass §5)", () => {
  const { db, client } = connectE2EDatabase();
  const title = uniqueName("E2E Missing Contributors Book");
  let categoryId: string;
  let bookId: string;

  test.beforeAll(async () => {
    const [category] = await db.select().from(schema.physicalCategories).where(eq(schema.physicalCategories.slug, "stories-imagination")).limit(1);
    categoryId = category.id;
    const [book] = await db
      .insert(schema.books)
      .values({
        title,
        normalizedTitle: title.toLowerCase(),
        sortTitle: title,
        languageCode: "en",
        physicalCategoryId: categoryId,
        reviewStatus: "active",
        // Otherwise-complete metadata — the ONLY missing-metadata signal this
        // fixture should ever produce is the missing author, which the OLD
        // book-only editor (description/category/age/format only) had no way
        // to correct at all.
        shortDescription: "A complete description.",
        ageMinMonths: 24,
        ageMaxMonths: 60,
        format: "picture_book",
        visualRealism: "cartoon",
      })
      .returning({ id: schema.books.id });
    bookId = book.id;
  });

  test.afterAll(async () => {
    await db.delete(schema.books).where(eq(schema.books.id, bookId));
    await client.end();
  });

  test("correcting the missing author through the real Admin UI makes the queue item disappear", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/review");
    const queueLink = page.getByRole("link", { name: new RegExp(title) });
    await expect(queueLink).toBeVisible();
    await expect(queueLink).toContainText(/Missing authors\/illustrators/);

    await queueLink.click();
    await expect(page.getByRole("heading", { name: title })).toBeVisible();

    await page.getByLabel("Author(s)").fill("A Real Author");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Saved.")).toBeVisible();

    await page.goto("/admin/review");
    await expect(page.getByRole("link", { name: new RegExp(title) })).toHaveCount(0);
  });
});

test.describe("Admin Review — human verification UX (correction pass §6)", () => {
  const { db, client } = connectE2EDatabase();
  const title = uniqueName("E2E Category Verify Book");
  let categoryId: string;
  let bookId: string;
  let flagId: string;

  test.beforeAll(async () => {
    const [category] = await db.select().from(schema.physicalCategories).where(eq(schema.physicalCategories.slug, "stories-imagination")).limit(1);
    categoryId = category.id;
    const [book] = await db
      .insert(schema.books)
      .values({
        title,
        normalizedTitle: title.toLowerCase(),
        sortTitle: title,
        languageCode: "en",
        physicalCategoryId: categoryId,
        reviewStatus: "active",
        shortDescription: "A complete description.",
        ageMinMonths: 24,
        ageMaxMonths: 60,
        format: "picture_book",
        visualRealism: "cartoon",
      })
      .returning({ id: schema.books.id });
    bookId = book.id;
    const [author] = await db.insert(schema.contributors).values({ name: "Verify Flow Author", normalizedName: `verify flow author ${Date.now()}` }).returning({ id: schema.contributors.id });
    await db.insert(schema.bookContributors).values({ bookId, contributorId: author.id, role: "author", sortOrder: 0 });
    const [flag] = await db.insert(schema.reviewFlags).values({ bookId, flagType: "category_uncertain", detail: "AI suggested this category with medium confidence." }).returning({ id: schema.reviewFlags.id });
    flagId = flag.id;
  });

  test.afterAll(async () => {
    await db.delete(schema.reviewFlags).where(eq(schema.reviewFlags.id, flagId));
    await db.delete(schema.books).where(eq(schema.books.id, bookId));
    await client.end();
  });

  test("'Keep current category' marks physical_category human_verified, resolves the category flag, and leaves the category value unchanged", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto(`/admin/review/${encodeURIComponent(`book:${bookId}`)}`);
    await expect(page.getByRole("heading", { name: title })).toBeVisible();

    const categorySelectBefore = await page.getByLabel("Physical category").inputValue();
    expect(categorySelectBefore).toBe("stories-imagination");

    await page.getByRole("button", { name: "Keep current category (mark verified)" }).click();
    await expect(page.getByText("Category kept as-is and marked verified.")).toBeVisible();

    // The UI communicates KEPT, not changed — the category selection is
    // unaffected, never reset or altered by the verify action.
    const categorySelectAfter = await page.getByLabel("Physical category").inputValue();
    expect(categorySelectAfter).toBe("stories-imagination");

    const [categoryProvenance] = await db.select().from(schema.bookFieldProvenance).where(eq(schema.bookFieldProvenance.bookId, bookId));
    expect(categoryProvenance.fieldKey).toBe("physical_category");
    expect(categoryProvenance.sourceType).toBe("human_verified");

    const [flagRow] = await db.select().from(schema.reviewFlags).where(eq(schema.reviewFlags.id, flagId));
    expect(flagRow.status).toBe("resolved");

    const [bookRow] = await db.select({ physicalCategoryId: schema.books.physicalCategoryId }).from(schema.books).where(eq(schema.books.id, bookId));
    expect(bookRow.physicalCategoryId).toBe(categoryId); // never changed
  });
});
