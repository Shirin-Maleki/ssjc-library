# Implementation Status

Last updated: 2026-09-16 (Phase 5, in progress). This document is continuity insurance — it
should always let another coding agent open this repository cold and know exactly where things
stand. Keep it current at the end of every phase.

## Current phase

**Phase 5 — Real search architecture: in progress, not yet complete.** Phase 4 (real database)
is complete and approved as of commit `8b128f0`. Phase 5 replaces the Find page's
load-the-whole-catalog-then-filter-in-memory path with a real, bounded, database-backed hybrid
search pipeline: PostgreSQL full-text search + trigram fuzzy matching + structured SQL filters
+ optional pgvector semantic retrieval, combined by a transparent hybrid scorer, on top of the
unchanged deterministic Phase 2–4 ranking engine. See `docs/SEARCH.md` for the full
architecture. **Honestly incomplete as of this writing:** real semantic-quality validation has
not been performed — no `GEMINI_API_KEY` exists in this environment, so no real embedding has
ever been generated. `EXPLAIN ANALYZE` evidence at a realistic ~2,551-row scale and manual
visual/accessibility verification at real viewport widths have both now been performed (see
"Completed work" below) — do not treat Phase 5 as validated beyond what's explicitly listed as
done, but real semantic quality is the one genuinely open gap, not a placeholder list.

## Full phase plan (for reference — do not execute ahead of approval)

| Phase | Name | Status |
|---|---|---|
| 0 | Repository inspection + architecture | Complete (approved) |
| 1 | Foundation + design system + access | Complete (approved), branding applied 2026-09-14 |
| 2 | Mock library + Find a Book | Complete (approved), visual/mobile revision 2026-09-14 |
| 3 | Voice + reading lists + guide | Complete (approved) |
| 4 | Real database | Complete (approved) |
| 5 | Real search architecture | **In progress — see "Current phase"** |
| 6 | Google Drive connection | Not started |
| 7 | Single Add-a-Book flow | Not started |
| 8 | Admin review + taxonomy | Not started |
| 9 | Google Sheets | Not started |
| 10 | Bulk import engine | Not started |
| 11 | Taxonomy research batch | Not started |
| 12 | Full import | Not started |
| 13 | Hardening / QA / deployment | Not started |

Each phase executes only after explicit approval of the previous one's report.

## Completed work (Phase 2)

- A 48-record development fixture catalog (`src/lib/catalog/fixtures.ts`), explicitly
  labelled as non-inventory, meaningfully varied across language (6 languages), fiction/
  nonfiction, format, all 8 provisional physical categories, illustration style, visual
  realism, and read-aloud duration — enough variation for every filter and ranking test the
  brief names by example to genuinely exercise real data, not a hand-picked toy set.
- A fully deterministic (no AI) search/ranking engine (`src/lib/search/`): text
  normalization with diacritic folding, structured intent parsing from free text (age,
  duration, visual realism, language, illustration style — ranking signals only, never hard
  filters), centralized ranking weights, catalog-derived autocomplete, and grounded
  match explanations built only from fields that actually matched. Full design and every
  weight documented in the new `docs/SEARCH.md`.
- A real Find a Book page: large search input with an accessible keyboard-operable
  autocomplete combobox, category quick-pills, a single consistent Filters dialog (built on
  Radix Dialog) covering all eleven filter dimensions, removable active-filter chips,
  URL-backed search state (query and every filter round-trip through `/find?...`), Top-5
  ranked results with Show More, and distinct initial/zero-result states.
- A real Book Detail route (`/books/[id]`) with the full teacher-relevant metadata set, no
  admin/AI internals exposed, and a reliable "back to results" link that preserves the exact
  originating search via a validated `?from=` parameter.
- Generated, typographic placeholder book covers (`BookCover.tsx`) — no licensed art, no
  hotlinked images, swappable for real cover photography later behind one component.
- A physical-category badge that is the first real, deliberate use of the school's brand
  accent color, applied consistently (not per-category) to avoid a "rainbow of tags."
