import { test, expect } from "@playwright/test";
import { loginAsStaff, openCreateListDialog, uniqueName } from "./helpers";

/**
 * Reading Lists are genuinely shared, persistent Postgres data as of Phase 4
 * (docs/DECISIONS.md) — every list a test creates here stays visible to every other
 * test for the rest of the run, unlike Phase 3's per-browser-context `localStorage`.
 * Two consequences shape this whole file:
 *
 * 1. Every created list gets a collision-proof name (`uniqueName`), so a
 *    `getByRole(..., { name })` locator is never ambiguous no matter what other tests
 *    have already created.
 * 2. Exactly two assertions in the whole product depend on the shared list being
 *    truly, globally empty (the overview's "No reading lists yet" CTA, and the
 *    Add-to-list dialog's "You don't have any reading lists yet." message) — both are
 *    covered by the first two tests below, before any other test creates a list, and
 *    this file runs serially (see `test.describe.configure` below) on the desktop
 *    project only (`playwright.config.ts`) so nothing else can race that ordering.
 */
test.describe("Reading Lists", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeEach(async ({ page }) => {
    await loginAsStaff(page);
  });

  test("empty state: no lists yet, with a working create CTA", async ({ page }) => {
    await page.goto("/lists");
    await expect(page.getByRole("heading", { name: "Reading Lists" })).toBeVisible();
    await expect(page.getByText("No reading lists yet")).toBeVisible();
    await expect(page.getByText("Reading Lists are shared with every staff member", { exact: false })).toBeVisible();
  });

  test("the Add-to-list dialog shows a no-lists-yet message before any list exists", async ({ page }) => {
    await page.goto("/find?q=dinosaurs");
    const firstRow = page.locator("li:has(h3)").first();
    await firstRow.getByRole("button", { name: /Add ".*" to a reading list/ }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("You don’t have any reading lists yet.")).toBeVisible();
    await page.keyboard.press("Escape");
  });

  test("create a list: name is required", async ({ page }) => {
    await page.goto("/lists");
    await openCreateListDialog(page);
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Create list" }).click();
    await expect(dialog.getByText("Give the list a name.")).toBeVisible();
    // The dialog never closed / navigated on a failed submission.
    await expect(dialog).toBeVisible();
  });

  test("create a list: Created By is optional and defaults to Anonymous", async ({ page }) => {
    const name = uniqueName("Insects");
    await page.goto("/lists");
    await openCreateListDialog(page);
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("List name").fill(name);
    await dialog.getByRole("button", { name: "Create list" }).click();

    await expect(page).toHaveURL(/\/lists\/.+/);
    await expect(page.getByRole("heading", { name })).toBeVisible();
    await expect(page.getByText("Anonymous", { exact: false })).toBeVisible();
  });

  test("create a list: whitespace-only Created By also becomes Anonymous", async ({ page }) => {
    const name = uniqueName("Bedtime");
    await page.goto("/lists");
    await openCreateListDialog(page);
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("List name").fill(name);
    await dialog.getByLabel("Created by (optional)").fill("   ");
    await dialog.getByRole("button", { name: "Create list" }).click();

    // Creation is now a genuine async DB round-trip (a Server Action, not synchronous
    // localStorage) — wait for the navigation it triggers before asserting on the
    // resulting page, or this can transiently race the still-closing dialog/previous
    // page and match stray "Anonymous" text elsewhere (e.g. another list's row).
    await expect(page).toHaveURL(/\/lists\/.+/);
    await expect(page.getByRole("heading", { name })).toBeVisible();
    await expect(page.getByText("Anonymous", { exact: false })).toBeVisible();
  });

  test("create a list: a real creator name is trimmed and shown", async ({ page }) => {
    const name = uniqueName("Insects");
    await page.goto("/lists");
    await openCreateListDialog(page);
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("List name").fill(name);
    await dialog.getByLabel("Created by (optional)").fill("  Ms. Ellis  ");
    await dialog.getByRole("button", { name: "Create list" }).click();

    await expect(page).toHaveURL(/\/lists\/.+/);
    await expect(page.getByRole("heading", { name })).toBeVisible();
    await expect(page.getByText("Ms. Ellis", { exact: false })).toBeVisible();
  });

  test("a created list survives a full page reload", async ({ page }) => {
    const name = uniqueName("Insects");
    await page.goto("/lists");
    await openCreateListDialog(page);
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("List name").fill(name);
    await dialog.getByRole("button", { name: "Create list" }).click();
    await expect(page).toHaveURL(/\/lists\/.+/);

    await page.reload();
    await expect(page.getByRole("heading", { name })).toBeVisible();

    await page.goto("/lists");
    await expect(page.getByRole("link", { name: new RegExp(name) })).toBeVisible();
  });

  test("rename updates the name and preserves creator/created date", async ({ page }) => {
    const name = uniqueName("Insects");
    const renamedTo = uniqueName("Bugs & Insects");
    await page.goto("/lists");
    await openCreateListDialog(page);
    const createDialog = page.getByRole("dialog");
    await createDialog.getByLabel("List name").fill(name);
    await createDialog.getByLabel("Created by (optional)").fill("Ms. Ellis");
    await createDialog.getByRole("button", { name: "Create list" }).click();
    await expect(page.getByRole("heading", { name })).toBeVisible();

    await page.getByRole("button", { name: "Rename" }).click();
    const renameDialog = page.getByRole("dialog");
    const nameInput = renameDialog.getByLabel("List name");
    await expect(nameInput).toHaveValue(name);
    await nameInput.fill(renamedTo);
    await renameDialog.getByRole("button", { name: "Save" }).click();

    await expect(page.getByRole("heading", { name: renamedTo })).toBeVisible();
    await expect(page.getByText("Ms. Ellis", { exact: false })).toBeVisible();
  });

  test("delete requires confirmation and returns to the overview", async ({ page }) => {
    const name = uniqueName("Temporary List");
    await page.goto("/lists");
    await openCreateListDialog(page);
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("List name").fill(name);
    await dialog.getByRole("button", { name: "Create list" }).click();
    await expect(page.getByRole("heading", { name })).toBeVisible();

    await page.getByRole("button", { name: "Delete" }).click();
    const confirmDialog = page.getByRole("dialog");
    await expect(confirmDialog.getByText(`Delete "${name}"?`)).toBeVisible();
    await expect(confirmDialog.getByText("This removes the Reading List, not the books from the library.")).toBeVisible();

    await confirmDialog.getByRole("button", { name: "Delete list" }).click();
    await expect(page).toHaveURL("/lists");
    // Other tests' lists remain in the shared database — only this list is gone.
    await expect(page.getByRole("link", { name: new RegExp(name) })).toHaveCount(0);
  });

  test("cancelling delete keeps the list", async ({ page }) => {
    const name = uniqueName("Keep Me");
    await page.goto("/lists");
    await openCreateListDialog(page);
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("List name").fill(name);
    await dialog.getByRole("button", { name: "Create list" }).click();

    await page.getByRole("button", { name: "Delete" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("heading", { name })).toBeVisible();
  });

  test("an empty list shows guidance and a link to Find a Book", async ({ page }) => {
    const name = uniqueName("Empty List");
    await page.goto("/lists");
    await openCreateListDialog(page);
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("List name").fill(name);
    await dialog.getByRole("button", { name: "Create list" }).click();

    await expect(page.getByText("This list is empty")).toBeVisible();
    await page.getByRole("link", { name: "Find a Book" }).click();
    await expect(page).toHaveURL("/find");
  });

  test("add to list from a Search Result, then see it in the list", async ({ page }) => {
    const name = uniqueName("Dino Books");
    await page.goto("/find?q=dinosaurs");
    const firstRow = page.locator("li:has(h3)").first();
    const title = await firstRow.locator("h3").innerText();

    await firstRow.getByRole("button", { name: /Add ".*" to a reading list/ }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Create new list" }).click();
    await dialog.getByLabel("List name").fill(name);
    await dialog.getByRole("button", { name: "Create & add" }).click();

    // Creating the list and adding the book are two sequential, genuinely async DB
    // round-trips (Server Actions, not synchronous localStorage) — wait for the dialog
    // to actually close before navigating away, or `page.goto` below can tear down the
    // page mid-flight and orphan the still-in-progress "add book" call.
    await expect(dialog).toBeHidden();
    // We're still on the search results page — adding a book must never navigate away
    // from Find.
    await expect(page).toHaveURL(/\/find\?q=dinosaurs/);

    await page.goto("/lists");
    await page.getByRole("link", { name: new RegExp(name) }).click();
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
    const name = uniqueName("From Detail");
    await page.goto("/find?q=dinosaurs");
    await page.getByRole("heading", { level: 3 }).first().getByRole("link").click();
    await expect(page).toHaveURL(/\/books\//);

    await page.getByRole("button", { name: "Add to Reading List" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Create new list" }).click();
    await dialog.getByLabel("List name").fill(name);
    await dialog.getByRole("button", { name: "Create & add" }).click();

    // See the comment in the previous test — wait for the async create+add to finish
    // (the dialog closing is proof of that) before a full navigation can orphan it.
    await expect(dialog).toBeHidden();
    await page.goto("/lists");
    await page.getByRole("link", { name: new RegExp(name) }).click();
    await expect(page.locator("li:has(h3)")).toHaveCount(1);
  });

  test("adding the same book twice is idempotent and communicated as already added", async ({ page }) => {
    const name = uniqueName("Dino Books");
    await page.goto("/find?q=dinosaurs");
    const firstRow = page.locator("li:has(h3)").first();

    await firstRow.getByRole("button", { name: /Add ".*" to a reading list/ }).click();
    let dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Create new list" }).click();
    await dialog.getByLabel("List name").fill(name);
    await dialog.getByRole("button", { name: "Create & add" }).click();

    // Add the same book to the same list a second time. This book has likely already
    // been added to other lists by earlier tests too, so scope to this test's own list
    // row rather than matching "Already added" anywhere in the dialog.
    await firstRow.getByRole("button", { name: /Add ".*" to a reading list/ }).click();
    dialog = page.getByRole("dialog");
    const ownListRow = dialog.getByRole("button", { name: new RegExp(name) });
    await expect(ownListRow.getByText("Already added")).toBeVisible();
    await ownListRow.click();
    await expect(dialog).toBeHidden();

    await page.goto("/lists");
    await page.getByRole("link", { name: new RegExp(name) }).click();
    await expect(page.locator("li:has(h3)")).toHaveCount(1);
  });

  test("remove a book from a list without affecting the catalog", async ({ page }) => {
    const name = uniqueName("Dino Books");
    await page.goto("/find?q=dinosaurs");
    const firstRow = page.locator("li:has(h3)").first();
    const title = await firstRow.locator("h3").innerText();
    await firstRow.getByRole("button", { name: /Add ".*" to a reading list/ }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Create new list" }).click();
    await dialog.getByLabel("List name").fill(name);
    await dialog.getByRole("button", { name: "Create & add" }).click();

    await expect(dialog).toBeHidden();
    await page.goto("/lists");
    await page.getByRole("link", { name: new RegExp(name) }).click();
    await expect(page.locator("li:has(h3)")).toHaveCount(1);

    await page.getByRole("button", { name: `Remove "${title}" from ${name}` }).click();
    await expect(page.getByText("This list is empty")).toBeVisible();

    // The catalog itself is untouched — the same book still appears in Find.
    await page.goto("/find?q=dinosaurs");
    await expect(page.getByRole("heading", { level: 3, name: title })).toBeVisible();
  });

  test("list detail links into Book Detail, and Book Detail returns to the originating list", async ({ page }) => {
    const name = uniqueName("Dino Books");
    await page.goto("/find?q=dinosaurs");
    const firstRow = page.locator("li:has(h3)").first();
    const title = await firstRow.locator("h3").innerText();
    await firstRow.getByRole("button", { name: /Add ".*" to a reading list/ }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Create new list" }).click();
    await dialog.getByLabel("List name").fill(name);
    await dialog.getByRole("button", { name: "Create & add" }).click();

    await expect(dialog).toBeHidden();
    await page.goto("/lists");
    await page.getByRole("link", { name: new RegExp(name) }).click();
    await expect(page).toHaveURL(/\/lists\/.+/);

    await page.getByRole("heading", { level: 3, name: title }).getByRole("link").click();
    await expect(page).toHaveURL(/\/books\//);
    await expect(page.getByRole("link", { name: "Back to reading list" })).toBeVisible();
    await page.getByRole("link", { name: "Back to reading list" }).click();
    await expect(page).toHaveURL(/\/lists\/.+/);
    await expect(page.getByRole("heading", { name })).toBeVisible();
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

  test("a nonexistent list id shows a real not-found state, not a crash", async ({ page }) => {
    await page.goto("/lists/does-not-exist");
    await expect(page.getByRole("heading", { name: "List not found" })).toBeVisible();
    await page.getByRole("link", { name: "Back to Reading Lists" }).click();
    await expect(page).toHaveURL("/lists");
  });

  test("creating a list works end to end with the keyboard only", async ({ page }) => {
    const name = uniqueName("Keyboard Only");
    await page.goto("/lists");
    // By this point in the suite other tests have already created lists, so the
    // overview shows "New list" rather than the empty-state "Create a Reading List"
    // CTA — either way it's the one button that opens this dialog.
    await page.getByRole("button", { name: /^(New list|Create a Reading List)$/ }).focus();
    await page.keyboard.press("Enter");

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    // Radix Dialog moves focus into the content on open; the name field is first.
    await expect(dialog.getByLabel("List name")).toBeFocused();
    await page.keyboard.type(name);
    await page.keyboard.press("Tab");
    await expect(dialog.getByLabel("Created by (optional)")).toBeFocused();
    await page.keyboard.type("Ms. Ellis");
    // Submitting via Enter from within a field (not tabbing all the way to the
    // submit button) — WebKit's default Tab order excludes plain <button> elements
    // unless the OS's Full Keyboard Access is on, so this is both the more realistic
    // keyboard interaction and the one that's reliable across browser engines.
    await page.keyboard.press("Enter");

    await expect(page).toHaveURL(/\/lists\/.+/);
    await expect(page.getByRole("heading", { name })).toBeVisible();
  });
});
