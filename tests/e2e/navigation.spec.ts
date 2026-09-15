import { test, expect } from "@playwright/test";
import { loginAsStaff } from "./helpers";

test.describe("Home navigation", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsStaff(page);
  });

  // "Find a Book" is intentionally not in this list any more — Phase 2 replaced its
  // placeholder with the real Find experience, covered by find.spec.ts instead.
  const placeholders: Array<{ link: string; path: string; heading: string; copy: string }> = [
    {
      link: "Add a Book",
      path: "/add",
      heading: "Add a Book",
      copy: "Book intake will be added in a later phase.",
    },
    {
      link: "Reading Lists",
      path: "/lists",
      heading: "Reading Lists",
      copy: "Shared reading lists will be added in a later phase.",
    },
    {
      link: "Library Guide",
      path: "/guide",
      heading: "Library Guide",
      copy: "A visual guide to how the library is organized will be added in a later phase.",
    },
    {
      link: "Teacher Catalog",
      path: "/teacher-catalog",
      heading: "Teacher Catalog",
      copy: "This will open a shared, read-only spreadsheet view",
    },
  ];

  for (const item of placeholders) {
    test(`navigating to ${item.link} shows a polished placeholder, not a broken page`, async ({ page }) => {
      await page.getByRole("link", { name: item.link }).click();
      await expect(page).toHaveURL(item.path);
      await expect(page.getByRole("heading", { name: item.heading })).toBeVisible();
      await expect(page.getByText(item.copy)).toBeVisible();
      await page.getByRole("link", { name: "Back to Home" }).click();
      await expect(page).toHaveURL("/home");
    });
  }

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