- 84 unit tests (up from 19) and 56 E2E tests (up from 38, across both real Chromium and
  real WebKit) — all passing. Four real search bugs were found and fixed by this testing,
  not just theoretical coverage — full writeups in `docs/SEARCH.md` and `docs/TESTING.md`.
- Real screenshots captured and visually inspected at mobile and desktop for the initial
  state, populated results, autocomplete, zero results, the Filters dialog, a
  Show-More-triggering browse result, and Book Detail.
- Typecheck, lint, and production build all pass cleanly.

## Phase 2 visual/mobile revision (2026-09-14)

A follow-up design pass over the same Phase 2 scope — no new features, no search/domain code
changes, no new phase started. Requested because the initial Phase 2 screenshots were judged
substantially desktop-oriented and too close to black/white/cream for a school with a real
four-color brand palette. Full detail in the phase report; summary:

- Mobile-first pass across every Find a Book screen (320/390/430px), with real 44px-minimum
  touch targets throughout, a horizontally-scrolling mobile category rail instead of multi-line
  wrap, and a leaner mobile result row (tags and the second description line move to desktop
  only; age/duration/visual-style/location — the facts the brief's own examples depend on —
  stay visible at every width).
- Three new semantic color tokens added to `globals.css` (`--color-accent-emphasis` /coral,
  `--color-highlight` /yellow, `--color-accent-warm` /orange), joining the existing
  `--color-accent` /teal, each given one deliberate, restrained role — see docs/BRANDING.md.
  Every new checkbox/age/category "selected" state now uses the teal accent instead of brand
  black, for one consistent selection language across the app.
- Logo scale increased in both the header (28→42px) and the Welcome screen (64→112px, with a
  restrained two-tone accent halo behind it) — still the same unmodified logo file.
- `BookCover.tsx` redesigned from three thin-rule-only layouts to four full-tint editorial
  compositions (teal/coral/yellow+orange/neutral, cycling deterministically) — still fully
  typographic, still swappable for real cover photography behind the same component.
- Home screen no longer vertically centers its content (which produced a large, unintentional
  void on tall/wide viewports) and its two primary tiles now carry a teal (Find) / warm-orange
  (Add) icon accent.
- Screenshots re-captured at 320/390 (mobile) and 1440×900 (desktop); all 87 unit tests and all
  56 E2E tests still pass unmodified — the E2E suite's existing selectors and assertions
  (`li:has(h3)`, "Real photography", "Under 5 minutes", the Filters dialog flows) needed no
  changes, since none of the above touched the DOM structure or text those tests depend on.

## Completed work (Phase 3)

- **Voice search**, integrated directly into `SearchInput` rather than a separate panel:
  progressive enhancement over the browser's Web Speech Recognition API
  (`src/lib/voice/speechRecognition.ts` adapter, `useVoiceSearch` hook, `VoiceSearchButton`
  component), with an explicit status machine (idle/listening/processing/permission-denied/
  no-speech/error/unsupported). A final transcript reuses the exact same `navigate()` →
  `buildFindHref()` → `/find?q=...` → `searchBooks()` path typed search already uses — no
  separate voice ranking, no AI interpretation layer. Existing filters survive a voice search
  exactly as they survive a typed one (tested). No audio or transcript is ever persisted; a
  subtle in-UI privacy note appears only while the microphone is actually engaged.
- **Reading Lists**, a shared, accountless, local-only (Phase 3 prototype) feature: a domain
  layer (`src/lib/reading-lists/{types,repository,localStorageRepository,format}.ts`) behind
  a `ReadingListRepository` interface, a `ReadingListsProvider` client context (mounted once in
  the staff layout), and a full UI — overview (`/lists`), detail (`/lists/[id]`), create/
  rename/delete dialogs, and an Add-to-Reading-List dialog reachable from both Search Results
  and Book Detail. Blank "Created By" displays as "Anonymous"; adding a book already on a list
  is idempotent; deleting a list never touches the fixture catalog. Book Detail's `?from=`
  return-context mechanism now also accepts `/lists/<id>` alongside `/find`, with its own
  "Back to reading list" label.
