import { test, expect } from "@playwright/test";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import * as schema from "../../src/db/schema";
import { loginAsStaff } from "./helpers";

/**
 * Phase 9 — both Teacher Catalog scenarios (no Sheet configured yet / a real
 * Sheet target configured) live in ONE file, in one `test.describe` block, run
 * in strict declaration order (Playwright's default within a single describe
 * block — never `.parallel()`). `system_settings` is genuinely shared,
 * persistent Postgres data across the whole E2E run (exactly like Reading
 * Lists, `docs/DECISIONS.md`), and Playwright can schedule SEPARATE spec files
 * on different workers concurrently — putting both scenarios in one
 * sequentially-ordered file (rather than splitting the "not configured" half
 * into `navigation.spec.ts`) is what actually eliminates the race, not just
 * reduces its window. Runs on desktop only (see `playwright.config.ts`'s
 * `testIgnore`) for the same reason `readingLists.spec.ts` does — this is
 * viewport-independent coverage of genuinely shared state.
 */

function connectE2EDatabase() {
  const url = process.env.E2E_DATABASE_URL;
  if (!url) throw new Error("E2E_DATABASE_URL must be set.");
  const client = postgres(url, { max: 1 });
  return { db: drizzle(client, { schema }), client };
}

const SETTINGS_KEY = "google_sheets_catalog_target";

test.describe.serial("Teacher Catalog (Phase 9)", () => {
  const { db, client } = connectE2EDatabase();

  test.afterAll(async () => {
    await db.delete(schema.systemSettings).where(eq(schema.systemSettings.key, SETTINGS_KEY));
    await client.end();
  });

  test("shows a calm not-yet-configured state, not a broken page, when no Sheet target exists", async ({ page }) => {
    // Explicit precondition, never assumed: this is the FIRST test in this
    // serial block, but defensively clears the row anyway in case a previous
    // run of this same file crashed before its own `afterAll` ran.
    await db.delete(schema.systemSettings).where(eq(schema.systemSettings.key, SETTINGS_KEY));

    await loginAsStaff(page);
    await page.getByRole("link", { name: "Teacher Catalog" }).click();
    await expect(page).toHaveURL("/teacher-catalog");
    await expect(page.getByRole("heading", { name: "Teacher Catalog" })).toBeVisible();
    await expect(page.getByText(/hasn.t been set up in this environment yet/)).toBeVisible();
  });

  test("opens a real link to the configured Sheet and explains it's a reference view", async ({ page }) => {
    const value = { spreadsheetId: "e2e-fake-sheet-id", sheetId: 1, url: "https://docs.google.com/spreadsheets/d/e2e-fake-sheet-id", createdAt: new Date().toISOString() };
    await db.insert(schema.systemSettings).values({ key: SETTINGS_KEY, value }).onConflictDoUpdate({ target: schema.systemSettings.key, set: { value } });

    await loginAsStaff(page);
    await page.getByRole("link", { name: "Teacher Catalog" }).click();
    await expect(page).toHaveURL("/teacher-catalog");
    await expect(page.getByText(/reference view of the catalog in Google Sheets/i)).toBeVisible();
    const link = page.getByRole("link", { name: "Open teacher catalog" });
    await expect(link).toHaveAttribute("href", "https://docs.google.com/spreadsheets/d/e2e-fake-sheet-id");
    await expect(link).toHaveAttribute("target", "_blank");
  });
});
