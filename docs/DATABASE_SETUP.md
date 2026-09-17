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
string (Supabase, Neon, RDS, a self-hosted instance) works identically. The application code
itself never branches on which provider it's talking to — the only Supabase-awareness that
exists anywhere is the `postgres.js` client option below.

**This local development environment** runs against a disposable local PostgreSQL 16 instance
instead of a hosted Supabase project, per this phase's own instruction to use whatever's
actually available; the guidance below describes the intended project convention for whenever
real Supabase credentials arrive, not something already connected. Supabase does not offer one
single "default connection" — a project exposes **several**, and which one is correct depends
on how the app is actually deployed:

- **Direct connection** — a normal, session-oriented Postgres connection straight to the
  database. Supports every Postgres feature (prepared statements, `LISTEN`/`NOTIFY`, long-lived
  sessions) but doesn't scale to many short-lived connections, which is exactly the shape a
  serverless deployment (many concurrent function invocations, each opening its own connection)
  produces.
- **Session pooler** — connection-pooled, but each checked-out connection still behaves like a
  full session for the lifetime of that checkout. A reasonable middle ground; still not built
  for the very-high-connection-churn serverless pattern.
- **Transaction pooler** — connection-pooled at the transaction level (a connection is only
  "yours" for a single transaction, then returned to the pool) — the one actually built for
  serverless/edge deployment, but it does **not** support session-level features, prepared
  statements among them.

**The project convention:**

- **`DATABASE_URL`** (the connection the running app uses at request time): for a serverless
  deployment (Vercel, matching this project's intended architecture — `docs/ARCHITECTURE.md`
  §22), use Supabase's **transaction pooler** connection string. Because that pooler doesn't
  support prepared statements, `src/db/client.ts` passes `{ prepare: false }` to `postgres()` —
  this is already unconditional in the code (not an environment-specific toggle), since it's
  also correct and harmless for a direct or session-pooled connection, and for local Postgres.
  **Do not remove `prepare: false`** if the runtime connection is ever pointed at a transaction
  pooler.