- **Library Guide** (`/guide`): a real, concise, scannable explainer — physical category vs.
  digital tags (with a real, non-invented example drawn from the actual fixture catalog),
  how to find/return a book, and honest future-tense descriptions of Add a Book and Review
  Later (neither exists yet; the guide says so explicitly, with no fake buttons).
- **Teacher Catalog**: Home's nav copy ("Open the shared spreadsheet view.") was corrected to
  "Shared spreadsheet view, coming later." — the placeholder route/copy itself was already
  honest and needed no other change.
- 59 new unit tests (voice adapter/hook/messages, a component-level `SearchInput` voice
  integration test, the Reading Lists domain/repository, formatting helpers) and 62 new E2E
  tests (`voice.spec.ts`, `readingLists.spec.ts`, `guide.spec.ts`), plus 2 existing
  `navigation.spec.ts` placeholder assertions retired now that Reading Lists and Library Guide
  are real destinations — 146 unit / 118 E2E tests total, all passing across both the desktop/
  Chromium and mobile/WebKit projects.
- Real screenshots captured and visually inspected at 320/390/820(tablet)/1440 for every voice
  state, every Reading Lists screen and dialog, and the Guide — including a deliberate
  longer-list stress test of the tinted `BookCover` system, which remained legible and
  restrained, not noisy (see `docs/BRANDING.md`/`docs/DECISIONS.md` — no code change needed).
- Typecheck, lint, and production build all pass cleanly.

## Completed work (Phase 4)

- **Full 23-table schema implemented as committed Drizzle migrations** (`src/db/schema/`,
  `drizzle/`) — exactly the reviewed schema from `docs/DATA_MODEL.md`, with no casual
  simplification and neither `work_groups` nor a `languages` reference table revived. Two small,
  documented corrections: `visual_media_type` is a Postgres array (not scalar), and
  `visual_realism`'s `stylized` value is named `stylized_illustration` — full reasoning in
  `docs/DECISIONS.md` and `docs/DATA_MODEL.md` §16.
- **The 48-book fixture catalog became seed data** (`src/db/seed.ts`) with stable, hardcoded
  UUIDs (not the fixtures' string slugs) — truncate-then-seed, fully reproducible. `fixtures.ts`
  itself is retained as seed/test source material only; no production code path imports it
  directly anymore.
- **Find, Book Detail, and category data all read from Postgres** via `BookRepository`/
  `CategoryRepository` (`src/db/repositories/`) instead of the fixture array — the existing
  deterministic `searchBooks()` ranking is completely unchanged, just fed real database rows
  projected into the same `Book` shape.
- **Reading Lists moved from `localStorage` to genuinely shared Postgres persistence**, via
  `ReadingListsProvider → RemoteReadingListRepository → 7 authenticated Server Actions →
  DrizzleReadingListRepository → Drizzle → Postgres` (`docs/ARCHITECTURE.md` §20,
  `docs/DECISIONS.md`). Old localStorage data was deliberately not migrated (disposable dev
  data). Every mutation dialog now handles a real network failure with a calm message instead
  of assuming success.
- **Real database tests, against a genuinely running Postgres instance, never mocked:** 7
  migration/schema tests, 8 `BookRepository` tests, 10 `ReadingListRepository` tests including
  the mandated two-independent-connection shared-persistence proof (`npm run test:integration`).
- **A local, disposable PostgreSQL 16 setup** (three databases: dev/test/e2e) stood in for
  Supabase in this environment — nothing in the schema or code is Supabase-specific; switching
  is a connection-string change (`docs/DATABASE_SETUP.md`).
- 2 new unit tests (`ReadingListsProvider`'s load-failure path, replacing now-obsolete
  "corrupted localStorage" E2E coverage), 25 new integration tests, and a full rewrite of
  `readingLists.spec.ts`'s test strategy for genuinely shared/persistent E2E data (collision-
  proof list names, desktop-only + serial execution, two real bugs found and fixed along the
  way — full account in `docs/TESTING.md` and `docs/DECISIONS.md`) — 156 unit / 25 integration /
  98 E2E tests, all passing, the E2E suite re-run three consecutive times with no flakes.
