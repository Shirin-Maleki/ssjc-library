# Changelog

A simple, phase-level record of what actually shipped — not a verbose release process.
Entries are dated by when the work was completed; see `docs/IMPLEMENTATION_STATUS.md` for the
current state and `docs/DECISIONS.md` for the reasoning behind any of these.

## Phase 6 correction pass — 2026-09-20

A small, bounded correction pass, made before any real OAuth credential was introduced:

- **Root-scoped the public `getFileMetadata(fileId)`** — it previously had no
  root-containment check, unlike every other provider method, making it a real escape
  hatch for arbitrary Drive metadata access. Split into a private, unscoped
  `fetchRawMetadata` and a public `getFileMetadata` that enforces containment before
  returning anything.
- **Gave the real smoke test a genuine cleanup guarantee** — a failure after the disposable
  test file was uploaded (confirmation, download, or a safety check) previously exited the
  process immediately, orphaning that file in the real configured root. Extracted the step
  orchestration into a pure, provider-injected, fully-tested function
  (`scripts/google/smokeOrchestration.ts`) that always attempts cleanup once a real file
  exists.
- Investigated a reported "empty `validation.test.ts`" and found it was not empty — 9
  tests already covered every case asked for; no change made.
- Test counts: 342 unit (was 325, +17), 68 integration (unchanged), 41 evaluation cases
  (unchanged), 103 E2E (unchanged).

## Phase 6 — Google Drive connection — 2026-09-18

Establishes secure, real Google Drive infrastructure for future cover-photo storage
(Phase 7 intake, Phase 10 bulk import) — no Add Book UI, no image AI, no processing of the
existing ~1,500-photo collection. Implementation complete; real Google validation
(`npm run google:smoke`) awaits user OAuth Cloud setup — see `docs/GOOGLE_SETUP.md`.

- **`CoverStorageProvider` abstraction + `GoogleDriveCoverStorageProvider`**
  (`src/lib/googleDrive/`), mirroring the `src/lib/embeddings/` provider-boundary pattern
  already proven in this codebase. Methods: connection verification, bounded/paginated
  listing, metadata lookup, source download, resumable-upload initiation, upload
  confirmation, test-only cleanup.
- **OAuth 2.0 Web Server authorization** with one SSJC Workspace account and offline
  refresh access — not a service account (the existing photo hierarchy would need
  reorganizing to support one cleanly) and not teacher Google login (SSJC staff
  authentication is completely unchanged). Two narrow scopes only: `drive.readonly` +
  `drive.file`.
- **Root-folder security boundary**: every operation is proven to reach
  `GOOGLE_DRIVE_ROOT_FOLDER_ID` or a real descendant of it via an ancestry walk
  (cycle-guarded, depth-bounded) before it may proceed — an accessible-but-unrelated Drive
  ID can never become reachable through this application.
- **Resumable-upload infrastructure** for the future Phase 7 browser-upload flow: the
  server validates and initiates the upload, returns only the resumable session URI (never
  an OAuth credential) to the browser, then independently re-verifies the completed upload
  from Drive before trusting it.
- **`npm run google:authorize`** (local, interactive, one-time OAuth setup) and
  **`npm run google:smoke`** (real, opt-in, self-cleaning end-to-end connectivity proof) —
  both CLI-only, never a production route.
- **No database migration** — `books.cover_drive_*`/`ingestion_items.drive_file_id` already
  existed from the Phase 0 schema review. No OAuth/token table; credentials live in
  environment/deployment secrets only.
- **No regression to Phase 5** — search, Reading Lists, Book Detail, voice search, and
  authentication are all untouched.
- Test counts: 325 unit (was 238, +87 across 6 new files, all mocked at the HTTP boundary),
  68 integration (unchanged), 41 evaluation cases (unchanged), 103 E2E (unchanged).

## Phase 5 real-provider validation — 2026-09-17

With a real `GEMINI_API_KEY` available for the first time, performed the one item the correction
pass below could not: live provider testing, real embedding generation for the full 49-book
development catalog, real hybrid evaluation, and manual product verification. No secret was ever
printed, logged, or committed.

- **Live provider contract confirmed** against a real API call (768-dimension output, asymmetric
  query/document prefixes genuinely accepted — 0.98 real cosine similarity between the two
  formattings of the same text). Added bounded retry-with-backoff after live testing reproduced
  real `HTTP 429` rate-limit responses.
- **Real embeddings generated**: 49/49 active development-catalog books, correct metadata
  verified, idempotent re-runs, live edit→rebuild→restore staleness detection confirmed,
  pending/archived books untouched.
- **Two real ranking bugs found from live evidence and fixed**: the semantic meaningful-distance
  ceiling was still letting most of the catalog through even after one correction (`1` → `0.36` →
  `0.30`, each step backed by real measured cosine distances); "very" (a substring of
  "every"/"everyday") was falsely triggering tag/description keyword matches, fixed by
  stop-wording it — the same fix class as the pre-existing "age"/"courage" and "day"/"everyday"
  collisions.
