import { test, expect, type Page } from "@playwright/test";
import { E2E_STAFF_PASSWORD } from "../../playwright.config";

async function loginAsStaff(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Tap to Enter" }).click();
  await page.getByLabel("Staff password", { exact: true }).fill(E2E_STAFF_PASSWORD);
  await page.getByRole("button", { name: "Enter" }).click();
  await expect(page).toHaveURL("/home");
}

test.describe("Home navigation", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsStaff(page);
  });

  const placeholders: Array<{ link: string; path: string; heading: string; copy: string }> = [
    {
      link: "Find a Book",
      path: "/find",
      heading: "Find a Book",
      copy: "Search and browse the library will be implemented in the next phase.",
    },
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
