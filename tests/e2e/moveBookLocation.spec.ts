import { test, expect } from "@playwright/test";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { and, eq } from "drizzle-orm";
import * as schema from "../../src/db/schema";
import { loginAsStaff, tinySyntheticPng } from "./helpers";

/**
 * The real move-a-copy scenario (Phase 9 addendum), split into its own file
 * and run desktop-only (see `playwright.config.ts`'s `testIgnore`, matching
 * `readingLists.spec.ts`/`teacherCatalog.spec.ts`'s identical reasoning) —
 * this test mutates the real, shared seeded `book_copies` rows for "The
 * Gruffalo" (`src/db/seed.ts`'s `COPY_LOCATION_SLUGS_BY_BOOK`), and Playwright
 * can schedule separate spec files on separate workers even within one
 * project, so isolating both the cross-project (mobile vs desktop) AND
 * cross-file race requires both `test.describe.serial()` AND living alone in
 * this one file.
 *
 * Two real complications the first version of this test didn't account for
 * (both because the E2E database is only truncated once per whole run, never
 * per test):
 * 1. `addBook.spec.ts`'s own "exact duplicate" scenario legitimately adds a
 *    real extra copy to this SAME seeded book (via "Add another copy"), and
 *    other specs create separate, unrelated books ALSO titled "The Gruffalo"
 *    with a different author — so the real seeded book is identified by
 *    title AND its real author ("Julia Donaldson", matching
 *    `e2eFixtures.ts`'s own "gruffalo" evidence), never by title alone or by
 *    assuming a specific starting copy count.
 * 2. Assertions after the move compare against the EXACT snapshot taken in
 *    `beforeAll` (which copy, by id, moved; every other copy's location is
 *    verified unchanged) rather than a hardcoded total copy count, so extra
 *    copies added by unrelated tests never make this test flaky.
 *
 * Snapshots the exact per-copy-id location before mutating and restores that
 * exact snapshot afterward — never a blanket "reset to some default," which
 * previously (Phase 9's own Google Sheets validation pass) was found to
 * incorrectly clobber unrelated fixture state.
 */

function connectE2EDatabase() {
  const url = process.env.E2E_DATABASE_URL;
  if (!url) throw new Error("E2E_DATABASE_URL must be set.");
  const client = postgres(url, { max: 1 });
  return { db: drizzle(client, { schema }), client };
}

async function uploadMovePhoto(page: import("@playwright/test").Page, filename: string) {
  await page.goto("/move");
  await expect(page.getByRole("heading", { name: "Move a Book" })).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles({ name: filename, mimeType: "image/png", buffer: tinySyntheticPng() });
  await expect(page.getByText("Photo selected")).toBeVisible();
  await page.getByRole("button", { name: "Use this cover" }).click();
}

