import { defineConfig, devices } from "@playwright/test";
import bcrypt from "bcryptjs";

// Fixture credentials for E2E only — never real secrets, computed at config-load time
// so nothing sensitive is ever written to a file.
export const E2E_STAFF_PASSWORD = "phase1-e2e-staff-password";
export const E2E_ADMIN_PASSWORD = "phase1-e2e-admin-password";

export default defineConfig({
  testDir: "./tests/e2e",
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
      STAFF_PASSWORD_HASH: bcrypt.hashSync(E2E_STAFF_PASSWORD, 10),
      ADMIN_PASSWORD_HASH: bcrypt.hashSync(E2E_ADMIN_PASSWORD, 10),
      SESSION_SECRET: "playwright-e2e-fixture-session-secret-not-a-real-secret",
      // This suite runs over plain HTTP — see the comment on sessionCookieOptions().
      SESSION_COOKIE_SECURE: "false",
    },
  },
});
