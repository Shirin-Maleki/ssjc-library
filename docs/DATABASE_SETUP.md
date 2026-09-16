# Database Setup

Status: Phase 4 — describes what's actually built (a real Postgres/Drizzle data layer), not
future intentions. See `docs/DATA_MODEL.md` for the schema itself and `docs/DECISIONS.md` for
the architectural reasoning behind it.

## What this is, in one paragraph

PostgreSQL is the canonical data store, accessed exclusively through Drizzle ORM
(`drizzle-orm/postgres-js`). Schema changes are committed, reviewable SQL migration files
under `drizzle/`, generated from the TypeScript schema in `src/db/schema/` — never applied by
pointing `drizzle-kit push` at a shared environment. The 48-book fixture catalog
(`src/lib/catalog/fixtures.ts`) is converted into seed data (`src/db/seed.ts`) with stable, hardcoded
UUIDs, so re-seeding never breaks an existing Reading List's references. Three independent
databases exist: one for normal development, one for the Vitest integration suite, and one for
the Playwright E2E suite — each is migrated and seeded automatically by the relevant test
runner; only the development database is something you manage by hand.

## Supabase vs. local Postgres

The intended hosted provider is **Supabase** — plain managed Postgres, with **no** use of
Supabase Auth, Supabase-only Row Level Security as a real security mechanism, or Supabase
Storage for canonical cover images (see `docs/ARCHITECTURE.md` §4 and `docs/SECURITY.md` for
why). Nothing in the schema, queries, or application code is Supabase-specific — every query
goes through standard Drizzle/SQL, so pointing `DATABASE_URL` at any Postgres 14+ connection
string (Supabase, Neon, RDS, a self-hosted instance) works identically.

**This local development environment** runs against a disposable local PostgreSQL 16 instance
instead of a hosted Supabase project, per this phase's own instruction to use whatever's
actually available. If you have Supabase access, setup is:

1. Create a Supabase project.
2. Copy its connection string (Settings → Database) into `DATABASE_URL`.
3. Supabase's default connection is a **pooled (transaction-mode) connection**, which does not
   support the session-level features `drizzle-kit` needs to run migrations. Also copy the
   project's **direct connection string** into `DATABASE_MIGRATION_URL`. If you only ever have
   one connection string available, set both variables to the same value — it'll work for
   everything except migrations against a very large schema change.
4. Everything below (migrate, seed, test) works exactly the same either way.

**To set up local Postgres instead** (macOS/Homebrew shown; adapt for your platform):

```bash
brew install postgresql@16
# Start it directly (more predictable than `brew services` in some shells):
pg_ctl -D /opt/homebrew/var/postgresql@16 -l /tmp/postgres16.log start

createdb ssjc_library_dev
createdb ssjc_library_test
createdb ssjc_library_e2e
```

Local trust-authenticated connection strings look like:
`postgresql://<your-username>@127.0.0.1:5432/ssjc_library_dev`.

## Environment variables

Set these in `.env.local` (never committed — see `.env.example` for the full annotated
template). Names and purpose only; this document never prints real connection strings.

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | The connection the running app uses at request time (development database locally; Supabase in a real deployment). |
| `DATABASE_MIGRATION_URL` | The connection `drizzle-kit`/the migration script uses. Falls back to `DATABASE_URL` when unset — only needs to differ from it against Supabase's pooled connection (see above). |
| `TEST_DATABASE_URL` | A separate database for `npm run test:integration`. Truncated and reseeded automatically before the suite runs — never point this at development or production data. |
| `E2E_DATABASE_URL` | A separate database for the Playwright E2E suite. Also truncated and reseeded automatically on every run. |

Three separate databases exist so the integration-test suite's truncate-then-seed cycle can
never race the E2E suite's, and so neither ever touches your own hand-inspected development
data.

## Commands