- **`DATABASE_MIGRATION_URL`**: migrations (`drizzle-kit generate`/`migrate`) need session-level
  behavior the transaction pooler doesn't provide — point this at Supabase's **direct** or
  **session pooler** connection string instead. Falls back to `DATABASE_URL` when unset, which
  is only correct if `DATABASE_URL` itself is already a direct/session connection (e.g. in this
  local-Postgres environment, where there's only one kind of connection to begin with).
- **Local Postgres** (this environment): there's no pooler distinction at all — one connection
  string does everything, which is why `DATABASE_URL` and `DATABASE_MIGRATION_URL` are
  identical in `.env.local` here.
- **Exact hostnames/ports** for each connection type are shown on the Supabase project's own
  Settings → Database page and vary by project/region — not reproduced here since this document
  isn't a Supabase product manual, only the project's own convention for which one goes where.

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

### pgvector (Phase 5)

Search's optional semantic layer (`docs/SEARCH.md` §5) needs the `vector` extension enabled on
every database (dev/test/e2e), alongside `pg_trgm` (Phase 5 also uses trigram fuzzy matching).
Homebrew's `pgvector` bottle may only target the newest 1–2 PostgreSQL major versions it
supports — if `brew install pgvector` doesn't produce an extension for your installed
PostgreSQL version, build it from source against that version's own `pg_config`:

```bash
git clone --depth 1 --branch v0.8.0 https://github.com/pgvector/pgvector.git
cd pgvector
make PG_CONFIG=/opt/homebrew/opt/postgresql@16/bin/pg_config   # match your installed version
make install
```

The committed migration (`drizzle/0001_mighty_war_machine.sql`) runs
`CREATE EXTENSION IF NOT EXISTS vector;` and `CREATE EXTENSION IF NOT EXISTS pg_trgm;` as its
first two statements — `npm run db:migrate` enables both automatically once the extension files
are installed; nothing needs to be enabled by hand beyond that.

## Environment variables

Set these in `.env.local` (never committed — see `.env.example` for the full annotated
template). Names and purpose only; this document never prints real connection strings.

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | The connection the running app uses at request time (development database locally; Supabase in a real deployment). |
| `DATABASE_MIGRATION_URL` | The connection `drizzle-kit`/the migration script uses. Falls back to `DATABASE_URL` when unset — only needs to differ from it against Supabase's pooled connection (see above). |
| `TEST_DATABASE_URL` | A separate database for `npm run test:integration`. Truncated and reseeded automatically before the suite runs — never point this at development or production data. |
| `E2E_DATABASE_URL` | A separate database for the Playwright E2E suite. Also truncated and reseeded automatically on every run. |
| `GEMINI_API_KEY` (optional, Phase 5) | Activates real semantic retrieval and embedding generation (`gemini-embedding-2`). Unset by default — `getConfiguredEmbeddingProvider()` returns `undefined` (never throws), and conventional search (structured filters + exact/FTS/trigram) works completely without it. **A ChatGPT/Claude/Gemini chat subscription is not this credential** — only a real Google AI Studio/Vertex API key activates this. |

Three separate databases exist so the integration-test suite's truncate-then-seed cycle can
never race the E2E suite's, and so neither ever touches your own hand-inspected development
data.

## Commands

| Command | What it does |
|---|---|
| `npm run db:generate` | Reads `src/db/schema/index.ts` and writes a new migration file under `drizzle/` reflecting whatever changed. Review the generated SQL before committing it — this is the only step that touches the schema definition. |
| `npm run db:migrate` | Applies every not-yet-applied migration in `drizzle/` to `DATABASE_MIGRATION_URL` (or `DATABASE_URL`), then automatically backfills `books.search_text` for any existing book a schema change left with a NULL value (Phase 5 correction pass — safe and necessary when upgrading an already-populated database, a fast no-op on a from-zero one). Safe to run repeatedly — already-applied migrations and already-backfilled rows are both tracked and skipped. |
| `npm run db:seed` | Truncates every seeded table and re-inserts the 48-book fixture catalog with its stable UUIDs. Does **not** touch `reading_lists`/`reading_list_items` data you created by hand through the app... actually it does — see "What gets wiped" below. |
| `npm run db:reset` | Runs migrate then seed, in order, against `DATABASE_URL`. The normal way to get a clean development database. |
| `npm run db:check` | Runs `drizzle-kit check` — fails if the committed migrations and the current schema have drifted apart (e.g., someone edited a schema file without regenerating a migration). Good to run before opening a PR. |
| `npm run test:integration` | Runs the real-database repository/migration tests (`tests/integration/`) against `TEST_DATABASE_URL`, migrating and seeding it once per run via a Vitest global setup. |
| `npx playwright test` | Runs the E2E suite, migrating and seeding `E2E_DATABASE_URL` once per run via `tests/e2e/globalSetup.ts`, then building and starting the app against it. |
| `npm run embeddings:generate` | Backfills `books.embedding` for every book needing one (Phase 5). `--mode=missing` (default), `--mode=stale` (composition/data changed since the last embedding), or `--mode=all`; `--dry-run` reports what would run without calling the provider or writing anything. Exits cleanly, doing nothing, when `GEMINI_API_KEY` is unset. Idempotent — a second `missing` run after a successful one processes zero books. Never run automatically during a request or migration. |
| `npm run search:rebuild-text` | Rebuilds `books.search_text` (conventional full-text search) after a metadata edit or import — `--mode=missing` (default) or `--mode=all`. **Distinct from `embeddings:generate`**: never calls an embedding provider, needs no `GEMINI_API_KEY`, only ever touches `search_text`. The migration-upgrade case (an already-populated database) is handled automatically by `db:migrate` itself, not this command — this one is for the ongoing-maintenance case. See `docs/SEARCH.md` §4. |
| `npm run evaluate:search` | Runs the committed search evaluation dataset (`tests/evaluation/`, 41 cases across known-item/structured/safety/exploratory) against `TEST_DATABASE_URL` and reports recall/top-1/top-5/prohibited-result violations, broken down by category — see `docs/SEARCH.md` §11. |

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

## Phase 5 — real search architecture

The Phase 4 seam described above is exactly where Phase 5 landed: `SearchRepository`
(`src/db/repositories/searchRepository.ts`) is the new boundary alongside `BookRepository` —
`BookRepository.getBookById()`/`listBooks()` remain unchanged (Book Detail/Reading Lists), and
`SearchRepository` owns every SQL statement Find's search actually needs (hard filters,
exact/FTS/trigram/vector candidate retrieval, facets, autocomplete). See `docs/SEARCH.md` for
the full architecture. `books.embedding` (`vector(768)`) and its metadata columns now exist,
populated only by the controlled `npm run embeddings:generate` script — never automatically.

## Why Reading Lists moved here but auth didn't

Reading Lists became genuinely shared Postgres data this phase (see `docs/DECISIONS.md`,
"Reading Lists: from localStorage to Postgres") because the product concept always described
them as shared, and Phase 3 explicitly built them behind a repository interface for exactly
this swap. Staff/admin authentication deliberately did **not** change — there is still no
Supabase Auth, no individual accounts, and no real Row Level Security. Access to the database
is entirely server-mediated: every Server Action independently calls `requireStaffSession()`
before touching a repository, and the browser never holds database credentials or a direct
connection — see `docs/SECURITY.md` for the full boundary.
