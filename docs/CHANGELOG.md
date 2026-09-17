# Changelog

A simple, phase-level record of what actually shipped — not a verbose release process.
Entries are dated by when the work was completed; see `docs/IMPLEMENTATION_STATUS.md` for the
current state and `docs/DECISIONS.md` for the reasoning behind any of these.

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
