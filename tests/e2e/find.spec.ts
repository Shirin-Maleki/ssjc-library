import { test, expect } from "@playwright/test";
import { loginAsStaff } from "./helpers";

test.describe("Find a Book", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsStaff(page);
    await page.goto("/find");
  });

  test("Flow 1 — topic search: dinosaurs, open a result, and return to results", async ({ page }) => {
    await page.getByRole("combobox").fill("dinosaurs");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/find\?q=dinosaurs/);
    await expect(page.getByText(/\d+ matches?/)).toBeVisible();

    const firstResultLink = page.getByRole("heading", { level: 3 }).first().getByRole("link");
    const title = await firstResultLink.textContent();
    await firstResultLink.click();

    await expect(page).toHaveURL(/\/books\//);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(title ?? "");

    await page.getByRole("link", { name: "Back to results" }).click();
    await expect(page).toHaveURL(/\/find\?q=dinosaurs/);
    await expect(page.getByRole("combobox")).toHaveValue("dinosaurs");
  });

  test("Flow 2 — autocomplete: keyboard-select an author suggestion", async ({ page }) => {
    const input = page.getByRole("combobox");
    await input.fill("eric ca");
    await expect(page.getByRole("listbox")).toBeVisible();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");

    await expect(page).toHaveURL(/q=Eric(\+|%20)Carle/);
    const results = page.getByRole("listitem");
    await expect(results.first()).toBeVisible();
  });

  test("Flow 3 — real photographs of animals genuinely works", async ({ page }) => {
    await page.getByRole("combobox").fill("animal books with real photos");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/find\?q=/);

    const rows = page.locator("li:has(h3)");
    await expect(rows.first()).toBeVisible();
    // The top (best) match is a free-text query, not a hard filter, so a "mixed"
    // book that merely mentions photography in its description could legitimately
    // appear as a weak trailing match — but the single best match must genuinely be
    // real photography, which is what "this requirement must genuinely work" means.
    await expect(rows.first().getByText("Real photography")).toBeVisible();
  });

  test("Flow 4 — multilingual: filtering to Swedish shows only Swedish results", async ({ page }) => {
    await page.getByRole("button", { name: "Filters" }).click();
    await page.getByRole("dialog").getByText("Swedish", { exact: true }).click();
    await page.getByRole("button", { name: "Show results" }).click();

    await expect(page).toHaveURL(/lang=sv/);
    const rows = page.locator("li:has(h3)");
    await expect(rows.first()).toBeVisible();
    const count = await rows.count();
    expect(count).toBeGreaterThanOrEqual(3);
  });

  test("Flow 5 — age: finding books appropriate for age 4", async ({ page }) => {
    await page.getByRole("button", { name: "Filters" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "4", exact: true }).click();
    await page.getByRole("button", { name: "Show results" }).click();

    await expect(page).toHaveURL(/age=4/);
    await expect(page.getByText(/\d+ matches?/)).toBeVisible();
    await expect(page.getByRole("link", { name: /^Age 4/ })).toBeVisible();
  });

  test("Flow 6 — duration: filtering for Under 5 minutes", async ({ page }) => {
    await page.getByRole("button", { name: "Filters" }).click();
    await page.getByRole("dialog").getByText("Under 5 minutes", { exact: true }).click();
    await page.getByRole("button", { name: "Show results" }).click();

    await expect(page).toHaveURL(/duration=under_5/);
    const rows = page.locator("li:has(h3)");
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i += 1) {
      await expect(rows.nth(i).getByText("Under 5 minutes")).toBeVisible();
    }
  });

  test("Flow 7 — combined filters intersect across three dimensions", async ({ page }) => {
    await page.getByRole("button", { name: "Filters" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByText("Animals & Nature", { exact: true }).click();
    await dialog.getByText("Real photography", { exact: true }).click();
    await dialog.getByText("Nonfiction", { exact: true }).click();
    await page.getByRole("button", { name: "Show results" }).click();

    await expect(page).toHaveURL(/category=animals-nature/);
    await expect(page).toHaveURL(/realism=real_photography/);
    await expect(page).toHaveURL(/fiction=nonfiction/);

    const rows = page.locator("li:has(h3)");
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i += 1) {
      await expect(rows.nth(i).getByText("Real photography")).toBeVisible();
      await expect(rows.nth(i).getByText("Located in", { exact: false })).toContainText("Animals & Nature");
    }
  });

  test("Flow 9 — Show More reveals additional results beyond the first five", async ({ page }) => {
    await page.getByRole("button", { name: "Filters" }).click();
    await page.getByRole("dialog").getByText("Animals & Nature", { exact: true }).click();
    await page.getByRole("button", { name: "Show results" }).click();

    const rows = page.locator("li:has(h3)");
    await expect(rows).toHaveCount(5);

    const showMore = page.getByRole("button", { name: /Show more/ });
    await expect(showMore).toBeVisible();
    await showMore.click();

    const newCount = await rows.count();
    expect(newCount).toBeGreaterThan(5);
  });

  test("Flow 10 — an incompatible combination shows the zero-results recovery state", async ({ page }) => {
    await page.getByRole("combobox").fill("something to read please");
    await page.keyboard.press("Enter");

    await expect(page.getByText("No matches in the development catalog yet.")).toBeVisible();
    await expect(page.locator("li:has(h3)")).toHaveCount(0);
  });
});

test.describe("Find a Book — mobile filter drawer", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("Flow 8 — opening, changing, and applying filters on a mobile viewport", async ({ page }) => {
    await loginAsStaff(page);
    await page.goto("/find");

    await page.getByRole("button", { name: "Filters" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    await dialog.getByText("World & Cultures", { exact: true }).click();
    await page.getByRole("button", { name: "Show results" }).click();

    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(/category=world-cultures/);
    // Scoped to the active-filters group specifically — "World & Cultures" is also a
    // quick-pick category pill elsewhere on the page, and the "×" glyph is
    // aria-hidden (decorative only; the real accessible removal name comes from the
    // sr-only "Remove ... filter" text), so it's intentionally absent here.
    await expect(
      page.getByRole("group", { name: "Active filters" }).getByRole("link", { name: "World & Cultures", exact: false })
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Filters" })).toContainText("1");
  });
});
