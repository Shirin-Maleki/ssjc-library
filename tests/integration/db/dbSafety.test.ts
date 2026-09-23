import { afterAll, afterEach, describe, expect, it } from "vitest";
import { getDatabaseProtection, setDatabaseProtection, assertSafeToDestroy, databaseNameFromConnectionString, DatabaseProtectedError } from "@/db/dbSafety";
import { requireTestDatabaseUrl, createTestDb } from "./testDb";

const hasTestDb = (() => {
  try {
    requireTestDatabaseUrl();
    return true;
  } catch {
    return false;
  }
})();

/**
 * Phase 9 data-safety correction — regression coverage for the one
 * executable guard against ever truncating a database that holds real,
 * non-fixture data. Exercises `assertSafeToDestroy`/`getDatabaseProtection`/
 * `setDatabaseProtection` directly against the real `TEST_DATABASE_URL`
 * connection — never by actually invoking `npm run db:seed`'s real truncate,
 * which would be destructive to the shared baseline data every other
 * integration test in this run depends on. Every test here restores
 * TEST_DATABASE_URL to its normal, unprotected state in `afterEach`, exactly
 * as `db:seed`/`db:reset` expect it to be for the rest of the suite.
 */
describe.skipIf(!hasTestDb)("Phase 9 data-safety correction — database protection guard (against a real Postgres database)", () => {
  const { db, client } = hasTestDb ? createTestDb() : ({} as ReturnType<typeof createTestDb>);
  const testDatabaseUrl = hasTestDb ? requireTestDatabaseUrl() : "";
  const realDbName = databaseNameFromConnectionString(testDatabaseUrl);

  afterEach(async () => {
    await setDatabaseProtection(db, false);
    delete process.env.ALLOW_DESTRUCTIVE_RESEED;
  });

  afterAll(async () => {
    if (hasTestDb) await client.end();
  });

  it("an unprotected database (the normal state) is always safe to destroy — zero behavior change", async () => {
    const state = await getDatabaseProtection(db);
    expect(state.protected).toBe(false);
    await expect(assertSafeToDestroy(db, testDatabaseUrl)).resolves.toBeUndefined();
  });

  it("db:protect marks a database protected, and a destroy attempt with no override is refused", async () => {
    await setDatabaseProtection(db, true, "real Phase 9 validation data");
    const state = await getDatabaseProtection(db);
    expect(state.protected).toBe(true);
    expect(state.reason).toBe("real Phase 9 validation data");
    expect(state.protectedAt).toBeTruthy();

    await expect(assertSafeToDestroy(db, testDatabaseUrl)).rejects.toBeInstanceOf(DatabaseProtectedError);
  });

  it("a plain boolean override (\"true\"/\"1\") is never accepted — only the exact database name", async () => {
    await setDatabaseProtection(db, true);
    process.env.ALLOW_DESTRUCTIVE_RESEED = "true";
    await expect(assertSafeToDestroy(db, testDatabaseUrl)).rejects.toBeInstanceOf(DatabaseProtectedError);
    process.env.ALLOW_DESTRUCTIVE_RESEED = "1";
    await expect(assertSafeToDestroy(db, testDatabaseUrl)).rejects.toBeInstanceOf(DatabaseProtectedError);
  });

  it("a wrong database name override is refused, even if it looks plausible", async () => {
    await setDatabaseProtection(db, true);
    process.env.ALLOW_DESTRUCTIVE_RESEED = `${realDbName}_typo`;
    await expect(assertSafeToDestroy(db, testDatabaseUrl)).rejects.toBeInstanceOf(DatabaseProtectedError);
  });

  it("the exact database name as the override authorizes destruction", async () => {
    await setDatabaseProtection(db, true, "real Phase 9 validation data");
    process.env.ALLOW_DESTRUCTIVE_RESEED = realDbName;
    await expect(assertSafeToDestroy(db, testDatabaseUrl)).resolves.toBeUndefined();
  });

  it("db:unprotect (setDatabaseProtection false) removes the guard entirely", async () => {
    await setDatabaseProtection(db, true);
    await setDatabaseProtection(db, false);
    const state = await getDatabaseProtection(db);
    expect(state.protected).toBe(false);
    await expect(assertSafeToDestroy(db, testDatabaseUrl)).resolves.toBeUndefined();
  });

  it("the refusal message names the real database, the recorded reason, and the exact override needed — never a generic error", async () => {
    await setDatabaseProtection(db, true, "contains 3 real bulk-imported validation books");
    try {
      await assertSafeToDestroy(db, testDatabaseUrl);
      throw new Error("expected assertSafeToDestroy to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(DatabaseProtectedError);
      const message = (error as Error).message;
      expect(message).toContain(realDbName);
      expect(message).toContain("contains 3 real bulk-imported validation books");
      expect(message).toContain(`ALLOW_DESTRUCTIVE_RESEED=${realDbName}`);
    }
  });
});
