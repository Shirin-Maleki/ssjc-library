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

  test("a confirmed identity with a trustworthy provider thumbnail saves and renders a real display cover in Find (Phase 7 correction pass §2)", async ({
    page,
  }) => {
    await uploadCover(page, "new-book-displaycover-test.png");
    const confirmHeading = page.getByRole("heading", { name: /New Book Displaycover Test/ });
    await expect(confirmHeading).toBeVisible({ timeout: 15000 });
    // The fixture title embeds a fresh randomUUID() (e2eFixtures.ts) — captured here
    // so the later Find search matches only THIS run's book, never another
    // desktop/mobile project's run of the same test sharing the one E2E database.
    const fullTitle = (await confirmHeading.textContent())!.trim();

    await page.getByRole("button", { name: "Quick edit" }).click();
    await page.getByLabel("Physical category").selectOption({ label: "Stories & Imagination" });
    await page.getByRole("button", { name: "Confirm / Add book" }).click();
    await expect(page.getByText("Added to SSJC Library")).toBeVisible({ timeout: 15000 });

    await page.goto("/find");
    await page.getByRole("combobox").fill(fullTitle);
    await page.keyboard.press("Enter");
    const resultHeading = page.getByRole("heading", { level: 3, name: fullTitle, exact: true });
    await expect(resultHeading).toBeVisible();

    const resultCard = resultHeading.locator("xpath=ancestor::*[self::li or self::article][1]");
    const coverImg = resultCard.locator("img");
    await expect(coverImg).toBeVisible();
    await expect(coverImg).toHaveAttribute("src", "https://covers.openlibrary.org/b/id/8225631-M.jpg");
  });

  test("saving without a category shows a real, visible error rather than doing nothing", async ({ page }) => {
    await uploadCover(page, "new-book-no-category-test.png");
    await expect(page.getByRole("heading", { name: /New Book No Category Test/ })).toBeVisible({ timeout: 15000 });

    await page.getByRole("button", { name: "Confirm / Add book" }).click();
    await expect(page.getByText(/A shelving category is needed/i)).toBeVisible({ timeout: 15000 });
  });

  test("exact duplicate: a cover matching a real seeded book offers Add another copy, not a second catalog entry", async ({ page }) => {
    // The "gruffalo" fixture evidence (e2eFixtures.ts) includes the real seeded
    // book's actual ISBN (9780333710937) — this deliberately exercises the ONLY
    // path that may classify as exact_copy_same_edition (Phase 7 correction pass
    // §3: title+author+language alone is never sufficient for that claim).
    await uploadCover(page, "gruffalo-cover-photo.png");

    await expect(page.getByText("This book is already in the library.")).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("Add another copy?")).toBeVisible();
    await expect(page.getByText("The Gruffalo", { exact: true }).first()).toBeVisible();

    await page.getByRole("button", { name: "Add another copy" }).click();

    await expect(page.getByText("Another copy was added.")).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("The Gruffalo")).toBeVisible();
  });

  test("ambiguous duplicate: Different book shows the real captured title (never a filename) and proceeds without re-identifying (Phase 7 correction pass §3/§4)", async ({
    page,
  }) => {
    await uploadCover(page, "similartitle-test.png");

    await expect(page.getByText("Is this the same book?")).toBeVisible({ timeout: 15000 });
    // The comparison must show the real identified title, never the raw uploaded
    // filename (e.g. "similartitle-test.png") — §4 of the correction pass.
    await expect(page.getByText(/You photographed: .*The Gruffalo/)).toBeVisible();
    await expect(page.getByText(/similartitle-test\.png/)).toHaveCount(0);

    await page.getByRole("button", { name: "Different book" }).click();

    // Proceeds straight to confirmation with the same evidence already gathered —
    // never a repeated "Identifying book…"/"Finding book details…" round trip.
    await expect(page.getByRole("heading", { name: "The Gruffalo" })).toBeVisible({ timeout: 15000 });

    await page.getByRole("button", { name: "Quick edit" }).click();
    await page.getByLabel("Physical category").selectOption({ label: "Stories & Imagination" });
    await page.getByRole("button", { name: "Confirm / Add book" }).click();
    await expect(page.getByText("Added to SSJC Library")).toBeVisible({ timeout: 15000 });
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

  test("rotate control: repeated taps visibly rotate the selected-cover preview before upload (real-cover correction pass §6)", async ({ page }) => {
    await page.goto("/add");
    await page.locator('input[type="file"]').setInputFiles({ name: "rotate-control-test.png", mimeType: "image/png", buffer: tinySyntheticPng() });
    await expect(page.getByText("Photo selected")).toBeVisible();

    const preview = page.getByAltText("Selected book cover preview");
    const initialTransform = await preview.evaluate((el) => getComputedStyle(el).transform);

    await page.getByRole("button", { name: "Rotate 90°" }).click();
    await expect(async () => {
      const rotated = await preview.evaluate((el) => getComputedStyle(el).transform);
      expect(rotated).not.toBe(initialTransform);
    }).toPass();

    // 4 taps returns to the original (unrotated) transform — proves increments of
    // exactly 90 degrees, not an open-ended/unbounded rotation.
    await page.getByRole("button", { name: "Rotate 90°" }).click();
    await page.getByRole("button", { name: "Rotate 90°" }).click();
    await page.getByRole("button", { name: "Rotate 90°" }).click();
    await expect(async () => {
      const backToStart = await preview.evaluate((el) => getComputedStyle(el).transform);
      expect(backToStart).toBe(initialTransform);
    }).toPass();
  });

  test("identification failure (no usable title): shows explicit recovery UI, never a silently-empty confirmation (real-cover correction pass §5/§8)", async ({
    page,
  }) => {
    await uploadCover(page, "unreadable-cover-test.png");

    await expect(page.getByText("We couldn’t read this cover clearly.")).toBeVisible({ timeout: 15000 });
    // Never expose provider/technical language to the teacher.
    await expect(page.getByText(/gemini|vision_failed|rate_limited/i)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Try again with this photo" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Rotate 90°" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Choose a different photo" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue and enter the details myself" })).toBeVisible();
  });

  test("retry after identification failure re-runs identify on the SAME already-uploaded source — no re-upload dialog, still deterministic (real-cover correction pass §8)", async ({
    page,
  }) => {
    await uploadCover(page, "unreadable-cover-test.png");
    await expect(page.getByText("We couldn’t read this cover clearly.")).toBeVisible({ timeout: 15000 });

    await page.getByRole("button", { name: "Try again with this photo" }).click();

    // Lands back on the same recovery screen (the fixture is deterministic — the
    // filename never changes on retry) without ever re-showing the file picker or
    // an upload-progress screen, proving no re-upload occurred.
    await expect(page.getByText("We couldn’t read this cover clearly.")).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("Take or choose a photo")).toHaveCount(0);
  });

  test("continuing with the manual fallback after an identification failure reaches confirmation, never proceeding blindly with a pointless lookup (real-cover correction pass §5)", async ({
    page,
  }) => {
    await uploadCover(page, "unreadable-cover-test.png");
    await expect(page.getByText("We couldn’t read this cover clearly.")).toBeVisible({ timeout: 15000 });

    await page.getByRole("button", { name: "Continue and enter the details myself" }).click();

    await expect(page.getByRole("heading", { name: "Untitled" })).toBeVisible({ timeout: 15000 });
    await page.getByRole("button", { name: "Quick edit" }).click();
    await page.getByLabel("Title").fill("A Book The Teacher Typed In By Hand");
    await page.getByLabel("Language").selectOption({ label: "English" });
    await page.getByLabel("Physical category").selectOption({ label: "Stories & Imagination" });
    await page.getByRole("button", { name: "Confirm / Add book" }).click();
    await expect(page.getByText("Added to SSJC Library")).toBeVisible({ timeout: 15000 });
  });
});
