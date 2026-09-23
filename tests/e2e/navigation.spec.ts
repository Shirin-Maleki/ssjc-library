import { test, expect } from "@playwright/test";
import { loginAsStaff } from "./helpers";

test.describe("Home navigation", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsStaff(page);
  });

  // "Find a Book" (Phase 2), "Reading Lists" / "Library Guide" (Phase 3),
  // "Add a Book" (Phase 7), "Teacher Catalog" (Phase 9), and "Move a Book"
  // (Phase 9 addendum) are intentionally not placeholders any more — each
  // replaced its placeholder with a real experience, covered by its own spec
  // file instead (find.spec.ts, readingLists.spec.ts, guide.spec.ts,
  // addBook.spec.ts, teacherCatalog.spec.ts, moveBook.spec.ts +
  // moveBookLocation.spec.ts — the state-mutating Move scenario lives alone in
  // the latter, desktop-only and serially-ordered, to avoid racing shared
  // `book_copies`/`system_settings` rows against whatever order separate spec
  // files happen to be scheduled in).

  test("the two primary actions are visually dominant over secondary navigation", async ({ page }) => {
    const findTile = page.getByRole("link", { name: /Find a Book/ });
    const listsTile = page.getByRole("link", { name: /Reading Lists/ });
    const findBox = await findTile.boundingBox();
    const listsBox = await listsTile.boundingBox();
    expect(findBox).not.toBeNull();
    expect(listsBox).not.toBeNull();
    // The primary tile occupies meaningfully more vertical space than a secondary nav row.
    expect(findBox!.height).toBeGreaterThan(listsBox!.height * 1.5);
  });
});
