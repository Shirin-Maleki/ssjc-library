import { defineConfig, devices } from "@playwright/test";
import bcrypt from "bcryptjs";

try {
  process.loadEnvFile(".env.local");
} catch {
  // No .env.local — fine, assume E2E_DATABASE_URL is already in the environment.
}

// Fixture credentials for E2E only — never real secrets, computed at config-load time
// so nothing sensitive is ever written to a file.
export const E2E_STAFF_PASSWORD = "phase1-e2e-staff-password";
export const E2E_ADMIN_PASSWORD = "phase1-e2e-admin-password";

const E2E_DATABASE_URL = process.env.E2E_DATABASE_URL;
if (!E2E_DATABASE_URL) {
  throw new Error("E2E_DATABASE_URL must be set to run the E2E suite (Phase 4). See docs/DATABASE_SETUP.md.");
}

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/globalSetup.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"]],
  use: {
    // WebKit treats a Secure cookie on 127.0.0.1 differently than on localhost
    // (only the latter is reliably treated as a trustworthy origin without HTTPS),
    // which silently dropped our session cookie under the mobile/WebKit project.
    baseURL: "http://localhost:3100",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "mobile",
      use: { ...devices["iPhone 13"] },
      // Reading Lists are genuinely shared, persistent Postgres data as of Phase 4
      // (docs/DECISIONS.md) — running readingLists.spec.ts under two projects would
      // mean two concurrent workers mutating the same shared list data at once. Its
      // CRUD/idempotency coverage is viewport-independent, so it runs on desktop only
      // (see tests/e2e/readingLists.spec.ts for the serial-mode reasoning).
      testIgnore: ["**/readingLists.spec.ts"],
    },
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: {
    command: "npm run build && npm run start -- --port 3100",
    url: "http://localhost:3100",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      // Escaped ("$" -> "\$") for the same reason scripts/hash-password.mjs escapes
      // its output: whenever a .env.local file exists anywhere in the project (even
      // one with unrelated content, e.g. a developer's own local credentials), Next.js
      // runs its dotenv-expand pass over the *entire* process environment — not just
      // values it read from a file — treating "$word" as a variable reference to
      // expand. An unescaped bcrypt hash passed here gets silently mangled the exact
      // same way an unescaped one pasted into .env.local does. Verified directly
      // against a real server: this suite passes with .env.local absent and an
      // unescaped hash, and fails the same way with .env.local present — escaping
      // fixes both. See docs/SECURITY.md.
      STAFF_PASSWORD_HASH: bcrypt.hashSync(E2E_STAFF_PASSWORD, 10).replaceAll("$", "\\$"),
      ADMIN_PASSWORD_HASH: bcrypt.hashSync(E2E_ADMIN_PASSWORD, 10).replaceAll("$", "\\$"),
      SESSION_SECRET: "playwright-e2e-fixture-session-secret-not-a-real-secret",
      // This suite runs over plain HTTP — see the comment on sessionCookieOptions().
      SESSION_COOKIE_SECURE: "false",
      // Phase 4: the built server under test reads real catalog/Reading List data from
      // Postgres — `globalSetup` above migrates and seeds this exact database once
      // before the run.
      DATABASE_URL: E2E_DATABASE_URL,
    },
  },
});
