import { test, expect } from "@playwright/test";
import { loginAsStaff, tinySyntheticPng } from "./helpers";

/**
 * Move/Return workflow E2E coverage (Phase 9 addendum) — this file covers only
 * the side-effect-free "no match" path, safe to run on every Playwright
 * project concurrently (it never touches shared seeded `book_copies` state).
 * The real-move-against-shared-copies scenario lives in its own,
 * desktop-only, serially-ordered file (`moveBookLocation.spec.ts`) for the
 * exact same cross-project/cross-file race reason `teacherCatalog.spec.ts`
 * and `readingLists.spec.ts` are — see that file's own doc comment.
 *
 * Runs under the same `E2E_FAKE_INTAKE_PROVIDERS=true` fixture seam Add
 * Book's own E2E suite uses (`src/lib/intake/e2eFixtures.ts`): the uploaded
 * filename selects the fixture vision result, never a live Gemini call.
 */

async function uploadMovePhoto(page: import("@playwright/test").Page, filename: string) {
  await page.goto("/move");
  await expect(page.getByRole("heading", { name: "Move a Book" })).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles({ name: filename, mimeType: "image/png", buffer: tinySyntheticPng() });
  await expect(page.getByText("Photo selected")).toBeVisible();
  await page.getByRole("button", { name: "Use this cover" }).click();
}

test.describe("Move a Book — no match", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsStaff(page);
  });

  test("an unrecognizable cover shows a calm no-match state, never a fabricated match", async ({ page }) => {
    await uploadMovePhoto(page, "unreadable-move-test.png");
    await expect(page.getByText(/couldn.t match this photo to a book in the catalog/)).toBeVisible({ timeout: 15000 });
    await page.getByRole("button", { name: "Try a different photo" }).click();
    await expect(page.getByRole("heading", { name: "Move a Book" })).toBeVisible();
  });
});
