import { execFileSync } from "node:child_process";

/**
 * Runs once before the whole integration suite (not per-file) — migrates then seeds
 * `TEST_DATABASE_URL` exactly once, so individual test files can create/mutate
 * Reading Lists freely without stepping on each other's baseline catalog data.
 * Skipped entirely (not a failure) when no test database is configured — each test
 * file's own `requireTestDatabaseUrl()` reports the real reason tests didn't run.
 */
export default async function setup() {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // No .env.local — fine, assume the environment already has what's needed.
  }

  const testDatabaseUrl = process.env.TEST_DATABASE_URL;
  if (!testDatabaseUrl) {
    console.warn(
      "\n[integration tests] TEST_DATABASE_URL is not set — every test in this run will report itself skipped. See docs/DATABASE_SETUP.md.\n"
    );
    return;
  }

  const env = { ...process.env, DATABASE_URL: testDatabaseUrl, DATABASE_MIGRATION_URL: testDatabaseUrl };
  const run = (script: string) => execFileSync(process.execPath, ["--import", "tsx", script], { env, stdio: "inherit" });

  run("src/db/migrate.ts");
  run("src/db/seed.ts");
}