| Command | What it does |
|---|---|
| `npm run db:generate` | Reads `src/db/schema/index.ts` and writes a new migration file under `drizzle/` reflecting whatever changed. Review the generated SQL before committing it — this is the only step that touches the schema definition. |
| `npm run db:migrate` | Applies every not-yet-applied migration in `drizzle/` to `DATABASE_MIGRATION_URL` (or `DATABASE_URL`). Safe to run repeatedly — already-applied migrations are tracked and skipped. |
| `npm run db:seed` | Truncates every seeded table and re-inserts the 48-book fixture catalog with its stable UUIDs. Does **not** touch `reading_lists`/`reading_list_items` data you created by hand through the app... actually it does — see "What gets wiped" below. |
| `npm run db:reset` | Runs migrate then seed, in order, against `DATABASE_URL`. The normal way to get a clean development database. |
| `npm run db:check` | Runs `drizzle-kit check` — fails if the committed migrations and the current schema have drifted apart (e.g., someone edited a schema file without regenerating a migration). Good to run before opening a PR. |
| `npm run test:integration` | Runs the real-database repository/migration tests (`tests/integration/`) against `TEST_DATABASE_URL`, migrating and seeding it once per run via a Vitest global setup. |
| `npx playwright test` | Runs the E2E suite, migrating and seeding `E2E_DATABASE_URL` once per run via `tests/e2e/globalSetup.ts`, then building and starting the app against it. |

### What gets wiped by seeding

`db:seed`'s truncate statement resets every table it owns, **including `reading_lists` and
`reading_list_items`**, back to empty — by design, so the seed is fully reproducible and the
integration/E2E suites always start from known state. This means running `npm run db:reset`
against your own development database deletes any Reading Lists you created by hand while
testing the app manually. That's expected for a `reset` command; there is no separate
"seed catalog data only, leave my lists alone" command, since keeping the seed script simple
and fully reproducible was judged more valuable than preserving disposable local test data.

## Inspecting the database directly

```bash
psql postgresql://<user>@127.0.0.1:5432/ssjc_library_dev -c "select count(*) from books;"
psql postgresql://<user>@127.0.0.1:5432/ssjc_library_dev -c "\dt"
```

## Running the database test suites

- **Unit tests** (`npm run test`) never touch a real database — anything DB-shaped is either
  pure logic or (for the repositories) exercised for real only in the integration suite below.
- **Integration tests** (`npm run test:integration`) run Drizzle repository classes and raw
  migration/schema assertions against a genuinely running Postgres instance
  (`TEST_DATABASE_URL`) — nothing about Drizzle or the schema is mocked. This includes a
  two-independent-connection test proving Reading List writes are visible to a completely
  separate client, not just to the connection that wrote them — the actual acceptance
  criterion for "genuinely shared," not just "a repository method returns the right object."
- **E2E tests** (`npx playwright test`) run the full built app against `E2E_DATABASE_URL`.
  `tests/e2e/readingLists.spec.ts` runs on the desktop project only, in serial order (see the
  comment at the top of that file) — Reading Lists are now genuinely shared, persistent data
  across the whole suite, so every list a test creates gets a collision-proof name and every
  assertion is written to hold regardless of what other tests have already created.

## The Phase 5 replacement seam

This phase deliberately stops at `Postgres → BookRepository → Book[] → searchBooks() → Find
UI` — the exact same deterministic ranking Phase 2 built, just reading from a real database
instead of an in-memory fixture array. Semantic search, embeddings, and pgvector are
**entirely out of scope** here: no `embedding` column exists on `books`, no pgvector extension
is enabled, and no placeholder embedding dimension was invented (see `docs/DATA_MODEL.md` §16
and `docs/ARCHITECTURE.md` §13). When Phase 5 adds semantic search, the seam is
`BookRepository` — a new method (or an enhanced `listBooks`) can add embedding-based ranking
without Find, autocomplete, or any component above the repository boundary needing to change.

## Why Reading Lists moved here but auth didn't

Reading Lists became genuinely shared Postgres data this phase (see `docs/DECISIONS.md`,
"Reading Lists: from localStorage to Postgres") because the product concept always described
them as shared, and Phase 3 explicitly built them behind a repository interface for exactly
this swap. Staff/admin authentication deliberately did **not** change — there is still no
Supabase Auth, no individual accounts, and no real Row Level Security. Access to the database
is entirely server-mediated: every Server Action independently calls `requireStaffSession()`
before touching a repository, and the browser never holds database credentials or a direct
connection — see `docs/SECURITY.md` for the full boundary.