- Typecheck, lint, and production build all pass cleanly.

## Completed work (Phase 4 correction pass, 2026-09-16)

A focused acceptance-gap pass over the reviewed Phase 4 work — no redesign, no Phase 5 work.
See `docs/CHANGELOG.md` for the condensed version and `docs/DECISIONS.md` for full reasoning.

- **Multilingual data access actually works now.** `DrizzleBookRepository` batch-loads and
  projects `book_languages` as `Book.additionalLanguageCodes`; the language registry
  (`src/lib/catalog/languages.ts`) is a genuine ~150-code ISO 639-1 map, not a six-code stub;
  language filtering and facets recognize a book's additional languages, not just its primary.
- **The metadata field-key registry `docs/DATA_MODEL.md` §6 always described now exists**
  (`src/lib/metadata/fieldRegistry.ts`) — it didn't, until this pass.
- **Book Detail hardened against a malformed id** — validated as real UUID shape before
  reaching Postgres; both a malformed and a valid-but-nonexistent id render the same calm
  "Book not found" state.
- **A calm database-error boundary for Find and Book Detail** (`find/error.tsx`,
  `books/[id]/error.tsx`, a shared `CatalogErrorFallback` component) — never a raw SQL/
  connection/driver detail, always a retry action.
- **"Create & add" is now one atomic database transaction**
  (`ReadingListRepository.createWithBook`) — the previous two-call sequence left a real
  partial-success window (an orphan empty list if the second call failed).
- **Typed domain errors replace raw database exceptions** for Reading List mutations
  (`ReadingListNotFoundError`, `BookNotFoundError`, `InvalidIdError`) — a nonexistent list/book
  or a malformed id is now a deliberate, safe outcome at both the repository and Server Action
  boundary, not something that happened to be caught by a generic try/catch.
- **The actual two-independent-browser-context Playwright acceptance test** for shared Reading
  Lists now exists, alongside the pre-existing two-database-connection integration test.
- Two documentation path/description inaccuracies inherited from the Phase 0 design docs
  corrected (the language registry's real path; Supabase's actual multiple connection types,
  not one "default connection"), and `docs/CHANGELOG.md` created.
- 22 new unit tests (156 → 178), 9 new/extended integration tests (25 → 34), and 3 new E2E
  test definitions — 2 Book Detail hardening cases in `find.spec.ts` (run on both projects, so
  4 additional test instances) and the two-browser acceptance test in `readingLists.spec.ts`
  (desktop-only, 1 additional instance) — bringing the E2E total from 98 to 103. A real bug was
  caught and fixed by this work's own new integration test before it ever shipped (see "Known
  bugs" below).
- Typecheck, lint, `db:check`, unit, integration, build, and E2E all re-run and passing — see
  the correction-pass report for exact counts. The E2E suite was also the subject of a genuine
  environmental investigation: several runs showed non-deterministic, code-unrelated failures
  (different spec files each time) caused by chrome-headless-shell processes orphaned from a
  much earlier, unrelated session (running over a day, consuming ~1.5GB of swap) — once
  identified and cleaned up, the suite ran in 35 seconds instead of 15–35 minutes and passed
  103/103 three consecutive times.

## Completed work (Phase 5, in progress)

See `docs/SEARCH.md` for the full architecture and `docs/CHANGELOG.md` for the condensed
version. Starting commit: `8b128f0` (approved Phase 4 correction pass).

- **Real hybrid search pipeline**, replacing `BookRepository.listBooks()` → in-memory
  `searchBooks()`: structured SQL hard filters, exact/near-exact matching, Postgres full-text
  search (GIN-indexed generated `tsvector`), `pg_trgm` fuzzy typo tolerance, and optional
  pgvector semantic retrieval — all bounded (never the full catalog), merged into one candidate
  set, then scored by `combineScores()`/`rankScoredBooks()` (`lib/search/hybridScore.ts`) on top
  of the unchanged Phase 2–4 deterministic ranker.
