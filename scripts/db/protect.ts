import "../../src/db/loadEnv";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "../../src/db/schema";
import { setDatabaseProtection, getDatabaseProtection, databaseNameFromConnectionString } from "../../src/db/dbSafety";

/**
 * `npm run db:protect -- --reason="..."` — the one deliberate action that
 * marks whatever `DATABASE_URL` points at as holding real, non-fixture data.
 * From this point on, `npm run db:seed`/`db:reset` refuse to run against it
 * without an explicit `ALLOW_DESTRUCTIVE_RESEED=<exact-db-name>` override.
 * See `src/db/dbSafety.ts` and `docs/DATABASE_SETUP.md`.
 */
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");
  const reason = process.argv.find((a) => a.startsWith("--reason="))?.split("=").slice(1).join("=");

  const client = postgres(url, { max: 1 });
  const db = drizzle(client, { schema });
  try {
    const before = await getDatabaseProtection(db);
    if (before.protected) {
      console.log(`Database "${databaseNameFromConnectionString(url)}" was already protected (reason: ${before.reason ?? "not recorded"}). Updating reason.`);
    }
    await setDatabaseProtection(db, true, reason);
    console.log(`Database "${databaseNameFromConnectionString(url)}" is now PROTECTED.`);
    console.log(`npm run db:seed / npm run db:reset will now refuse to run against it without ALLOW_DESTRUCTIVE_RESEED=<exact-db-name>.`);
    console.log(`Reason recorded: ${reason ?? '(none given — pass --reason="..." to record one)'}`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