- **Manual product verification** with real embeddings present, at desktop and mobile widths:
  known-item precision restored, exploratory queries return grounded, jargon-free explanations,
  autocomplete never calls the embedding provider, zero console errors.
- Test counts: 238 unit (was 231), 68 integration (unchanged), 41 evaluation cases (unchanged
  count, now genuinely exercised in real-hybrid mode), 103 E2E (unchanged count; one pre-existing
  locator ambiguity tightened after real embeddings changed result ordering enough to expose it).

## Phase 5 correction pass — 2026-09-17

A bounded correction pass over four material Phase 5 acceptance gaps a reviewer found (real
Postgres integration tests pass, typecheck/lint/unit all pass, but real gaps remained), plus two
adjacent items the same review exposed. No Phase 6 work, no Find UI redesign:

- **Safe upgrade of an existing Phase 4 database.** Migration `0001` left pre-existing books'
  `search_text` NULL — silently disabling full-text discovery until a reseed. Fixed by folding
  an automatic, idempotent backfill into `npm run db:migrate` itself (`rebuildSearchText()`,
  reusing the same `buildSearchIndexText()` composition `seed.ts` already uses), plus a
  standalone `npm run search:rebuild-text` command for the ongoing-maintenance case, distinct
  from embedding generation. Proven end to end by `tests/integration/db/migrationUpgrade.test.ts`
  — a real Phase-4-shaped database with real relational data, upgraded without reseeding.
- **Real server-side pagination for filter-only browsing.** The queryless-browse path selected
  every matching book, sorted them all in memory, then sliced — unbounded on every request and
  every "Show More" click. Fixed with `findVisibleBookIdsPage`/`countVisibleBooks`, real SQL
  ordering/limiting and an exact `COUNT(*)`. Proven at a 300-row synthetic scale with a spy
  assertion that only the requested page size is ever projected, never the full match set.
- **Complete database-backed autocomplete.** `AutocompleteRow` always declared "topic" and
  "language" as suggestion types; the query never produced them. Added both, visibility-scoped
  and additional-language-aware, with repository/action/UI-level test coverage.
- **Expanded the search evaluation suite** from 13 to 41 cases across known-item/structured/
  safety/exploratory, reported per-category with a new top-5 metric — including ISBN cases (two
  real ISBNs added to two real fixture books), a diacritics case, and two explicitly labeled
  development-only fixtures for themes the real catalog has no credible match for.
- **A normalization audit** found and fixed a real mismatch: the exact-title query compared a
  bare lowercase string against a canonically-normalized stored value, so a query with its own
  leading article never matched. A deterministic-intent audit confirmed every documented
  phrasing (age ranges, fiction/nonfiction, format/category names, illustration styles) already
  worked correctly and added the missing test coverage, plus an explicit hard/strong/soft
  classification for every structured signal.
- **An explicit asymmetric retrieval input contract** for the Gemini embedding adapter — document
  and query embedding calls previously sent identical, unlabeled text. Implemented per Google's
  documented `gemini-embedding-2` contract (not independently verified against a live call, since
  no `GEMINI_API_KEY` exists in this environment); the embedding composition version was bumped
  so any hypothetical existing embedding is detectably stale.
- Test counts: 231 unit (was 204), 68 integration (was 50), 41 evaluation cases (was 13), 103 E2E
  (unchanged, all still passing).
- **Real semantic-quality validation remains unvalidated** — still no `GEMINI_API_KEY` in this
  environment. Phase 5 is not marked complete for this reason alone.

## Phase 5 — real search architecture — 2026-09-16 (in progress)

Replaces the Find page's "load the whole catalog into Node, filter in memory" path with a
real, bounded, database-backed hybrid search pipeline. See `docs/SEARCH.md` for the full
architecture and `docs/IMPLEMENTATION_STATUS.md` for exactly what remains undone.

- New `SearchService`/`SearchRepository` boundary — structured SQL hard filters,
  exact/near-exact matching, Postgres full-text search (generated `tsvector`, GIN-indexed),
  `pg_trgm` fuzzy typo tolerance, and optional pgvector semantic retrieval, merged into one
  bounded candidate set and scored by a new hybrid scorer on top of the unchanged Phase 2–4
  deterministic ranker.
- pgvector installed and schema-ready (`vector(768)` + embedding metadata columns), with a
  provider abstraction (production Gemini adapter, deterministic fake test provider), graceful
  degradation on any embedding failure/absence, and a controlled backfill script
  (`npm run embeddings:generate`). No real `GEMINI_API_KEY` exists in this environment — real
  semantic-quality validation has not been performed.
- Catalog visibility (`review_status = 'active'`) enforced in SQL for every teacher-facing
  search/autocomplete/facet path, proven by tests against deliberately seeded non-active rows.
- Incomplete metadata is never invented — optional fields display "Not specified," never a
  fabricated confirmed-looking value; facets never offer a synthetic "unknown" option.
  Server-side bounded autocomplete and facets replace full-catalog client-side derivation; "Show
  More" now performs a real re-search instead of slicing an already-fetched array.