- **`SearchService`/`SearchRepository` architectural boundary** — the Find page never sees SQL,
  Drizzle, or vector internals; `BookRepository.getBookById()`/`listBooks()` remain the
  unscoped Book Detail/Reading-Lists boundary.
- **Catalog visibility enforced in SQL**: every teacher-facing search/autocomplete/facet query
  is scoped to `review_status = 'active'`, proven by integration tests against deliberately
  seeded `pending_review`/`archived` rows.
- **Incomplete metadata is never invented**: fiction type/format/visual realism/duration are all
  optional; display falls back to "Not specified"; facets never offer a synthetic "unknown"
  option; an active filter never matches an unrecorded value.
- **pgvector installed and schema-ready** (`vector(768)` column + embedding metadata columns),
  with a provider abstraction (`GeminiEmbeddingProvider` for production,
  `FakeEmbeddingProvider` for tests), graceful degradation on any embedding failure/absence, a
  deterministic embedding-document builder, and a controlled backfill script
  (`npm run embeddings:generate`, missing/stale/all modes, dry-run, batch-tolerant).
  **`GEMINI_API_KEY` is not set in this environment — no real embedding has ever been
  generated, and real semantic-quality validation has not been performed.**
- **Server-side bounded autocomplete and facets**, replacing full-catalog client-side
  derivation; **real re-search pagination** ("Show More" re-queries with a larger `?n=` bound,
  not a client-side slice of an already-fetched array).
- **A committed search evaluation dataset and command** (`npm run evaluate:search`,
  `tests/evaluation/`) — 13 cases across known-item/structured/exploratory/safety categories,
  currently 13/13 recall, 2/2 top-1, 0 prohibited-result violations. This harness caught and
  drove the fix for a real regression (see "Known bugs" below).
- Four real bugs found via E2E/evaluation/EXPLAIN-ANALYZE testing and fixed (not worked
  around): (1) `plainto_tsquery`'s implicit AND returned zero results for natural multi-word
  queries — fixed with an OR-of-lexemes tsquery plus a meaningful-overlap gate; (2) a
  structural label ("Read-aloud length") leaked into full-text-searchable content, making the
  word "read" match every seeded book — fixed by splitting the full-text index text from the
  (differently composed) embedding document; (3) structured free-text intent
  (age/duration/language/style phrases) had no independent SQL candidate path, so an
  age-appropriate book with no literal keyword overlap with the query was never retrieved as a
  candidate at all — fixed by `buildIntentConditions()`; (4) trigram fuzzy matching's
  `similarity() > floor` predicate never used the trigram GIN index at all (Postgres only
  index-accelerates the `%` operator) — found via `EXPLAIN ANALYZE` at a realistic ~2,551-row
  synthetic scale (6.7ms sequential scan), fixed with the indexable `%` operator under a
  transaction-scoped `pg_trgm.similarity_threshold` (0.16ms, ~40x faster). Full detail in
  `docs/SEARCH.md`.
- **`EXPLAIN`/`EXPLAIN ANALYZE` evidence gathered at a realistic ~2,551-row synthetic scale**
  (not just the 51-row dev/test seed) for every retrieval strategy — hard filters (0.76ms),
  exact/prefix match (1.36ms), full-text with the meaningful-overlap gate (4.97ms, GIN
  bitmap-index-accelerated), trigram (0.16ms after the index fix above), structured intent
  (0.06ms), and vector cosine distance over an exact scan (2.06ms for 500 embedded rows) — all
  comfortably within acceptable search latency at the catalog's full ~5,000-book target. Full
  numbers in `docs/SEARCH.md` §3.
- Test counts as of this writing: 204 unit (was 178), 50 integration (was 34, +16 net across
  two rounds of new search-repository/regression tests), 103 E2E across both Playwright
  projects (unchanged count, all passing against the new architecture) — see "Known bugs" for
  the E2E failures found and fixed during this work.

## In-progress / not yet done for Phase 5

