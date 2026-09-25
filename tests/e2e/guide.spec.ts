import { test, expect } from "@playwright/test";
import { loginAsStaff } from "./helpers";

test.describe("Library Guide", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsStaff(page);
  });

  test("Home -> Library Guide renders a real guide with one primary heading", async ({ page }) => {
    await page.getByRole("link", { name: "Library Guide" }).click();
    await expect(page).toHaveURL("/guide");
    await expect(page.getByRole("heading", { level: 1, name: "Library Guide" })).toBeVisible();
  });

  test("has meaningful section headings, not a wall of undifferentiated text", async ({ page }) => {
    await page.goto("/guide");
    const headings = page.getByRole("heading", { level: 2 });
    await expect(headings).toHaveCount(7);
    await expect(page.getByRole("heading", { level: 2, name: "How the library is organized" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "How to find a book" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "How to return a book" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Where a book currently is" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "How to add a book" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Review Later" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Reading Lists" })).toBeVisible();
  });

  test("explains that an animal-character story still belongs on Stories & Imagination, not Animals & Nature (Phase 10C taxonomy guidance)", async ({ page }) => {
    await page.goto("/guide");
    await expect(page.getByText(/isn.t automatically Animals & Nature/i)).toBeVisible();
  });

  test("explains category vs. current location, and links to Move a Book (Phase 9 addendum / Phase 10C)", async ({ page }) => {
    await page.goto("/guide");
    await expect(page.getByRole("heading", { level: 2, name: "Where a book currently is" })).toBeVisible();
    await expect(page.getByText(/never changes the book.s category/i)).toBeVisible();
    await page.getByRole("link", { name: "Open Move a Book" }).click();
    await expect(page).toHaveURL("/move");
  });

  test("explains the core physical-category-vs-tags distinction with a real, non-contradictory example", async ({ page }) => {
    await page.goto("/guide");
    await expect(page.getByText("one primary physical category", { exact: false })).toBeVisible();
    await expect(page.getByText("many digital tags", { exact: false })).toBeVisible();
    // The example must actually exist in the fixture catalog (Find a Book), not
    // contradict it — Animals & Nature / animals,baby animals,nature is real fixture
    // data (see the "Amazing Animal Babies" result in find.spec.ts's fixtures).
    await expect(page.getByText("Animals & Nature", { exact: true }).first()).toBeVisible();
  });

  test("explains the alphabetical-by-title return workflow explicitly", async ({ page }) => {
    await page.goto("/guide");
    await expect(page.getByText(/alphabetically by title/i)).toBeVisible();
  });

  test("describes Add a Book and Review Later in the future tense, never implying they work today", async ({ page }) => {
    await page.goto("/guide");
    await expect(page.getByText(/isn.t built yet/i)).toBeVisible();
    await expect(page.getByText(/doesn.t exist yet/i)).toBeVisible();
    // No fake call-to-action button for a feature that doesn't exist.
    await expect(page.getByRole("button", { name: /add a book/i })).toHaveCount(0);
  });

  test("links out to the real Find a Book and Reading Lists destinations", async ({ page }) => {
    await page.goto("/guide");
    await page.getByRole("link", { name: "Open Find a Book" }).click();
    await expect(page).toHaveURL("/find");

    await page.goto("/guide");
    await page.getByRole("link", { name: "Open Reading Lists" }).click();
    await expect(page).toHaveURL("/lists");
  });

  test("describes Reading Lists as a shared staff resource, not a personal/device-local one (Phase 4)", async ({ page }) => {
    await page.goto("/guide");
    await expect(page.getByText(/shared staff resource/i)).toBeVisible();
    await expect(page.getByText(/saved only in the browser/i)).toHaveCount(0);
  });
});