- A committed search evaluation dataset and command (`npm run evaluate:search`) — this harness
  caught a real regression (structured free-text intent producing no reachable SQL candidates)
  before it shipped.
- Four real bugs found and fixed during this work's own testing (not worked around): an
  implicit-AND full-text query returning zero results for natural multi-word phrases; a
  structural field label leaking into full-text-searchable content; structured intent
  (age/duration/language/style phrases) having no independent SQL candidate path; trigram fuzzy
  matching never using its own GIN index (found via `EXPLAIN ANALYZE` at a realistic ~2,551-row
  scale, ~40x faster after the fix). Full writeups in `docs/SEARCH.md`.
- Test counts: 204 unit (was 178), 50 integration (was 34), 103 E2E (unchanged count, all
  passing against the new architecture).

## Phase 4 correction pass — 2026-09-16

A focused acceptance-gap pass over the reviewed Phase 4 database work (no redesign, no new
phase):

- Completed the multilingual data-access model: `DrizzleBookRepository` now actually batch-loads
  and projects `book_languages` as `Book.additionalLanguageCodes`; the language registry
  (`src/lib/catalog/languages.ts`) became a genuine ISO 639-1 map (~150 codes), not a six-code
  stub; language filtering/facets recognize a book's additional languages, not just its primary.
- Added the centralized metadata field-key registry `docs/DATA_MODEL.md` §6 always described
  (`src/lib/metadata/fieldRegistry.ts`) — it didn't exist until now.
- Hardened Book Detail (`/books/[id]`) against a malformed id — validated as real UUID shape
  before reaching Postgres, rendering the existing calm "Book not found" state instead of a raw
  database error.
- Added a calm database-error boundary for Find and Book Detail (`find/error.tsx`,
  `books/[id]/error.tsx`, a shared `CatalogErrorFallback` component) — distinct from Reading
  Lists' existing client-side load-error handling.
- Made the Add-to-Reading-List dialog's "Create & add" one atomic database transaction
  (`ReadingListRepository.createWithBook`) — the previous two-call sequence left a real
  partial-success window (an empty orphan list if the second call failed).
- Normalized Reading List domain failures (`ReadingListNotFoundError`, `BookNotFoundError`,
  `InvalidIdError`) so a nonexistent list/book or a malformed id is a safe, typed outcome, never
  a raw foreign-key-violation or invalid-UUID-syntax database exception.
- Added the actual two-independent-browser-context Playwright acceptance test for shared Reading
  Lists, alongside the existing two-database-connection integration test.
- Corrected two path/description inaccuracies inherited from the Phase 0 design docs (the
  language registry's real path, and Supabase's actual multiple connection types) and fixed
  this document's own absence.

## Phase 4 — real database — 2026-09-16

PostgreSQL (via Drizzle ORM) became the canonical data store:

- The full reviewed 23-table schema implemented as committed Drizzle migrations
  (`docs/DATA_MODEL.md`), with two small documented corrections (`visual_media_type` as an
  array, `visual_realism`'s `stylized_illustration` rename).
- The 48-book fixture catalog converted into seed data with stable UUIDs
  (`src/db/seed.ts`) — `fixtures.ts` retained as seed/test source material only.
- Find, Book Detail, and category data now read from Postgres via repository classes
  (`src/db/repositories/`) instead of the in-memory fixture array — the existing deterministic
  `searchBooks()` ranking unchanged.
- Reading Lists moved from Phase 3's `localStorage` to genuinely shared Postgres persistence,
  via authenticated Server Actions.
- Real database tests (migrations, repositories, a two-connection shared-persistence proof)
  against an actual running Postgres instance.
- No Phase 5 work included: no pgvector, no embeddings, no AI, no Google integration.

## Phase 3 — voice search, Reading Lists, Library Guide — 2026-09-15

- Voice search as progressive enhancement over the browser's Web Speech API, reusing Find's
  exact deterministic search pipeline — no separate voice ranking or AI interpretation.
- Reading Lists (Phase 3: `localStorage`-backed behind a `ReadingListRepository` interface,
  deliberately designed so Phase 4 could swap the implementation with no UI change).
- A real Library Guide (`/guide`).

## Phase 2 — mock catalog + Find a Book — 2026-09-14

- A 48-record development fixture catalog and a fully deterministic (no AI) search/ranking
  engine — see `docs/SEARCH.md`.
- The real Find a Book page (search, autocomplete, filters, results) and Book Detail route.
- A visual/mobile revision the same day: brand color/logo scale, mobile-first Find layout.

## Phase 1 — foundation, design system, staff/admin access — 2026-09-14

- Shared staff/admin password authentication (bcrypt + signed session cookie), no individual
  accounts.
- The design system and full brand application (name, palette, typography, logo).

## Phase 0 — repository inspection + architecture — 2026-09-13

- Initial architecture review and the full data model design (`docs/DATA_MODEL.md`,
  `docs/ARCHITECTURE.md`), including the 25→23 table schema-complexity review.
