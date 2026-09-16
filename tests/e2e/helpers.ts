import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { E2E_STAFF_PASSWORD } from "../../playwright.config";

export async function loginAsStaff(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Tap to Enter" }).click();
  await page.getByLabel("Staff password", { exact: true }).fill(E2E_STAFF_PASSWORD);
  await page.getByRole("button", { name: "Enter" }).click();
  await expect(page).toHaveURL("/home");
}

/**
 * Reading Lists are genuinely shared Postgres data as of Phase 4 (docs/DECISIONS.md),
 * not per-browser-context `localStorage` — so every list a test creates persists for
 * the rest of the E2E run and is visible to every other test. A collision-proof name
 * keeps `getByRole(..., { name })` locators unambiguous regardless of what other tests
 * (or a previous run's leftovers) have already created.
 */
export function uniqueName(base: string): string {
  return `${base} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * The Reading Lists overview renders one of two mutually exclusive buttons to open the
 * create-list dialog: the large "Create a Reading List" CTA only while the shared list
 * is genuinely empty, and a compact "New list" button once any list exists
 * (`src/components/reading-lists/ReadingListsOverview.tsx`). Most tests don't care
 * which state the shared database happens to be in when they run, so they should open
 * the dialog through whichever one is actually rendered.
 */
export async function openCreateListDialog(page: Page) {
  await page.getByRole("button", { name: /^(New list|Create a Reading List)$/ }).click();
}
