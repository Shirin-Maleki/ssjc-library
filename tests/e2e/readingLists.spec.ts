import { test, expect } from "@playwright/test";
import { loginAsStaff } from "./helpers";

test.describe("Reading Lists", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsStaff(page);
  });

  test("empty state: no lists yet, with a working create CTA", async ({ page }) => {
    await page.goto("/lists");
    await expect(page.getByRole("heading", { name: "Reading Lists" })).toBeVisible();
    await expect(page.getByText("No reading lists yet")).toBeVisible();
    await expect(
      page.getByText("Reading Lists are designed for staff to share. In this prototype, lists are saved only in this browser.")
    ).toBeVisible();
  });

  test("create a list: name is required", async ({ page }) => {
    await page.goto("/lists");
    await page.getByRole("button", { name: "Create a Reading List" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Create list" }).click();
    await expect(dialog.getByText("Give the list a name.")).toBeVisible();
    // The dialog never closed / navigated on a failed submission.
    await expect(dialog).toBeVisible();
  });

  test("create a list: Created By is optional and defaults to Anonymous", async ({ page }) => {
    await page.goto("/lists");
    await page.getByRole("button", { name: "Create a Reading List" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("List name").fill("Insects");
    await dialog.getByRole("button", { name: "Create list" }).click();

    await expect(page).toHaveURL(/\/lists\/.+/);
    await expect(page.getByRole("heading", { name: "Insects" })).toBeVisible();
    await expect(page.getByText("Anonymous", { exact: false })).toBeVisible();
  });

  test("create a list: whitespace-only Created By also becomes Anonymous", async ({ page }) => {
    await page.goto("/lists");
    await page.getByRole("button", { name: "Create a Reading List" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("List name").fill("Bedtime");
    await dialog.getByLabel("Created by (optional)").fill("   ");
    await dialog.getByRole("button", { name: "Create list" }).click();

    await expect(page.getByText("Anonymous", { exact: false })).toBeVisible();
  });

  test("create a list: a real creator name is trimmed and shown", async ({ page }) => {
    await page.goto("/lists");
    await page.getByRole("button", { name: "Create a Reading List" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("List name").fill("Insects");
    await dialog.getByLabel("Created by (optional)").fill("  Ms. Ellis  ");
    await dialog.getByRole("button", { name: "Create list" }).click();

    await expect(page.getByText("Ms. Ellis", { exact: false })).toBeVisible();
  });

  test("a created list survives a full page reload", async ({ page }) => {
    await page.goto("/lists");
    await page.getByRole("button", { name: "Create a Reading List" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("List name").fill("Insects");
    await dialog.getByRole("button", { name: "Create list" }).click();
    await expect(page).toHaveURL(/\/lists\/.+/);

    await page.reload();
    await expect(page.getByRole("heading", { name: "Insects" })).toBeVisible();

    await page.goto("/lists");
    await expect(page.getByRole("link", { name: /Insects/ })).toBeVisible();
  });

  test("rename updates the name and preserves creator/created date", async ({ page }) => {
    await page.goto("/lists");
    await page.getByRole("button", { name: "Create a Reading List" }).click();
    const createDialog = page.getByRole("dialog");
    await createDialog.getByLabel("List name").fill("Insects");
    await createDialog.getByLabel("Created by (optional)").fill("Ms. Ellis");
    await createDialog.getByRole("button", { name: "Create list" }).click();
    await expect(page.getByRole("heading", { name: "Insects" })).toBeVisible();

    await page.getByRole("button", { name: "Rename" }).click();
    const renameDialog = page.getByRole("dialog");
    const nameInput = renameDialog.getByLabel("List name");
    await expect(nameInput).toHaveValue("Insects");
    await nameInput.fill("Bugs & Insects");
    await renameDialog.getByRole("button", { name: "Save" }).click();

    await expect(page.getByRole("heading", { name: "Bugs & Insects" })).toBeVisible();
    await expect(page.getByText("Ms. Ellis", { exact: false })).toBeVisible();
  });

  test("delete requires confirmation and returns to the overview", async ({ page }) => {
    await page.goto("/lists");
    await page.getByRole("button", { name: "Create a Reading List" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("List name").fill("Temporary List");
    await dialog.getByRole("button", { name: "Create list" }).click();
    await expect(page.getByRole("heading", { name: "Temporary List" })).toBeVisible();

    await page.getByRole("button", { name: "Delete" }).click();
    const confirmDialog = page.getByRole("dialog");
    await expect(confirmDialog.getByText('Delete "Temporary List"?')).toBeVisible();
    await expect(confirmDialog.getByText("This removes the Reading List, not the books from the library.")).toBeVisible();

    await confirmDialog.getByRole("button", { name: "Delete list" }).click();
    await expect(page).toHaveURL("/lists");
    await expect(page.getByText("No reading lists yet")).toBeVisible();
  });

  test("cancelling delete keeps the list", async ({ page }) => {
    await page.goto("/lists");
    await page.getByRole("button", { name: "Create a Reading List" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("List name").fill("Keep Me");
    await dialog.getByRole("button", { name: "Create list" }).click();

    await page.getByRole("button", { name: "Delete" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("heading", { name: "Keep Me" })).toBeVisible();
  });

  test("an empty list shows guidance and a link to Find a Book", async ({ page }) => {
    await page.goto("/lists");
    await page.getByRole("button", { name: "Create a Reading List" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("List name").fill("Empty List");
    await dialog.getByRole("button", { name: "Create list" }).click();

    await expect(page.getByText("This list is empty")).toBeVisible();
    await page.getByRole("link", { name: "Find a Book" }).click();
    await expect(page).toHaveURL("/find");
  });

  test("add to list from a Search Result, then see it in the list", async ({ page }) => {
    await page.goto("/find?q=dinosaurs");
    const firstRow = page.locator("li:has(h3)").first();
    const title = await firstRow.locator("h3").innerText();

    await firstRow.getByRole("button", { name: /Add ".*" to a reading list/ }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("You don’t have any reading lists yet.")).toBeVisible();
    await dialog.getByRole("button", { name: "Create new list" }).click();
    await dialog.getByLabel("List name").fill("Dino Books");
    await dialog.getByRole("button", { name: "Create & add" }).click();

    // The dialog closes and we're still on the search results page — adding a book
    // must never navigate away from Find.
    await expect(page).toHaveURL(/\/find\?q=dinosaurs/);

    await page.goto("/lists");
    await page.getByRole("link", { name: /Dino Books/ }).click();
    await expect(page.getByRole("heading", { level: 3, name: title })).toBeVisible();
  });

  test("adding to list from a Search Result never navigates to Book Detail", async ({ page }) => {
    await page.goto("/find?q=dinosaurs");
    const firstRow = page.locator("li:has(h3)").first();
    await firstRow.getByRole("button", { name: /Add ".*" to a reading list/ }).click();
    // Still on Find, not redirected to /books/... by the click hitting the row's
    // stretched Book-Detail link underneath.
    await expect(page).toHaveURL(/\/find\?q=dinosaurs/);
    await page.keyboard.press("Escape");
  });

  test("add to list from Book Detail", async ({ page }) => {
    await page.goto("/find?q=dinosaurs");
    await page.getByRole("heading", { level: 3 }).first().getByRole("link").click();
    await expect(page).toHaveURL(/\/books\//);

    await page.getByRole("button", { name: "Add to Reading List" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Create new list" }).click();
    await dialog.getByLabel("List name").fill("From Detail");
    await dialog.getByRole("button", { name: "Create & add" }).click();

    await page.goto("/lists");
    await page.getByRole("link", { name: /From Detail/ }).click();
    await expect(page.locator("li:has(h3)")).toHaveCount(1);
  });

  test("adding the same book twice is idempotent and communicated as already added", async ({ page }) => {
    await page.goto("/find?q=dinosaurs");
    const firstRow = page.locator("li:has(h3)").first();

    await firstRow.getByRole("button", { name: /Add ".*" to a reading list/ }).click();
    let dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Create new list" }).click();
    await dialog.getByLabel("List name").fill("Dino Books");
    await dialog.getByRole("button", { name: "Create & add" }).click();

    // Add the same book to the same list a second time.
    await firstRow.getByRole("button", { name: /Add ".*" to a reading list/ }).click();
    dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Already added")).toBeVisible();
    await dialog.getByText("Dino Books", { exact: false }).click();

    await page.goto("/lists");
    await page.getByRole("link", { name: /Dino Books/ }).click();
    await expect(page.locator("li:has(h3)")).toHaveCount(1);
  });

  test("remove a book from a list without affecting the catalog", async ({ page }) => {
    await page.goto("/find?q=dinosaurs");
    const firstRow = page.locator("li:has(h3)").first();
    const title = await firstRow.locator("h3").innerText();
    await firstRow.getByRole("button", { name: /Add ".*" to a reading list/ }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Create new list" }).click();
    await dialog.getByLabel("List name").fill("Dino Books");
    await dialog.getByRole("button", { name: "Create & add" }).click();

    await page.goto("/lists");
    await page.getByRole("link", { name: /Dino Books/ }).click();
    await expect(page.locator("li:has(h3)")).toHaveCount(1);

    await page.getByRole("button", { name: `Remove "${title}" from Dino Books` }).click();
    await expect(page.getByText("This list is empty")).toBeVisible();

    // The catalog itself is untouched — the same book still appears in Find.
    await page.goto("/find?q=dinosaurs");
    await expect(page.getByRole("heading", { level: 3, name: title })).toBeVisible();
  });

  test("list detail links into Book Detail, and Book Detail returns to the originating list", async ({ page }) => {
    await page.goto("/find?q=dinosaurs");
    const firstRow = page.locator("li:has(h3)").first();
    const title = await firstRow.locator("h3").innerText();
    await firstRow.getByRole("button", { name: /Add ".*" to a reading list/ }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Create new list" }).click();
    await dialog.getByLabel("List name").fill("Dino Books");
    await dialog.getByRole("button", { name: "Create & add" }).click();

    await page.goto("/lists");
    await page.getByRole("link", { name: /Dino Books/ }).click();
    await expect(page).toHaveURL(/\/lists\/.+/);

    await page.getByRole("heading", { level: 3, name: title }).getByRole("link").click();
    await expect(page).toHaveURL(/\/books\//);
    await expect(page.getByRole("link", { name: "Back to reading list" })).toBeVisible();
    await page.getByRole("link", { name: "Back to reading list" }).click();
    await expect(page).toHaveURL(/\/lists\/.+/);
    await expect(page.getByRole("heading", { name: "Dino Books" })).toBeVisible();
  });

  test("a malformed or external from= parameter falls back safely, never redirecting out of the app", async ({ page }) => {
    await page.goto("/find?q=dinosaurs");
    const firstResultLink = page.getByRole("heading", { level: 3 }).first().getByRole("link");
    const href = await firstResultLink.getAttribute("href");
    const bookId = href?.match(/\/books\/([^?]+)/)?.[1];
    expect(bookId).toBeTruthy();

    await page.goto(`/books/${bookId}?from=https://evil.example.com`);
    await expect(page.getByRole("link", { name: "Back to results" })).toHaveAttribute("href", "/find");

    await page.goto(`/books/${bookId}?from=/lists/../../etc`);
    const fallbackHref = await page.getByRole("link", { name: /^Back to/ }).getAttribute("href");
    expect(fallbackHref).toBe("/find");
  });

  test("corrupted localStorage content is treated as empty, not a crash", async ({ page }) => {
    await page.goto("/lists");
    await page.evaluate(() => {
      window.localStorage.setItem("ssjc-library:reading-lists:v1", "{not valid json at all");
    });
    await page.reload();

    await expect(page.getByRole("heading", { name: "Reading Lists" })).toBeVisible();
    await expect(page.getByText("No reading lists yet")).toBeVisible();

    // The app is still fully functional afterward.
    await page.getByRole("button", { name: "Create a Reading List" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("List name").fill("Recovered");
    await dialog.getByRole("button", { name: "Create list" }).click();
    await expect(page.getByRole("heading", { name: "Recovered" })).toBeVisible();
  });

  test("a nonexistent list id shows a real not-found state, not a crash", async ({ page }) => {
    await page.goto("/lists/does-not-exist");
    await expect(page.getByRole("heading", { name: "List not found" })).toBeVisible();
    await page.getByRole("link", { name: "Back to Reading Lists" }).click();
    await expect(page).toHaveURL("/lists");
  });

  test("creating a list works end to end with the keyboard only", async ({ page }) => {
    await page.goto("/lists");
    await page.getByRole("button", { name: "Create a Reading List" }).focus();
    await page.keyboard.press("Enter");

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    // Radix Dialog moves focus into the content on open; the name field is first.
    await expect(dialog.getByLabel("List name")).toBeFocused();
    await page.keyboard.type("Keyboard Only");
    await page.keyboard.press("Tab");
    await expect(dialog.getByLabel("Created by (optional)")).toBeFocused();
    await page.keyboard.type("Ms. Ellis");
    // Submitting via Enter from within a field (not tabbing all the way to the
    // submit button) — WebKit's default Tab order excludes plain <button> elements
    // unless the OS's Full Keyboard Access is on, so this is both the more realistic
    // keyboard interaction and the one that's reliable across browser engines.
    await page.keyboard.press("Enter");

    await expect(page).toHaveURL(/\/lists\/.+/);
    await expect(page.getByRole("heading", { name: "Keyboard Only" })).toBeVisible();
  });
});
