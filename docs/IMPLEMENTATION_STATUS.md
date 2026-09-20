# Implementation Status

Last updated: 2026-09-20 (Phase 6 correction pass). This document is continuity insurance — it should always
let another coding agent open this repository cold and know exactly where things stand. Keep
it current at the end of every phase.

## Current phase

**Phase 6 — Google Drive connection: IMPLEMENTATION COMPLETE (including a 2026-09-20 code-safety
correction pass) — REAL GOOGLE VALIDATION BLOCKED ON USER OAUTH SETUP.** Phase 5 (real search
architecture, including its real-provider validation pass) is complete and approved as of
commit `88b02752363649c297b6e6f3e38202cee2e51a6a`.

Phase 6 establishes the OAuth-authorized Google Drive infrastructure that later phases (7:
Add Book intake; 10: bulk import) will build on — see `docs/GOOGLE_INTEGRATION.md` for the
full architecture and `docs/GOOGLE_SETUP.md` for setup. Everything that can be built and
proven without a real Google OAuth credential has been: the `CoverStorageProvider`
abstraction and its concrete `GoogleDriveCoverStorageProvider`, server-side OAuth token
management, the root-folder security boundary (now enforced on every method, including
`getFileMetadata` — see the 2026-09-20 correction below), bounded/paginated listing,
resumable-upload infrastructure, upload-completion verification, and a real cleanup
guarantee for the smoke test's own disposable file. 342 mocked unit tests total across the
whole suite (87 from the original Phase 6 pass + 17 from the correction pass) prove all of
the above against a simulated Drive/OAuth HTTP boundary (`tests/unit/googleDrive/`).

**2026-09-20 correction pass** fixed two real gaps a review found before any real OAuth
credential was introduced: (1) the public `getFileMetadata` had no root-containment check —
fixed, see "Completed work (Phase 6 correction pass, 2026-09-20)" below; (2) the real smoke
test could orphan its own disposable test file on a post-upload failure — fixed with a
provider-injected, fully-tested cleanup guarantee. A third reported issue (an "empty"
`validation.test.ts`) was investigated and found to be a false report — the file already had
9 passing tests covering everything asked for; no change was needed.

**What is NOT yet done, and cannot be done without user action**: no real Google Cloud
project/OAuth client exists yet in this environment, so `npm run google:authorize` has not
been run, `GOOGLE_OAUTH_REFRESH_TOKEN` is empty, and `npm run google:smoke` — the real,
end-to-end connectivity proof the phase brief requires before final completion — has not
been executed against a real Drive account. `GOOGLE_DRIVE_ROOT_FOLDER_ID` is the one Phase 6
variable already set locally (the user supplied the real root folder id; it is in
`.env.local` only, never committed). See "User inputs needed" below for the exact remaining
steps — all non-secret actions the user (not this agent) must perform.

## Full phase plan (for reference — do not execute ahead of approval)

| Phase | Name | Status |
|---|---|---|
| 0 | Repository inspection + architecture | Complete (approved) |
| 1 | Foundation + design system + access | Complete (approved), branding applied 2026-09-14 |
| 2 | Mock library + Find a Book | Complete (approved), visual/mobile revision 2026-09-14 |
| 3 | Voice + reading lists + guide | Complete (approved) |
| 4 | Real database | Complete (approved) |
| 5 | Real search architecture | Complete (approved), real-provider validation 2026-09-17 |
| 6 | Google Drive connection | **Implementation complete — see "Current phase" for the one open item (real Google validation)** |
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
  **Real semantic-quality validation performed 2026-09-17** — see the dedicated section below.
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

## Completed work (Phase 5 correction pass, 2026-09-17)

A bounded correction pass fixing four material acceptance gaps a reviewer found in commit
`d5648e3`, plus two adjacent issues the same review exposed. No Phase 6 work; no Find UI
redesign. Full detail in `docs/SEARCH.md`, `docs/DECISIONS.md`, and `docs/CHANGELOG.md`.

