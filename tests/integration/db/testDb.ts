import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";

/** A dedicated connection to `TEST_DATABASE_URL` — deliberately never
 * `src/db/client.ts` (that one reads `DATABASE_URL` and is `server-only`, meant for
 * the running app, not a test process). Every integration test file should call
 * `requireTestDatabaseUrl()` first and skip itself (not fail) when it throws. */
export function requireTestDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      "TEST_DATABASE_URL is not set — see docs/DATABASE_SETUP.md for how to create a local test database."
    );
  }
  return url;
}

export function createTestDb() {
  const client = postgres(requireTestDatabaseUrl(), { max: 1 });
  const db = drizzle(client, { schema });
  return { db, client };
}