- Final git commit and push for this work.

Everything else originally listed here is now done: manual visual/accessibility verification at
320/390/tablet/desktop with actual screenshots (`docs/screenshots/phase-5/`, `docs/TESTING.md`),
`EXPLAIN ANALYZE` evidence at a realistic ~2,551-row scale (`docs/SEARCH.md` §3,
`docs/TESTING.md`), and a standalone security review pass — verified directly, not assumed: no
`console.log`/`error`/`warn` calls anywhere in the new search files (no raw query logging);
`GEMINI_API_KEY` never appears as a literal anywhere in source, only in comments/error message
text; `server-only` present on `searchService.ts` and `embeddings/index.ts`;
`autocompleteAction.ts` independently calls `requireStaffSession()`; every client component
importing from `@/db/repositories/*` or `@/lib/search/searchService` does so via `import type`
only (erased at build, zero runtime code); all 27 `sql` template usages in
`searchRepository.ts` are Drizzle-parameterized, none string-concatenated.

## Blocked work

None outright, but **real semantic-quality validation is blocked on a real `GEMINI_API_KEY`**,
which does not exist in this environment. Conventional search (structured filters + exact/FTS/
trigram matching) is fully independent of this and works completely without it.

## Deferred work

Everything in Phases 6–13, by design: Google/Sheets/Drive integration, a single Add-a-Book
flow, Admin Review + taxonomy tooling, bulk import, and the school's final physical taxonomy
(still the 8 provisional development categories — see `docs/PRODUCT_SPEC.md` and
`src/lib/catalog/categories.ts`, seed-only source material).

## Pending user inputs

**Resolved 2026-09-14:** the school logo file arrived (`public/brand/logo.png`, real artwork,
wired into `LogoMark`) — see `docs/BRANDING.md` for a measured (not eyeballed) color
discrepancy between the logo's actual pixels and the documented official palette, flagged as
a genuine open question (which should be the "true" reference) rather than resolved by
assumption. Branding is now fully real end to end — nothing placeholder remains.

None of these block Phase 5:

- **Google Drive folder — link received 2026-09-14** (three sub-folders of scanned book
  covers). Not yet inspected: the Google Drive connector isn't authorized in-session yet, and
  per the approved roadmap this isn't needed until Phase 6 regardless. The actual link is
  intentionally not recorded in this repo (Phase 0 treats private Drive identifiers like
  credentials) — it's tracked outside the repo for when Phase 6 begins.
- Google Sheet for the teacher catalog projection (Phase 9).
- Which AI provider(s) you hold API/billing access to.
- **Supabase project credentials — still not provided.** Phase 4 used a local, disposable
  PostgreSQL 16 instance instead (`docs/DATABASE_SETUP.md`); nothing in the schema or
  application code is Supabase-specific, so this remains a pure connection-string swap
  whenever real credentials arrive — not a blocker for any phase.
- Eventually: feedback on whether the 8 provisional physical categories used for Phase 2
  testing feel like a reasonable direction, once Phase 11's real taxonomy research begins —
  not needed now.

## Known bugs

None open. Phase 4 found and fixed three real issues during its own testing — full writeups in
`docs/TESTING.md` and `docs/DECISIONS.md`:
1. `readingLists.spec.ts` broke almost entirely on first contact with genuinely shared,
   persistent Reading Lists data — a test-suite design gap (Phase 3's tests implicitly assumed
   per-browser-context isolation), not an application bug. Fixed with collision-proof list
   names, desktop-only serial execution, and reordering the two tests that genuinely need
   global emptiness to run first.
2. A real test-only race: several E2E tests navigated away immediately after clicking
   "Create & add," without waiting for the dialog to close — since `createList`/`addBook` are
   now genuinely asynchronous Server Actions (not synchronous `localStorage` calls), a full
   page reload could land between them and orphan the in-flight `addBook` call. Fixed with an
   explicit wait for the dialog to close before any navigation.
3. A locator-ambiguity bug in one E2E test, surfaced only after fixing #2: "Already added"
   matched multiple list rows once earlier tests had added the same book to their own lists.
   Fixed by scoping the check to the specific list row this test created.

