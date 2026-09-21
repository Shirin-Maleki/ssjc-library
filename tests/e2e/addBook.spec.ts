import { test, expect } from "@playwright/test";
import { loginAsStaff, tinySyntheticPng } from "./helpers";

/**
 * Phase 7 Add-a-Book E2E coverage (§49 of the phase brief). Runs entirely against
 * deterministic fixtures — `playwright.config.ts`'s `webServer.env` sets
 * `E2E_FAKE_INTAKE_PROVIDERS=true`, which makes the upload route and cover-
 * identification action skip Drive/Gemini entirely (see
 * `src/lib/intake/e2eFixtures.ts`), and blanks `GEMINI_API_KEY`/
 * `GOOGLE_BOOKS_API_KEY` so enrichment/metadata-lookup gracefully degrade to their
 * real "unconfigured" behavior instead of ever calling a live API. The uploaded
 * filename selects the fixture scenario: a name containing "gruffalo" produces
 * evidence matching the real seeded "The Gruffalo" fixture book exactly (for the
 * duplicate-detection path, against the real seeded catalog); any other name
 * produces a unique, never-seeded title (for the new-book path). Unauthenticated
 * access to /add is already covered by `auth.spec.ts`'s
 * "each staff destination requires a session" test — not repeated here.
 */

async function uploadCover(page: import("@playwright/test").Page, filename: string) {
  await page.goto("/add");
  await expect(page.getByRole("heading", { name: "Add a Book" })).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles({ name: filename, mimeType: "image/png", buffer: tinySyntheticPng() });
  await expect(page.getByText("Photo selected")).toBeVisible();
  await page.getByRole("button", { name: "Use this cover" }).click();
}

test.describe("Add a Book", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsStaff(page);
  });

  test("cover capture: selecting a file shows a preview before any upload, and Change photo returns to the picker", async ({ page }) => {
    await page.goto("/add");
    await page.locator('input[type="file"]').setInputFiles({ name: "new-book-preview-test.png", mimeType: "image/png", buffer: tinySyntheticPng() });
    await expect(page.getByText("Photo selected")).toBeVisible();
    await expect(page.getByRole("button", { name: "Use this cover" })).toBeVisible();

    await page.getByRole("button", { name: "Change photo" }).click();
    await expect(page.getByText("Take or choose a photo")).toBeVisible();
  });

  test("new book: uploads, reaches confirmation, and saves after a required Quick Edit category selection (no AI configured in E2E)", async ({
    page,
  }) => {
    await uploadCover(page, "new-book-happy-path.png");

    // The processing stages (ProcessingStatus.tsx) are real, not a decorative
    // stepper — covered by the component/unit tests. With every provider faked,
    // the whole pipeline can complete in milliseconds, so asserting on catching one
    // mid-flight here would be flaky; the eventual confirm screen below already
    // proves every step ran.
    await expect(page.getByRole("heading", { name: /New Book Happy Path/ })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("E2E Fixture Author")).toBeVisible();

    // No category was AI-suggested (GEMINI_API_KEY is blanked for E2E) — a real
    // teacher must pick one via Quick Edit before this book can be shelved.
    await page.getByRole("button", { name: "Quick edit" }).click();
    await page.getByLabel("Physical category").selectOption({ label: "Stories & Imagination" });
    await page.getByRole("button", { name: "Confirm / Add book" }).click();

    await expect(page.getByText("Added to SSJC Library")).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/New Book Happy Path/)).toBeVisible();
    await expect(page.getByText("Stories & Imagination")).toBeVisible();
  });

  test("saving without a category shows a real, visible error rather than doing nothing", async ({ page }) => {
    await uploadCover(page, "new-book-no-category-test.png");
    await expect(page.getByRole("heading", { name: /New Book No Category Test/ })).toBeVisible({ timeout: 15000 });

    await page.getByRole("button", { name: "Confirm / Add book" }).click();
    await expect(page.getByText(/A shelving category is needed/i)).toBeVisible({ timeout: 15000 });
  });

  test("exact duplicate: a cover matching a real seeded book offers Add another copy, not a second catalog entry", async ({ page }) => {
    await uploadCover(page, "gruffalo-cover-photo.png");

    await expect(page.getByText("This book is already in the library.")).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("Add another copy?")).toBeVisible();
    await expect(page.getByText("The Gruffalo", { exact: true }).first()).toBeVisible();

    await page.getByRole("button", { name: "Add another copy" }).click();

    await expect(page.getByText("Another copy was added.")).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("The Gruffalo")).toBeVisible();
  });

  test("Review later: preserves the intake instead of forcing an incomplete save", async ({ page }) => {
    await uploadCover(page, "review-later-test.png");
    await expect(page.getByRole("heading", { name: /Review Later Test/ })).toBeVisible({ timeout: 15000 });

    await page.getByRole("button", { name: "Review later" }).click();

    await expect(page.getByText("Saved for later")).toBeVisible();
    await expect(page.getByRole("button", { name: "Add another book" })).toBeVisible();
  });

  test("an unsupported file type is rejected before any upload begins", async ({ page }) => {
    await page.goto("/add");
    await page.locator('input[type="file"]').setInputFiles({ name: "document.pdf", mimeType: "application/pdf", buffer: Buffer.from("not an image") });
    await expect(page.locator('p[role="alert"]')).toContainText(/JPEG, PNG, WebP, HEIC, or HEIF/);
    await expect(page.getByText("Photo selected")).toHaveCount(0);
  });
});