1. **Safe upgrade of an existing Phase 4 database.** `rebuildSearchText()`
   (`lib/search/searchTextMaintenance.ts`) reuses `buildSearchIndexText()` — the exact function
   `seed.ts` already uses — against `DrizzleBookRepository`'s real relational projection, and is
   called automatically by `db:migrate` right after the schema migrations, scoped to rows a
   schema change actually left with a NULL `search_text`. A from-zero database finds nothing to
   backfill; a populated one gets every existing book backfilled as part of the same command
   that's already the documented upgrade step. A separate `npm run search:rebuild-text` command
   handles the ongoing-maintenance case (a metadata edit/import), explicitly distinct from
   embedding generation. Proven end to end by `tests/integration/db/migrationUpgrade.test.ts`: a
   database is brought to exactly the Phase 4 schema state with real relational data, the real
   Phase 5 migrations are applied, `search_text` is confirmed NULL immediately after (reproducing
   the bug) then correctly backfilled and genuinely full-text-searchable, backfilling twice is a
   no-op, the book's id/copies/Reading List reference all survive unchanged, and editing the
   book afterward both updates conventional search and makes a stored embedding's source hash
   detectably stale.
2. **Real server-side pagination for filter-only browsing.** Two new `SearchRepository` methods,
   `findVisibleBookIdsPage` (`ORDER BY sort_title LIMIT (limit + 1)`, no `OFFSET` — an increasing
   bounded limit, matching the with-query path's own model) and `countVisibleBooks` (a real exact
   `COUNT(*)`), replace the previous "fetch every match, sort in memory, then slice" queryless
   path. Proven at a 300-synthetic-row scale (`tests/integration/db/boundedPagination.test.ts`)
   with a `vi.spyOn` assertion that a 5-result page (and a 15-result "Show More" page) each
   project only that many books, never all 300. `SearchResultPage.totalQualifying`'s doc comment
   now explicitly distinguishes this exact count from the free-text path's bounded-candidate-pool
   count, per the brief's own requirement not to call a capped number a complete catalog count
   without qualification.
3. **Complete database-backed autocomplete.** `SearchRepository.autocomplete()` now queries tags/
   topics (scoped to visible books via `book_tags`) and languages (matched by display name from
   the centralized ISO 639-1 registry, against the small, visibility-scoped, primary-OR-
   additional set of codes actually in use) — `AutocompleteRow`'s type always declared these,
   nothing ever produced them until now. Repository-level tests prove a pending-only tag/language
   never surfaces and an additional-language-only value still does; action-level tests prove the
   ordering logic handles them; a UI-level test proves the "Topic"/"Language" labels actually
   render.
4. **Expanded the search evaluation suite from 13 to 41 cases**, reported per-category
   (known_item/structured/safety/exploratory) with a new top-5 metric alongside recall/top-1/
   prohibited-violations. Added: ISBN-10/13 cases (two real ISBNs added to two real fixture
   books, since none existed in the seed at all before), a diacritics case, ranked-filter-
   combination cases, incomplete-metadata-never-satisfies-a-filter cases, a hard-filter-vs-
   thematic-relevance dominance case, and two explicitly labeled development-only fixtures
   (inserted/removed by the evaluation harness itself) for two exploratory themes the real
   catalog has no credible match for. **41/41 cases pass.**
5. **Normalized-matching audit**: found and fixed a real mismatch — the exact-title candidate
   query compared a bare `trimmed.toLowerCase()` against a canonically-normalized (article-
   stripped, diacritic-stripped) stored value, so a query retyped with its own leading article
   never exact-matched. Fixed by exporting the one `normalizeTitle()` function and using it on
   both sides. **Deterministic-intent audit**: every documented phrasing (age ranges, fiction/
   nonfiction, format/category names, illustration styles) was verified to already work
   correctly; added the test coverage that was missing (`tests/unit/search/intent.test.ts`, new
   `rank.test.ts` cases) and an explicit hard-constraint/strong-structured-fit/soft-preference
   classification in `docs/SEARCH.md` §2.
6. **Explicit asymmetric retrieval input contract for the Gemini adapter.** `embedQuery`/
   `embedDocuments` previously sent identical, unlabeled text. Implemented `gemini-embedding-2`'s
   documented text-prefix convention (`"task: search result | query: …"` for queries,
   `"title: none | text: …"` for documents) — sourced from Google's current documentation, **not
   independently verified against a live API call** (no `GEMINI_API_KEY` in this environment).
   `EMBEDDING_COMPOSITION_VERSION` bumped 1 → 2 so any hypothetical existing embedding is
   detectably stale. Proven only that the contract is applied (`tests/unit/embeddings/
   geminiProvider.test.ts`, mocked `fetch`) — never claimed as a semantic-quality improvement.
