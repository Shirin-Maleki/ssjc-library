import "../../src/db/loadEnv";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "../../src/db/schema";
import { setDatabaseProtection, getDatabaseProtection, databaseNameFromConnectionString } from "../../src/db/dbSafety";

/**
 * `npm run db:unprotect` — the deliberate opposite of `npm run db:protect`.
 * Removes the guard, allowing `npm run db:seed`/`db:reset` to run against
 * whatever `DATABASE_URL` points at exactly as they did before Phase 9's
 * data-safety correction. Never run automatically by anything in this
 * repository.
 */
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");

  const client = postgres(url, { max: 1 });
  const db = drizzle(client, { schema });
  try {
    const before = await getDatabaseProtection(db);
    if (!before.protected) {
      console.log(`Database "${databaseNameFromConnectionString(url)}" was not protected — nothing to do.`);
      return;
    }
    await setDatabaseProtection(db, false);
    console.log(`Database "${databaseNameFromConnectionString(url)}" is now UNPROTECTED — npm run db:seed/db:reset will run against it normally.`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
