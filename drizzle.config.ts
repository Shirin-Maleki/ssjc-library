import { defineConfig } from "drizzle-kit";
import "./src/db/loadEnv";

// Migrations always run against DATABASE_MIGRATION_URL (a direct/session connection —
// required when the runtime DATABASE_URL is a transaction-mode pooler, e.g. Supabase's
// port-6543 pooler, which cannot run DDL). See docs/DATABASE_SETUP.md.
const connectionString = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "DATABASE_MIGRATION_URL (or DATABASE_URL) must be set to run drizzle-kit. See docs/DATABASE_SETUP.md."
  );
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dbCredentials: {
    url: connectionString,
  },
  strict: true,
  verbose: true,
});
