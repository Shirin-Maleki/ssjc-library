import { execFileSync } from "node:child_process";

/**
 * Migrates and seeds a dedicated E2E database once before the whole Playwright run
 * (a separate database from dev/`TEST_DATABASE_URL`, so E2E runs never race the
 * integration-test suite's own truncate-then-seed). The built server Playwright
 * starts (`webServer` below) points `DATABASE_URL` at this same database.
 */
export default async function globalSetup() {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // No .env.local — fine, assume E2E_DATABASE_URL is already in the environment.
  }

  const e2eDatabaseUrl = process.env.E2E_DATABASE_URL;
  if (!e2eDatabaseUrl) {
    throw new Error("E2E_DATABASE_URL must be set to run the E2E suite. See docs/DATABASE_SETUP.md.");
  }

  const env = { ...process.env, DATABASE_URL: e2eDatabaseUrl, DATABASE_MIGRATION_URL: e2eDatabaseUrl };
  const run = (script: string) => execFileSync(process.execPath, ["--import", "tsx", script], { env, stdio: "inherit" });

  run("src/db/migrate.ts");
  run("src/db/seed.ts");
}