test.describe.serial("Move a Book — real move against shared seeded copies", () => {
  const { db, client } = connectE2EDatabase();
  let gruffaloBookId: string;
  let forestRoomLocationId: string;
  let blueRoomLocationId: string;
  let originalCopyLocations: { id: string; currentLocationId: string | null }[] = [];
  let forestRoomCopyId: string;

  test.beforeAll(async () => {
    const [book] = await db
      .select({ id: schema.books.id })
      .from(schema.books)
      .innerJoin(schema.bookContributors, and(eq(schema.bookContributors.bookId, schema.books.id), eq(schema.bookContributors.role, "author")))
      .innerJoin(schema.contributors, eq(schema.contributors.id, schema.bookContributors.contributorId))
      .where(and(eq(schema.books.title, "The Gruffalo"), eq(schema.contributors.name, "Julia Donaldson")))
      .limit(1);
    if (!book) throw new Error('The real seeded fixture book "The Gruffalo" by Julia Donaldson was not found — is the E2E database seeded (npm run db:seed)?');
    gruffaloBookId = book.id;

    const [forestRoom] = await db.select({ id: schema.libraryLocations.id }).from(schema.libraryLocations).where(eq(schema.libraryLocations.slug, "forest-room")).limit(1);
    const [blueRoom] = await db.select({ id: schema.libraryLocations.id }).from(schema.libraryLocations).where(eq(schema.libraryLocations.slug, "blue-room")).limit(1);
    if (!forestRoom || !blueRoom) throw new Error("Seeded dev-fixture locations (forest-room/blue-room) not found — is the E2E database seeded?");
    forestRoomLocationId = forestRoom.id;
    blueRoomLocationId = blueRoom.id;

    originalCopyLocations = await db
      .select({ id: schema.bookCopies.id, currentLocationId: schema.bookCopies.currentLocationId })
      .from(schema.bookCopies)
      .where(eq(schema.bookCopies.bookId, gruffaloBookId));

    const atForestRoom = originalCopyLocations.filter((c) => c.currentLocationId === forestRoomLocationId);
    if (atForestRoom.length !== 1) {
      throw new Error(`Expected exactly one of "The Gruffalo"'s copies at Forest Room before this test runs, found ${atForestRoom.length}.`);
    }
    forestRoomCopyId = atForestRoom[0].id;
  });

  test.afterAll(async () => {
    for (const copy of originalCopyLocations) {
      await db.update(schema.bookCopies).set({ currentLocationId: copy.currentLocationId }).where(eq(schema.bookCopies.id, copy.id));
    }
    await client.end();
  });

  test("photo match -> confirm -> choose source -> choose destination -> exactly one copy moves", async ({ page }) => {
    await loginAsStaff(page);
    await uploadMovePhoto(page, "gruffalo-move-test.png");

    // Several real candidates can legitimately come back (see the file's own
    // doc comment) — never assume list position or count; the real seeded
    // book is the one with the real author.
    await expect(page.getByRole("heading", { name: /Which book is this\?|Is this it\?/ })).toBeVisible({ timeout: 15000 });
    const realGruffaloCandidate = page.locator("li", { hasText: "Julia Donaldson" });
    await expect(realGruffaloCandidate).toBeVisible();
    await realGruffaloCandidate.getByRole("button", { name: "Yes, this is it" }).click();

    // This book has copies at Forest Room AND at least one other bucket
    // (unrecorded, and/or wherever `addBook.spec.ts`'s own "Add another
    // copy" scenario left its extra copy) — real ambiguity, so the workflow
    // must ask which one this specific copy came from rather than guessing.
    await expect(page.getByRole("heading", { name: "Where did you take this copy from?" })).toBeVisible({ timeout: 15000 });
    await page.getByRole("button", { name: /Forest Room/ }).click();

    await expect(page.getByRole("heading", { name: "Where is it now?" })).toBeVisible();
    await expect(page.getByText(/taking from Forest Room/i)).toBeVisible();
    await page.getByRole("button", { name: "Blue Room" }).click();

    await expect(page.getByText("Moved")).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/Forest Room.*Blue Room/)).toBeVisible();

    const rowsAfter = await db.select({ id: schema.bookCopies.id, currentLocationId: schema.bookCopies.currentLocationId }).from(schema.bookCopies).where(eq(schema.bookCopies.bookId, gruffaloBookId));

    // No copy created or destroyed — same set of copy ids as the snapshot.
    expect(rowsAfter.length).toBe(originalCopyLocations.length);
    expect(new Set(rowsAfter.map((r) => r.id))).toEqual(new Set(originalCopyLocations.map((r) => r.id)));

    // Exactly the one copy that was at Forest Room moved to Blue Room —
    // every other copy's location is byte-for-byte unchanged.
    for (const row of rowsAfter) {
      if (row.id === forestRoomCopyId) {
        expect(row.currentLocationId).toBe(blueRoomLocationId);
      } else {
        const original = originalCopyLocations.find((o) => o.id === row.id);
        expect(row.currentLocationId).toBe(original?.currentLocationId ?? null);
      }
    }
  });
});