Phase 3's three previously-fixed bugs (native `required` blocking custom validation, the
Add-to-list dialog's empty-state shortcut, and a `set-state-in-effect` lint violation) remain
fixed and are unaffected by Phase 4.

The Phase 4 correction pass found and fixed one more, caught by its own new test before it ever
shipped: the initial `createWithBook`/`addBook` domain-error work only pre-checked that the
referenced *book* existed, not the *list* — a nonexistent list still hit a raw
foreign-key-violation exception on the `reading_list_items` → `reading_lists` constraint. Fixed
by checking both referenced rows before writing. Full writeup in `docs/TESTING.md`.

Phase 5 found and fixed four real bugs (see "Completed work (Phase 5, in progress)" above for
the full list) — two caught by a first E2E run against the new architecture (zero results for a
natural multi-word query; a "Show More" test racing a real navigation instead of an instant
client-side update — the latter was a test-timing fix, not a product bug), one caught by the
search evaluation harness (structured intent producing no reachable candidates for a query with
no keyword overlap), and one caught by `EXPLAIN ANALYZE` at a realistic synthetic scale (trigram
fuzzy matching never actually using its own GIN index). All four are fixed and covered by
regression tests. No known open bugs.

## Environment variables

Phase 1's four (`STAFF_PASSWORD_HASH`, `ADMIN_PASSWORD_HASH`, `SESSION_SECRET`, optional
`SESSION_COOKIE_SECURE`) and Phase 4's four database variables (`DATABASE_URL`,
`DATABASE_MIGRATION_URL`, `TEST_DATABASE_URL`, `E2E_DATABASE_URL`) are unchanged — documented in
`docs/DATABASE_SETUP.md` and `.env.example`; no values recorded here. **Phase 5 adds one
optional variable: `GEMINI_API_KEY`** — activates real semantic retrieval and embedding
generation when present; every part of search works completely without it (conventional
retrieval has no dependency on it at all). **Not set in this environment.** Voice search still
uses only the browser's own Web Speech API (no server-side key).

## Migrations

**Real now.** Committed SQL migration files live under `drizzle/`, generated from
`src/db/schema/` via `npm run db:generate` and applied via `npm run db:migrate` — never
`drizzle-kit push` against a shared environment. `src/lib/catalog/fixtures.ts` is retained as
seed/test source material only, converted into seed data by `src/db/seed.ts`; no production
code path imports it directly anymore.
`LocalStorageReadingListRepository`'s replacement, `DrizzleReadingListRepository`, is wired in
at `ReadingListsProvider`'s single construction point, exactly as Phase 3 designed the seam.
**Phase 5 adds one new migration** (`drizzle/0001_mighty_war_machine.sql`) — enables the
`vector` and `pg_trgm` Postgres extensions, converts `read_duration_band` to a generated
column, and adds `search_text`/`search_vector` (generated) and the `embedding*` columns. The
approved Phase 4 migration (`0000_...`) is untouched. See `docs/DATABASE_SETUP.md` for the full
command reference, including pgvector-capable local setup.

## External services

A local, disposable PostgreSQL 16 instance (three databases: dev/test/e2e), now with the
`vector` and `pg_trgm` extensions enabled — still not actually external (see
`docs/DATABASE_SETUP.md`). Voice search still talks only to the browser's own built-in speech
recognition. **Optionally, Google's Gemini embedding API** (`gemini-embedding-2`) when
`GEMINI_API_KEY` is configured — not configured in this environment; search works completely
without it. No Supabase, Drive/Sheets, or other AI service is connected.

## Git status

Repository is linked to `github.com/Shirin-Maleki/ssjc-library` (`origin`, `main`). Phase 5's
work is not yet committed/pushed as of this writing — see the phase report for the exact commit
SHA once it is.

## Next recommended task

Commit and push this work, then await review of the Phase 5 report. Phase 6 (Google Drive
connection) must not begin until Phase 5 is explicitly approved.
