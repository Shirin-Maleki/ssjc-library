import { eq } from "drizzle-orm";
import type { Database } from "./client";
import { systemSettings } from "./schema";

/**
 * The one executable guard against ever truncating a database that holds
 * real, non-fixture data (Phase 9 data-safety correction) — see
 * `docs/DATABASE_SETUP.md`'s "Database safety boundary" section for the full
 * incident this exists to prevent: verifying the Phase 9 addendum's new
 * schema locally involved running `npm run db:seed` directly against
 * `DATABASE_URL`, which is simultaneously "the database the running app
 * uses," "the database `npm run import:*` writes real bulk-imported books
 * to," and "whatever `db:seed`/`db:reset` truncate unconditionally" — three
 * roles that had never been in conflict before Phase 9 gave the second one
 * real data worth protecting. `TEST_DATABASE_URL`/`E2E_DATABASE_URL` were
 * never at risk (separate database names, confirmed in `docs/DATABASE_SETUP.md`);
 * this closes the one remaining path: a direct, manual `db:seed`/`db:reset`
 * invocation against a database that also holds real data.
 *
 * A database is "protected" only when something EXPLICITLY marked it so
 * (`npm run db:protect`) — never inferred from its name, its connection
 * string, or which env var happened to point at it. An unprotected database
 * (every disposable `TEST_DATABASE_URL`/`E2E_DATABASE_URL` target, and any
 * `DATABASE_URL` nobody has protected yet) seeds exactly as it always has,
 * with zero behavior change — this is additive safety, not a new hoop for
 * ordinary local development.
 */

const PROTECTION_KEY = "database_protected";

export interface DatabaseProtectionState {
  protected: boolean;
  reason?: string;
  protectedAt?: string;
}

/** Reads the protection flag. Treats a database with no `system_settings`
 * table yet (a genuinely brand-new database, before the first migration has
 * ever run) as unprotected — never a reason to block an initial `db:reset`
 * on a database that cannot possibly hold anything yet. */
export async function getDatabaseProtection(db: Database): Promise<DatabaseProtectionState> {
  try {
    const [row] = await db.select({ value: systemSettings.value }).from(systemSettings).where(eq(systemSettings.key, PROTECTION_KEY)).limit(1);
    if (!row) return { protected: false };
    const value = row.value as { protected?: boolean; reason?: string; protectedAt?: string } | null;
    return { protected: value?.protected === true, reason: value?.reason, protectedAt: value?.protectedAt };
  } catch {
    return { protected: false };
  }
}

/** Never guessed from the connection string's host/user — only its real
 * database name (the path component), the one thing an operator both knows
 * and can be asked to type back as proof of intent. */
export function databaseNameFromConnectionString(connectionString: string): string {
  try {
    return new URL(connectionString).pathname.replace(/^\//, "");
  } catch {
    return "";
  }
}

export class DatabaseProtectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatabaseProtectedError";
  }
}

/**
 * Throws `DatabaseProtectedError` (never a raw/ambiguous error) when the
 * target database is protected and no valid override was given. The
 * override, `ALLOW_DESTRUCTIVE_RESEED`, must equal the EXACT database name
 * being targeted — not merely `"true"`/`"1"` — so bypassing protection
 * requires an operator to positively know and type the real database name,
 * never a boolean flag that could be left set out of habit (§3: "If an
 * override is supported, make it difficult to invoke accidentally").
 */
export async function assertSafeToDestroy(db: Database, connectionString: string): Promise<void> {
  const state = await getDatabaseProtection(db);
  if (!state.protected) return;

  const dbName = databaseNameFromConnectionString(connectionString);
  const override = process.env.ALLOW_DESTRUCTIVE_RESEED;
  if (override && dbName && override === dbName) return;

  throw new DatabaseProtectedError(
    `Refusing to run a destructive reseed against a PROTECTED database ("${dbName || "unknown"}").\n` +
      `Reason it was protected: ${state.reason ?? "(not recorded)"}\n` +
      `Protected at: ${state.protectedAt ?? "(not recorded)"}\n\n` +
      `This database holds real, non-fixture data. If you are certain you want to permanently erase ` +
      `it, re-run with ALLOW_DESTRUCTIVE_RESEED=${dbName || "<database-name>"} set (the exact database ` +
      `name, never merely "true"). Protection is automatically cleared by a successful override-authorized ` +
      `reseed — the real data it protected is gone — so re-protect explicitly afterward with ` +
      `"npm run db:protect" if this database will hold real data again.`
  );
}

/** `npm run db:protect` / `npm run db:unprotect` — the one deliberate,
 * explicit action that starts or stops a database being covered by
 * `assertSafeToDestroy`. Never automatic, never inferred. */
export async function setDatabaseProtection(db: Database, isProtected: boolean, reason?: string): Promise<void> {
  if (!isProtected) {
    await db.delete(systemSettings).where(eq(systemSettings.key, PROTECTION_KEY));
    return;
  }
  const value = { protected: true, reason: reason ?? "Marked protected via npm run db:protect.", protectedAt: new Date().toISOString() };
  await db
    .insert(systemSettings)
    .values({
      key: PROTECTION_KEY,
      value,
      description: "Phase 9 data-safety correction — when protected: true, npm run db:seed/db:reset refuse to run against this database without an explicit ALLOW_DESTRUCTIVE_RESEED override. See docs/DATABASE_SETUP.md.",
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({ target: systemSettings.key, set: { value, updatedAt: new Date() } });
}