7. Test counts: 231 unit (was 204), 68 integration (was 50), 41 evaluation cases (was 13), 103
   E2E (unchanged, all still passing). Full quality gate (typecheck, lint, `db:check`, unit,
   integration, evaluation, build, E2E both projects) re-run clean.

## Completed work (Phase 5 real-provider validation, 2026-09-17)

With a real `GEMINI_API_KEY` available in the local environment for the first time, this pass
performed the validation the correction pass above could not: live provider testing, real
embedding generation, real hybrid evaluation, and manual product verification. **No secret was
ever printed, logged, or committed** — only its presence was confirmed (`grep -c`, never the
value), and `.env.local` was independently confirmed gitignored and untracked throughout.

1. **Live provider contract, confirmed against a real API call.** `embedContent` and
   `batchEmbedContents` both succeed; every embedding has exactly 768 finite values; the
   asymmetric query/document prefix contract (documented but previously unverified) is genuinely
   accepted, confirmed by a real 0.98 cosine similarity between the two formattings of the same
   underlying text (related but not identical, as intended). No adapter contract change was
   needed — only a new robustness gap the live testing itself exposed: real, reproducible
   `HTTP 429` responses under repeated calls, fixed with bounded retry-with-backoff
   (`fetchWithRetry`, `geminiProvider.ts`; 4 new unit tests).
2. **Real embeddings generated for the full active development catalog**: 49/49 succeeded
   (composition version 2), correct metadata verified per row (model/dimension/version/hash/
   timestamp), pending/archived books confirmed untouched, a repeated run is a clean no-op, and a
   live edit → rebuild → restore cycle on one book correctly flagged it stale and then correctly
   cleared once restored.
3. **Real hybrid evaluation.** The evaluation harness's own `beforeAll` now generates real
   embeddings for that run's seeded+fixture books when a key is present; at least one fully clean
   run (0 embedding failures, before the two ranking fixes below) reproduced the full 34/34
   recall, 9/9 top-1, 1/1 top-5, 0/41 violations result under genuine real-hybrid conditions —
   proving the real-embeddings-in-the-loop mechanism itself works end to end, not merely that the
   harness's code compiles. **A real, sustained provider rate limit** (most likely a daily quota
   exhausted by this session's own cumulative live-call testing — an 8-minute wait produced no
   improvement) prevented obtaining one further fully-clean automated run *after* the two ranking
   fixes below; those fixes are instead independently validated by direct SQL cosine-distance
   measurement against the real, persisted development-catalog embeddings, by unit tests, and by
   live product screenshots (below) — real evidence, just from a different source than the
   harness's own regenerated run.
