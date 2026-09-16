import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * The one place a Postgres connection is created — `import "server-only"` makes any
 * accidental import from a Client Component a build-time error, not just a lint
 * warning (Phase 4 brief §6/§41: "no direct Drizzle/Postgres import from client
 * components"). No component should import this file directly; go through
 * `src/db/repositories/*` instead.
 *
 * `postgres.js` connects lazily — creating this client does not open a TCP connection
 * by itself, so importing this module (e.g. during `next build`'s route analysis)
 * never requires a reachable database. A connection is only attempted once a query
 * actually runs.
 */
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "DATABASE_URL is not set. Phase 4 requires a configured Postgres database — see docs/DATABASE_SETUP.md."
  );
}

const queryClient = postgres(connectionString, {
  // Supabase's pooled connection (the expected DATABASE_URL in production) does not
  // support prepared statements — disabling them here is correct for both that case
  // and a plain local/direct Postgres connection.
  prepare: false,
});

export const db = drizzle(queryClient, { schema });

export type Database = typeof db;
