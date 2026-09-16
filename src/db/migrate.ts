import "./loadEnv";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

/**
 * Standalone migration runner (`npm run db:migrate`) — deliberately not the app's own
 * `src/db/client.ts` (that one is `server-only` and expects to run inside Next.js).
 * Always runs against `DATABASE_MIGRATION_URL` (a direct/session connection — a
 * transaction-mode pooler such as Supabase's port-6543 URL cannot run DDL). See
 * docs/DATABASE_SETUP.md.
 */
async function main() {
  const connectionString = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_MIGRATION_URL (or DATABASE_URL) must be set. See docs/DATABASE_SETUP.md.");
  }

  const migrationClient = postgres(connectionString, { max: 1 });
  const db = drizzle(migrationClient);

  console.log("Running migrations...");
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("Migrations complete.");

  await migrationClient.end();
}

main().catch((error) => {
  console.error("Migration failed:", error);
  process.exit(1);
});