4. **Two real product bugs found from live evidence and fixed:**
   - The semantic meaningful-distance ceiling (`MAX_MEANINGFUL_VECTOR_DISTANCE`,
     `hybridScore.ts`) went from the inert placeholder `1` → `0.36` (from one query's real
     distances) → **`0.30`** (from three real queries' distances, after `0.36` was itself caught
     letting 31/49 catalog books clear it for a known-item query — visible directly as "35
     matches" for a single-title lookup).
   - "very" (a substring of "every"/"everyday") was falsely triggering tag/description keyword
     matches — fixed by adding it to `STOP_WORDS`, the same fix class as the pre-existing "age"
     (inside "courage"). A related "day" (inside "everyday") collision, specific to
     category/format matching, was fixed with a new whole-word matcher used only for those two
     fields.
   Full measurement and rationale: `docs/SEARCH.md` §5/§9, `docs/DECISIONS.md`.
5. **Manual product verification** with real embeddings present, at desktop (1440×900) and mobile
   (390×844): a known-item query now returns exactly its one correct match with zero semantic
   noise; a structured multi-constraint query (animals + age 4) returns genuinely on-topic
   results; three exploratory queries (winter atmosphere, gentle goodbye, starting-school anxiety)
   return grounded, teacher-readable explanations with no AI/vector/embedding language anywhere in
   the UI; autocomplete triggers zero calls to the embedding provider while typing (verified via
   network-request interception); zero browser console errors on both viewports. The
   starting-school-anxiety query is honestly weaker — the real development catalog has no
   genuinely on-theme book for it (only the evaluation harness's own fixture data does), so its
   real top results are weak, generic-word-driven matches, not fabricated as a false success.
   Screenshots: `docs/screenshots/real-provider-validation/`.
6. A pre-existing, unrelated React hydration-mismatch warning was observed intermittently in
   Next.js's dev-mode overlay, traced to `SearchInput.tsx`'s voice-button conditional
   (`showVoiceButton`, depending on `useVoiceSearch()`'s client-only feature detection) — present
   since Phase 3 (commit `ca33303`), unrelated to search/embeddings, and not touched by this pass;
   noted here rather than silently ignored.
7. Test counts: 238 unit (was 231, +7: 4 retry-on-429 cases, 1 hybrid-score boundary case, 2
   substring-collision regression cases), 68 integration (unchanged), 41 evaluation cases
   (unchanged count, now genuinely exercised in real-hybrid mode when a key is present), 103 E2E
   (unchanged count; one test's locator was tightened to `exact: true` after real embeddings
   changed result ordering enough to expose a pre-existing selector ambiguity — not a product
   bug). Full quality gate re-run clean: `db:check`, typecheck, lint, unit, integration, build,
   E2E (both projects).

## Completed work (Phase 6, 2026-09-18)

See `docs/GOOGLE_INTEGRATION.md` for the full architecture and `docs/DECISIONS.md` for the
OAuth-vs-service-account and provider-boundary reasoning. Starting commit:
`88b02752363649c297b6e6f3e38202cee2e51a6a` (approved Phase 5).

1. **`CoverStorageProvider` abstraction + `GoogleDriveCoverStorageProvider`**
   (`src/lib/googleDrive/`) — mirrors `src/lib/embeddings/`'s already-proven three-part shape
   (`provider.ts` interface+errors, `googleDriveProvider.ts` concrete implementation,
   `index.ts` the one `server-only` production factory). Methods: `verifyConnection`,
   `listChildren` (bounded, paginated), `getFileMetadata`, `downloadSource`,
   `initiateResumableUpload`, `confirmUploadedFile`, `trashFile` (test/smoke-only cleanup).
2. **Server-side OAuth token management** (`oauthClient.ts`) — exchanges the durable refresh
   token for short-lived access tokens, caches in memory until shortly before expiry,
   transparently refreshes, works correctly across serverless cold starts. Never persists an
   access token anywhere but memory.
3. **Root-folder security boundary** (`rootContainment.ts`) — a pure, independently-testable
   ancestry-walk algorithm (cycle-guarded, depth-bounded at 20 levels) proving any candidate
   file/folder is the configured `GOOGLE_DRIVE_ROOT_FOLDER_ID` or a real descendant of it
   before any operation may touch it. Enforced by every provider method that accepts a
   folder/file id.
4. **My Drive / Shared Drive compatibility** — every relevant request sends
   `supportsAllDrives=true`; listing also sends `includeItemsFromAllDrives=true`.
   `verifyConnection()` reports whether the root belongs to a Shared Drive. No
   `corpora=allDrives` broad search anywhere — the root id is known configuration, never
   discovered by searching.
5. **Resumable upload infrastructure for the future Phase 7 browser-upload flow** —
   `initiateResumableUpload()` validates MIME type/size/filename/parent server-side, then
   returns only the resumable session URI (never OAuth credentials) for a future browser to
   upload bytes to directly. `confirmUploadedFile()` always re-fetches from Drive to verify
   parent/MIME/size/filename before the caller may treat an upload as complete — never trusts
   caller-supplied metadata.
6. **Normalized error model** — one `DriveProviderError` class with a `category` discriminant
   covering all 13 categories the phase brief specifies (`configuration_missing` through
   `unexpected_provider_failure`). No thrown message ever contains a token, client secret, or
   raw Google response body — asserted directly by dedicated secret-safety tests.
7. **Bounded retry with backoff** (`retry.ts`) — retries only 429/500/502/503/504 and
   network-level failures, up to 3 retries with jittered exponential backoff, honoring a
   numeric `Retry-After` header. A deliberately separate helper from
   `embeddings/geminiProvider.ts`'s own retry logic (different timing needs, not a shared
   abstraction forced to fit both).
8. **Source-cover validation** (`validation.ts`) — the 5 documented storage MIME types
   (`image/jpeg`/`png`/`webp`/`heic`/`heif`), a 25 MiB size ceiling, and filename
   normalization that strips path separators/control characters without ever renaming an
   *existing* Drive photo.
9. **`npm run google:authorize`** (`scripts/google/authorize.ts`) — a local, interactive,
   one-time OAuth setup helper: starts a temporary localhost callback server, generates and
   validates a random `state`, exchanges the authorization code for a refresh token, and
   saves it into `.env.local` without ever printing it. Never a production route.
10. **`npm run google:smoke`** (`scripts/google/smoke.ts`) — the real, opt-in, credential-gated
    connectivity proof (steps A–G of the phase brief): connection, bounded metadata listing,
    a disposable synthetic-PNG upload (generated in memory, real CRC32-correct PNG chunks,
    never a committed binary), server-side confirmation, download + byte-for-byte comparison,
    self-cleanup (trashes only its own file, after re-verifying id/filename-prefix/root), and
    a final re-listing proving every pre-existing child id survived unchanged.
11. **No database migration** — `books.cover_drive_*`/`ingestion_items.drive_file_id` already
    existed from the Phase 0 schema review; Phase 6 introduces no new table and no
    OAuth/token table (credentials live in environment/deployment secret configuration only).
12. **No regression to Phase 5** — search scoring, query parsing, FTS, trigram, pgvector,
    Gemini embeddings, autocomplete, Find UI, voice search, Book Detail, and Reading Lists are
    untouched; the full existing quality gate was re-run clean (see "Testing performed" in the
    phase report).
13. Test counts: 87 new unit tests across 6 files (`tests/unit/googleDrive/`), all mocked at
    the HTTP boundary — 325 unit total (was 238), 68 integration (unchanged), 41 evaluation
    cases (unchanged), 103 E2E (unchanged).

## Completed work (Phase 6 correction pass, 2026-09-20)

A small, bounded correction pass, before real OAuth credentials were ever introduced. Full
detail in `docs/DECISIONS.md`; test detail in `docs/TESTING.md`.

1. **Root-scoped the public `getFileMetadata(fileId)`** — it previously had no
   root-containment check at all, unlike every other provider method, making it a real
   escape hatch for arbitrary Drive metadata access. Fixed by splitting it into a private
   `fetchRawMetadata` (unscoped, used internally by containment logic itself and by
   `verifyConnection()` for the root's own metadata) and a public `getFileMetadata` that
   enforces containment before returning anything. `downloadSource`,
   `initiateResumableUpload`, and `confirmUploadedFile` simplified accordingly (they no
   longer need their own separate containment call). 6 new tests.
2. **Gave the real smoke test a genuine cleanup guarantee.** Previously, any failure after
   Step C's upload (confirmation, download, or a Step F/G safety check) called
   `process.exit(1)` directly and left the disposable test file orphaned in the real
   configured root. Extracted the orchestration into a pure, provider-injected function
   (`scripts/google/smokeOrchestration.ts`) that always attempts cleanup once a real file
   exists and reports a cleanup failure separately from the original validation failure —
   proven by 11 new tests against an in-memory fake provider, no real credentials needed.
3. **Investigated the reported "empty `validation.test.ts`" and found it was not empty** —
   9 tests already covered every MIME/size/filename case asked for. No change made; see
   `docs/DECISIONS.md` for the verification.
4. Test counts: 342 unit total (was 325, +17: 6 root-scoping tests, 11 orchestration tests),
   68 integration (unchanged), 41 evaluation cases (unchanged), 103 E2E (unchanged). No
   database migration, no OAuth setup, no real Google validation performed in this pass —
   out of scope per the correction brief.

## In-progress / not yet done for Phase 6

- **Real Google OAuth setup and `npm run google:smoke`** — blocked on the user performing the
  non-secret setup steps in `docs/GOOGLE_SETUP.md` (Cloud project, OAuth consent screen,
  Web Application client, then `npm run google:authorize`). See "User inputs needed" below
  for the exact remaining steps. Until this runs successfully, Phase 6 cannot be marked fully
  complete per its own acceptance criteria — see "Current phase" above.
- Final git commit and push for this work (see "Git status" below for what was actually done).

## Blocked work

**Real Google Drive validation is blocked on the user completing OAuth Cloud setup** — see
`docs/GOOGLE_SETUP.md` and "User inputs needed" below. Everything that does not require a
real Google credential (the provider abstraction, OAuth token management, root-boundary
enforcement, bounded listing, resumable-upload infrastructure, and all 87 mocked unit tests)
is built, tested, and not blocked.

## Deferred work

Everything in Phases 7–13, by design: a single Add-a-Book flow (Phase 7 will consume Phase 6's
resumable-upload infrastructure), Admin Review + taxonomy tooling, Google Sheets, bulk import,
and the school's final physical taxonomy (still the 8 provisional development categories — see
`docs/PRODUCT_SPEC.md` and `src/lib/catalog/categories.ts`, seed-only source material).

## Pending user inputs

**Resolved 2026-09-14:** the school logo file arrived (`public/brand/logo.png`, real artwork,
wired into `LogoMark`) — see `docs/BRANDING.md` for a measured (not eyeballed) color
discrepancy between the logo's actual pixels and the documented official palette, flagged as
a genuine open question (which should be the "true" reference) rather than resolved by
assumption. Branding is now fully real end to end — nothing placeholder remains.

**Resolved 2026-09-18: the real Google Drive root folder ID was supplied** and is set locally
in `.env.local` as `GOOGLE_DRIVE_ROOT_FOLDER_ID` (never committed, never appears in source or
documentation per the phase brief's own instruction).

**USER INPUT REQUIRED to complete Phase 6** (none of these are secrets to paste into chat —
see `docs/GOOGLE_SETUP.md` for the full walkthrough of each step):

1. Create/select a Google Cloud project belonging to the SSJC Workspace organization.
2. Enable the Google Drive API for that project.
3. Configure the Google Auth Platform / OAuth consent screen with audience = Internal, and
   add the two scopes (`drive.readonly`, `drive.file`).
4. Create an OAuth 2.0 **Web Application** client with redirect URI exactly
   `http://127.0.0.1:53682/oauth2/callback`.
5. Place the resulting client ID/secret into local `.env.local`
   (`GOOGLE_OAUTH_CLIENT_ID`/`GOOGLE_OAUTH_CLIENT_SECRET`).
6. Run `npm run google:authorize` and complete consent in the browser, signed in as the
   intended SSJC Workspace account.
7. Run `npm run google:smoke` and confirm it passes.
8. Report the result (or the exact safe failure category, if any) so this phase's real
   validation section can be completed — see `docs/IMPLEMENTATION_STATUS.md`'s "Current phase."

None of these block anything else:

- Google Sheet for the teacher catalog projection (Phase 9).
- Which AI provider(s) you hold API/billing access to, beyond the Gemini key already
  configured for Phase 5.
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
regression tests.

The 2026-09-17 real-provider validation pass found and fixed three more real bugs — a too-loose
semantic-distance ceiling (recalibrated twice from real measured evidence), a generic-word
substring collision ("very" inside "every"/"everyday"), and no rate-limit handling for the live
Gemini provider — plus tightened one pre-existing E2E locator ambiguity exposed once real
embeddings changed result ordering enough to make it visible. Full detail above and in
`docs/DECISIONS.md`.

Phase 6 found and fixed one real bug during its own mocked-test-writing: the first
implementation of the root-containment check re-fetched a file's own parents even when its
full metadata (including `parents`) had already been fetched moments earlier for another
reason (`downloadSource`, `confirmUploadedFile`, `initiateResumableUpload`'s parent-folder
check) — silently doubling real Drive API calls in production, not just a test artifact.
Fixed with `assertMetadataWithinRoot`, which starts the ancestry walk from metadata already
in hand. See `docs/DECISIONS.md`. No known open bugs.

## Environment variables

Phase 1's four (`STAFF_PASSWORD_HASH`, `ADMIN_PASSWORD_HASH`, `SESSION_SECRET`, optional
`SESSION_COOKIE_SECURE`), Phase 4's four database variables (`DATABASE_URL`,
`DATABASE_MIGRATION_URL`, `TEST_DATABASE_URL`, `E2E_DATABASE_URL`), and Phase 5's
`GEMINI_API_KEY` are unchanged — documented in `docs/DATABASE_SETUP.md` and `.env.example`; no
values recorded here. **Phase 6 adds four optional variables**: `GOOGLE_OAUTH_CLIENT_ID`,
`GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REFRESH_TOKEN`, `GOOGLE_DRIVE_ROOT_FOLDER_ID` — see
`docs/GOOGLE_SETUP.md`. **Current state in this environment**: `GOOGLE_DRIVE_ROOT_FOLDER_ID` is
set (the user supplied the real value 2026-09-18); the other three are still empty pending the
user's OAuth Cloud setup (see "User inputs needed" above). Nothing else in the app depends on
any of these four — every existing feature works identically whether or not Drive is
configured.

## Migrations

**Real now.** Committed SQL migration files live under `drizzle/`, generated from
`src/db/schema/` via `npm run db:generate` and applied via `npm run db:migrate` — never
`drizzle-kit push` against a shared environment. `src/lib/catalog/fixtures.ts` is retained as
seed/test source material only, converted into seed data by `src/db/seed.ts`; no production
code path imports it directly anymore.
`LocalStorageReadingListRepository`'s replacement, `DrizzleReadingListRepository`, is wired in
at `ReadingListsProvider`'s single construction point, exactly as Phase 3 designed the seam.
**Phase 5 adds two migrations**: `drizzle/0001_mighty_war_machine.sql` (enables the `vector` and
`pg_trgm` Postgres extensions, converts `read_duration_band` to a generated column, adds
`search_text`/`search_vector` (generated) and the `embedding*` columns) and
`drizzle/0002_flimsy_goliath.sql` (correction pass: corrects the trigram index to target
`books.title`/`contributors.name`, the columns actually queried, instead of the unused
`search_text` index). The approved Phase 4 migration (`0000_...`) is untouched by either. The
correction pass adds no third migration file — an existing-database upgrade's `search_text`
backfill is instead handled by a script folded into `db:migrate` itself, a deliberate choice
explained in `docs/DECISIONS.md`. **Phase 6 adds no migration at all** — `books.cover_drive_*`
and `ingestion_items.drive_file_id` already existed from the Phase 0 schema review; OAuth
credentials live in environment/deployment secrets, never PostgreSQL. See
`docs/DATABASE_SETUP.md` for the full command reference, including pgvector-capable local
setup.

## External services

A local, disposable PostgreSQL 16 instance (three databases: dev/test/e2e), now with the
`vector` and `pg_trgm` extensions enabled — still not actually external (see
`docs/DATABASE_SETUP.md`). Voice search still talks only to the browser's own built-in speech
recognition. **Optionally, Google's Gemini embedding API** (`gemini-embedding-2`) when
`GEMINI_API_KEY` is configured — configured in this environment as of 2026-09-17 and live-tested
(see "Completed work (Phase 5 real-provider validation)" above); search still works completely
without it if the key is removed. **Phase 6 adds the Google Drive API** as a connected external
service, once OAuth setup completes (`docs/GOOGLE_SETUP.md`) — not yet live-validated in this
environment; see "Current phase" above and `docs/COSTS.md` for the cost picture. No Supabase or
Sheets service is connected.

## Git status

Repository is linked to `github.com/Shirin-Maleki/ssjc-library` (`origin`, `main`). Phase 5 —
including its real-provider validation pass — is approved as of commit
`88b02752363649c297b6e6f3e38202cee2e51a6a`. The original Phase 6 implementation was committed
as `ab515aae0d321464154c444c8fe2f534c0ec636a`. This correction pass's work is committed and
pushed on top of that commit — see the final report for the exact commit SHA and push
confirmation.

## Next recommended task

Complete the "User inputs needed" checklist above (Google Cloud OAuth setup), then run
`npm run google:smoke` and report the result so Phase 6's real-validation section can be
completed. Phase 7 (single Add-a-Book flow) must not begin until Phase 6 — including real
Google validation — is explicitly approved.
