# Implementation Status

Last updated: 2026-09-23 (Phase 9 — Google Sheets + Bulk Import Infrastructure — implemented and
real-validated against the live Google account and the actual SSJC Drive collection; review
pending). This document is continuity insurance — it should always let another coding agent open
this repository cold and know exactly where things stand. Keep it current at the end of every
phase.

## Current phase

**PHASES 0–8 COMPLETE AND APPROVED. PHASE 9 IMPLEMENTED AND REAL-VALIDATED — REVIEW PENDING.**
Phase 9 (Google Sheets + Bulk Import Infrastructure) built both deliverables the revised roadmap
calls for (§2 of this pass's brief): a real, persistent Google Sheets catalog projection, and a
standalone bulk-import CLI/worker reusing the exact Phase 7 pipeline. Both were validated against
real external services in this pass — a real Google Sheet was created and synced for real, and 3
real photographs from the actual configured SSJC Drive collection were downloaded, identified via
real Gemini calls, reconciled against real Open Library data, and saved as 3 real active catalog
books, found again through Find's own real full-text search query. See "Completed work (Phase 9 —
Google Sheets + Bulk Import Infrastructure)" below for exactly what shipped and the full real
validation record. **The full ~1,500-image collection was NOT processed** — only 3 real images, a
deliberately bounded validation sample, per this pass's explicit instruction.

Phase 8 (Admin Review + Taxonomy, including its correction pass and final closure pass) remains
complete and approved as of closure-pass commit `c0c95b4700ac5114cdc71e16d918cefe09505028` — the
reviewed starting point for Phase 9. Phase 7 (Add a Book, including its correction pass, final
closure pass, real cover-recognition correction, HEIC rotation-hint/vision-failure-classification
follow-up, and AI-first catalog draft correction) is likewise complete and approved. See "Completed
work (Phase 7, 2026-09-20/21)" through "Completed work (Phase 7 AI-first catalog draft correction,
2026-09-21)," and "Completed work (Phase 8 — Admin Review + Taxonomy)" through "Completed work
(Phase 8 final closure pass — 2026-09-22)," below for exactly what shipped in each. Phase 7's real
Google Books validation and a fresh live Gemini call against real HEIC bytes remain the only
genuinely open, non-blocking items from that phase; they did not block Phase 7's, 8's, or 9's
approval.

**Phase 10 (Real Collection Import + Taxonomy Finalization) has not started, and must not begin
until the driver thread explicitly decides to start it — and must not need a new importer or a new
Sheets sync architecture when it does** (§48 of the Phase 9 brief: Phase 9 is meant to leave Phase
10 able to grow the sample size and finalize taxonomy using the SAME infrastructure). Phase 6
(Google Drive connection, including its 2026-09-20 correction pass) and Phase 5 (real search
architecture, including its real-provider validation pass) remain complete and approved —
approved as of commit `88b02752363649c297b6e6f3e38202cee2e51a6a` (Phase 5) and
`3fc48d4c4961d71308f5de9b098c18413ad99db4` (Phase 6).

Phase 6 established the OAuth-authorized Google Drive infrastructure that later phases (7: Add
Book intake; 10: bulk import) will build on — see `docs/GOOGLE_INTEGRATION.md` for the full
architecture and `docs/GOOGLE_SETUP.md` for setup. Everything is built and now real-validated:
the `CoverStorageProvider` abstraction and its concrete `GoogleDriveCoverStorageProvider`,
server-side OAuth token management, the root-folder security boundary (enforced on every
method, including `getFileMetadata` — see the 2026-09-20 code-safety correction), bounded/
paginated listing, resumable-upload infrastructure, upload-completion verification, and a real
cleanup guarantee for the smoke test's own disposable file. 342 mocked unit tests across the
whole suite prove all of the above against a simulated Drive/OAuth HTTP boundary
(`tests/unit/googleDrive/`), and `npm run google:smoke` has now proven the same mechanism
against the real, configured Drive folder — see "Real Google validation, 2026-09-20" below for
the full evidence.

**2026-09-20 code-safety correction pass** (before real OAuth was authorized) fixed two real
gaps a review found: (1) the public `getFileMetadata` had no root-containment check — fixed,
see "Completed work (Phase 6 correction pass, 2026-09-20)" below; (2) the real smoke test could
orphan its own disposable test file on a post-upload failure — fixed with a provider-injected,
fully-tested cleanup guarantee. A third reported issue (an "empty" `validation.test.ts`) was
investigated and found to be a false report — the file already had 9 passing tests covering
everything asked for; no change was needed.

## Real Google validation, 2026-09-20

`npm run google:smoke` was run against the real, configured SSJC Drive folder and **passed
end to end**. Full transcript:

```
=== Step A ===
[A] Connected. Root folder: "Corridor books" (1FauwOR6x9IfGT0ToZXBi4CoXuVMi5wXZ)
[A] Shared Drive: no (My Drive)
[A] Can create children under root: true

=== Step B ===
[B] Root has 3 immediate non-trashed child item(s) (this page).
[B]   - [folder] "Shirin" (1Nbycud7K69fHGsQDhTOg11Ii0arboZMH)
[B]   - [folder] "Diamond " (1SaShMDITS2CoOC1w37gjpxvF-r6tJ-0Y)
[B]   - [folder] "Ray" (1D_jnpMWR86D5ZsLFVw9F-VpMR-uoJOsj)
[B]   Sampled "Shirin": 3 item(s) in a bounded 3-item page (not processed).
[B]   Sampled "Diamond ": 3 item(s) in a bounded 3-item page (not processed).
[B]   Sampled "Ray": 3 item(s) in a bounded 3-item page (not processed).

=== Step C ===
[C] Generated a 69-byte synthetic PNG named "__ssjc_phase6_smoke_1789951871387.png".
[C] Resumable upload session initiated (session URI withheld from all output, as designed).
[C] Upload complete. Real Drive file ID: 1IhZKhQ0_M5_q6V2oU8idYpAX8uymGCr7

=== Step D ===
[D] Confirmed: parent, MIME type, size, and filename all match. Checksum: a1cf09b59e5060f3beccdcf7a37189f0

=== Step E ===
[E] Downloaded 69 bytes. Byte-for-byte match with the original synthetic PNG: true.

=== Step F ===
[F] Trashed the disposable test file (1IhZKhQ0_M5_q6V2oU8idYpAX8uymGCr7). Nothing else was touched.

=== Step G ===
[G] Pre-existing child count: 3. Post-cleanup child count: 3.
[G] Every pre-existing child id still present: true.
[G] Disposable test file no longer listed (trashed): true.

existing library assets modified: NO
```

The configured root is a real, named folder ("Corridor books") in **My Drive, not a Shared
Drive**. The three pre-existing photographer folders (`Shirin`, `Diamond `, `Ray`) were all
accessible and all still present, unchanged, after the test — confirmed by comparing pre- and
post-cleanup child id lists, not merely by name. Only bounded metadata samples (3 items per
folder) were read; no existing photograph was downloaded, processed, or altered. Google issued
a real Drive file id for the disposable upload, returned a real MD5 checksum on confirmation,
and the downloaded bytes matched the uploaded ones exactly. The disposable test file was
trashed (never permanently deleted) and confirmed gone from the listing afterward.

**Credential context, recorded accurately:** the Google Cloud project performing this
authorization is under the requester's **personal Gmail account**, not the SSJC Google
Workspace organization — the SSJC Workspace account itself could not complete OAuth
authorization because Workspace policy currently blocks third-party OAuth app authorization
pending admin review. No SSJC Workspace admin setting was changed to work around this. The
real, existing SSJC Drive folder ("Corridor books") was shared to that personal Gmail account
with sufficient access (read + write) for this authorization to reach it — the folder itself,
its three subfolders, and their contents remain wherever they actually live in Drive; nothing
was moved. This does not change teacher-facing authentication in any way: SSJC staff still sign
in with the existing shared staff password (`docs/SECURITY.md`), and no teacher Google login
was added or is planned.

**Current production limitation, stated plainly:** the OAuth consent screen for this
integration is currently configured as **External + Testing** in Google Cloud, not Internal —
a direct consequence of the Workspace-account block above. This is sufficient to prove Phase 6
real validation (this smoke test), but a Testing-mode OAuth app's refresh-token authorization
is **not a permanent production credential strategy** — Google's Testing mode has its own
constraints (e.g. a limited test-user list, and consent screens Google may periodically require
re-verifying). **Real production OAuth longevity is not solved by this validation** and remains
an open decision for whoever deploys this to production — options include getting the SSJC
Workspace admin review completed so the app can run as Internal, or verifying the External app
for production use. This is a deployment/security decision for a later phase, not a Phase 6
architecture problem — nothing about `CoverStorageProvider`, the OAuth token-exchange
mechanism, or the root-containment boundary depends on which of those two paths is eventually
chosen.

`.env.local` (gitignored, unmodified by this documentation pass) holds the real
`GOOGLE_OAUTH_CLIENT_ID`/`GOOGLE_OAUTH_CLIENT_SECRET`/`GOOGLE_OAUTH_REFRESH_TOKEN`/
`GOOGLE_DRIVE_ROOT_FOLDER_ID` used for this run. No client secret, refresh token, access token,
authorization code, resumable session URI, or credential JSON appears anywhere in this
repository — verified directly (see "Security review" in this pass's report).

## Full phase plan (for reference — do not execute ahead of approval)

**Revised roadmap (as of Phase 9)** — the original 13-phase plan's remaining five phases
(9: Sheets, 10: bulk import engine, 11: taxonomy research batch, 12: full import, 13:
hardening/QA/deployment) were consolidated into two, reflecting what actually needed
building versus what turned out to be sequencing detail within one real deliverable. Any
older document or comment still referencing "Phase 10 bulk import engine," "Phase 11
taxonomy research batch," "Phase 12 full import," or "Phase 13 hardening" by that old
numbering is describing this same consolidated work under the table below, not a
separate future phase — read historical mentions of those names as pointing here.

| Phase | Name | Status |
|---|---|---|
| 0 | Repository inspection + architecture | Complete (approved) |
| 1 | Foundation + design system + access | Complete (approved), branding applied 2026-09-14 |
| 2 | Mock library + Find a Book | Complete (approved), visual/mobile revision 2026-09-14 |
| 3 | Voice + reading lists + guide | Complete (approved) |
| 4 | Real database | Complete (approved) |
| 5 | Real search architecture | Complete (approved), real-provider validation 2026-09-17 |
| 6 | Google Drive connection | **Complete — real Google Drive validation passed 2026-09-20** |
| 7 | Single Add-a-Book flow | **Complete (approved)** — correction pass, final closure pass, cover-recognition correction, HEIC follow-up, and AI-first catalog draft correction all applied |
| 8 | Admin review + taxonomy | **Complete (approved)** — correction pass and final closure pass both applied |
| 9 | Google Sheets + Bulk Import Infrastructure | **Complete — real Google Sheets and real Drive/Gemini bulk-import validation both passed 2026-09-23** (see "Completed work (Phase 9...)" below) |
| 10 | Real Collection Import + Taxonomy Finalization | Not started |
| 11 | Final UI/UX Polish + QA + Deployment | Not started |

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

## Completed work (Phase 7, 2026-09-20/21)

The full single Add-a-Book flow — real end to end, from a photographed cover to
a shelved catalog entry. Full technical detail: `docs/AI_PIPELINE.md`; every
architectural decision and its evidence: `docs/DECISIONS.md`; every test:
`docs/TESTING.md`.

1. **Schema**: `provenance_source_type` gains `cover_visible`; `ingestion_items`
   gains `intake_draft` (jsonb, Zod-validated contract). One migration
   (`drizzle/0003_naive_silver_surfer.sql`).
2. **Three new provider boundaries**: `src/lib/ai/` (Gemini vision + enrichment,
   `gemini-3.8-flash`), `src/lib/metadataProviders/` (Google Books + Open
   Library), reusing the existing `src/lib/googleDrive/` boundary from Phase 6.
3. **The full intake domain layer** (`src/lib/intake/`): image prep (real,
   tested HEIC/HEIF passthrough finding), metadata lookup + caching,
   deterministic identity reconciliation, duplicate detection against the real
   catalog, category-suggestion enforcement, the versioned intake draft, and
   transactional persistence (new book / another copy / review later).
4. **A real, significant architecture correction**: the Phase 6-approved
   direct-browser-to-Drive upload was proven, via real Chromium testing, to be
   blocked by Drive's CORS behavior. Corrected to a server-mediated upload
   (`src/app/api/intake/cover/route.ts`, this codebase's first Route Handler) —
   re-validated live afterward. Full evidence in `docs/DECISIONS.md`.
5. **A complete, mobile-first UI** (`src/components/add/`): cover capture,
   staged processing states, duplicate resolution, Quick Edit confirmation
   (including a Format field added after the brief's own spec named it as a
   Quick Edit field but the first implementation pass omitted it), and the
   final shelving-instruction success state.
6. **Test coverage added this phase**: 78 new unit tests (342→420), 14 new
   integration tests against real Postgres (68→82), 12 new E2E tests across
   real Chromium and real WebKit (101→113) — the E2E suite caught and fixed two
   real bugs (a silent no-op on an incomplete save, and a provenance-insert bug
   that violated a real database constraint whenever Quick Edit was opened at
   all). Full breakdown: `docs/TESTING.md`.
7. **Real-provider validation**: the corrected upload architecture was
   validated live twice (once reproducing the real CORS failure, once
   confirming the fix); 5 real photos from the actual SSJC Drive collection
   (explicitly, narrowly approved for this one-time bounded validation) were
   run through the real pipeline — one full success end to end including a
   real transactional save, the rest hitting a real, investigated Gemini daily
   quota limit. Full results and honesty caveats: `docs/AI_PIPELINE.md` §10.
8. **Documentation**: this file, plus `docs/AI_PIPELINE.md` (new),
   `docs/DECISIONS.md`, `docs/SECURITY.md`, `docs/GOOGLE_INTEGRATION.md`,
   `docs/DATA_MODEL.md`, `docs/SEARCH.md`, `docs/ARCHITECTURE.md`,
   `docs/TESTING.md`, `docs/COSTS.md`, `.env.example`, `docs/AGENT_HANDOFF.md`,
   `docs/CHANGELOG.md`.

## Completed work (Phase 7 correction pass, 2026-09-21)

A real implementation review against the pushed repository (commit
`c821a3522a57e09b48ace1b29c5a03439d6d2c95`) found 8 material issues. All 8
fixed, with new regression coverage for each. Full technical detail in each
area's own doc section (`docs/AI_PIPELINE.md`, `docs/DECISIONS.md`,
`docs/GOOGLE_INTEGRATION.md`); commit messages have the complete reasoning.

1. **Deployment-blocking upload size** — the server-mediated upload (from the
   prior pass) POSTed the whole source photo in one request, which would
   exceed Vercel's real 4.5 MB serverless request-body limit for any cover
   over that size (this pipeline allows up to 25 MiB). Replaced with a
   chunked upload (`/api/intake/cover/init` + `/chunk`, <=4 MiB per request,
   Google's own documented resumable-upload Content-Range/308 protocol,
   original bytes preserved). Real-validated with an 11.62 MB file — 3
   chunks, real Drive MD5 checksum matched the local original exactly.
2. **Display cover completed** — was only partially wired (accepted but never
   supplied, never projected by the repository, never rendered).
   `BookCoverSpec` gains `displayUrl`; the repository projects it;
   `BookCover.tsx` renders it (typographic placeholder otherwise); a new
   `selectTrustworthyDisplayCoverUrl` derives it only from a confirmed
   identity's actual selected metadata candidate. Real-validated this pass
   with a live Open Library thumbnail.
3. **Duplicate identity rule made conservative** — title+author+language could
   previously claim `exact_copy_same_edition` with no ISBN at all; different
   editions/translations routinely share all three. Now reserved exclusively
   for a genuine ISBN match.
4. **Duplicate UX / repeated provider calls** — "Different book" previously
   restarted from Gemini vision and metadata lookup (real API cost, unchanged
   evidence). Now preserves existing work and proceeds straight to
   enrichment; the "You photographed: …" text now shows the real identified
   title, never the raw filename.
5. **Terminal action / failure / retry correctness** — Review Later now
   checks its own result instead of always claiming success; a failed
   confirm-save shows inline on the same screen instead of forcing Start
   Over/re-upload; one shared in-flight guard prevents double submission;
   every pipeline stage is independently retryable (a later failure no
   longer re-runs an earlier, already-completed step).
6. **Ingestion job lifecycle** — `saveNewBook`/`addAnotherCopy` now also mark
   the parent `ingestion_jobs` row completed (previously only the item was
   updated, leaving every job permanently `"running"`); Start Over after a
   real upload now best-effort marks the abandoned job/item `"failed"`
   instead of leaving it looking stuck forever.
7. **`book_identity_candidates` operationalized** — every metadata candidate
   considered is now persisted for audit (previously unused by Phase 7),
   replacing rather than appending on retry.
8. **Real-provider validation, round 2** — the original round's rate limit
   was confirmed as a genuine daily quota (reset by this pass, verified with
   a real canary call). A fresh bounded sample of 3 real covers (2 JPEG, 1
   HEIC) found: "The Cat Food Mystery" succeeded through identity/metadata/
   reconciliation/duplicate-check/display-cover selection, but its
   enrichment call specifically hit a real, transient rate limit on this
   attempt (not a full end-to-end success); the HEIC case and "Megan
   Rapinoe" both failed at identification, blocked by a further, real,
   reproducible Gemini capacity constraint on the structured-output path
   despite substantial genuine retry effort. Combined with round 1's one
   genuinely complete case ("Kenny and the Little Kickers," including a
   real save), **1 fully complete real end-to-end case exists across both
   rounds**, reported honestly rather than rounded up — full results:
   `docs/AI_PIPELINE.md` §10b.

**Testing**: 452 unit tests, 92 integration tests, 117 E2E tests (real
Chromium + real WebKit) at the end of this correction pass — all passing.
(A later commit message in this pass's own history stated 462/450, which was
simply wrong; the final closure pass re-ran the suite from a clean state and
found 452, confirming the number in this document, not that commit message —
see "Completed work (Phase 7 final closure pass...)" below for this pass's
own final counts, which differ further because it added new regression
tests of its own.)

## Completed work (Phase 7 final closure pass, 2026-09-21)

A further review against the pushed correction-pass commits
(`2bd73e84ff50abde04dc11c74507fb7f4806f02a`) found one more real identity-
safety gap plus reporting/documentation accuracy issues. All fixed:

1. **Identity-safety fix — ambiguous/unresolved provider metadata no longer
   silently accepted.** `lookupMetadataAction` previously adopted the
   best-*scoring* provider candidate's fields (including ISBN) into
   `proposedBookValues` regardless of reconciliation outcome — an
   `ambiguous` or `unresolved` guess could supply an ISBN that duplicate
   detection would then treat as proof of `exact_copy_same_edition`. The
   acceptance gate is now extracted into a pure, independently unit-tested
   function (`src/lib/intake/candidateAcceptance.ts`,
   `resolveCandidateAcceptance()`): only a `high_confidence` outcome is
   "accepted" and eligible to populate canonical proposed values or
   `book_identity_candidates.was_selected`. Cover-visible evidence remains
   independent of this gate (a teacher can still confirm from cover-visible
   evidence + Quick Edit with no provider metadata at all). 5 new unit
   tests (`candidateAcceptance.test.ts`, cases A/B/D + 1 more) plus 2 new
   integration tests (`identityCandidates.test.ts`'s case C,
   `duplicateMatcher.test.ts`'s case E, the latter proving the legitimate
   high-confidence ISBN path still reaches `exact_copy_same_edition`
   correctly end to end).
2. **Review Later job lifecycle revised** — `saveForReview` now marks the
   parent `ingestion_jobs` row `completed` (previously left `running`
   forever, per the correction pass's own earlier, now-superseded
   reasoning). The automated single-add processing run is what a job
   tracks, and that run is genuinely done; the pending human review belongs
   to the ITEM (`ingestion_items.status = needs_review` with the preserved
   draft), not to the job. No new `ingestion_job_status` value, no workflow
   engine — reuses the existing `completeParentJob()` helper. New/updated
   integration coverage in `persistence.test.ts` proves: job completed with
   coherent `processed_items`/`completed_at`, item `needs_review` with the
   draft preserved, and the resulting `pending_review` book stays excluded
   from normal Find.
3. **Documentation corrected to match the actual final upload
   architecture** — `docs/AI_PIPELINE.md`, `docs/GOOGLE_INTEGRATION.md`,
   `docs/SECURITY.md`, `docs/ARCHITECTURE.md`, and `docs/TESTING.md` all
   still described (or, for `SECURITY.md`, dated itself to) the original
   single-request server-mediated upload or an earlier phase — all updated
   to describe the real chunked `/api/intake/cover/init` +
   `/api/intake/cover/chunk` architecture, the encrypted opaque
   upload-session token, and the real Content-Range/308 resume behavior.
4. **Report/test-count inconsistency fixed** — a prior report said 452 unit
   tests; commit `420980e`'s own message said 462. Re-ran the suite from a
   clean state rather than guessing: 452 was correct at that commit. Also
   corrected imprecise validation wording that called "The Cat Food
   Mystery" a full success when its enrichment call was actually
   rate-limited (a partial success, through duplicate-check only) — see
   `docs/AI_PIPELINE.md` §10b, `docs/COSTS.md`.
5. **One bounded additional real-provider attempt** — 3 real attempts with
   real backoff (0s, 20s, 20s gaps), stopped per the brief's own "don't
   burn quota indefinitely" instruction. No third full case reached, but a
   genuinely new, concrete finding: Google's own error body named the exact
   constraint, `GenerateRequestsPerDayPerProjectPerModel-FreeTier`,
   `quotaValue: 20` — this project's Gemini free tier allows only 20 real
   `gemini-3.8-flash` requests per day, total. Full record:
   `docs/AI_PIPELINE.md` §10c, `docs/COSTS.md`.

**Testing (this pass's own final counts, re-run from a clean state)**: 457
unit tests (was 452), 94 integration tests (was 92), 117 E2E tests
(unchanged) — all passing, real Chromium + real WebKit; `npm run
evaluate:search` also re-run (1/1 passing, no relevance regression).

## Completed work (Phase 7 real cover-recognition correction, 2026-09-21)

A real teacher used the actual Add-a-Book UI, photographed a real book cover,
and got an almost-empty confirmation screen — no title, no author, nothing
useful. This is a genuine Phase 7 acceptance blocker, reproduced from the real,
still-preserved ingestion record rather than asking for the photo again. Full
before/after evidence: `docs/AI_PIPELINE.md` §10d; full technical root-cause
narrative: `docs/DECISIONS.md`.

1. **Root cause found and fixed**: `prepareAnalysisImage()` never called
   `sharp`'s `.rotate()` — the analysis derivative sent to Gemini kept the raw,
   as-captured sensor pixel orientation while the browser's own EXIF-aware
   preview looked correctly upright the whole time. Fixed: `.rotate()` (EXIF
   auto-orientation) now runs before resizing, for every format `sharp` can
   decode. A further real finding: this exact failed photo's own EXIF
   orientation tag did not match its true required correction — auto-
   orientation alone was not enough for this specific file, confirmed by
   testing all four fixed angles against the real raw pixels directly.
2. **Manual rotate control added**: a small, teacher-facing 90°-increment
   rotate affordance on the selected-cover preview (`RotatablePreview`), never
   a photo editor. Applies on top of EXIF auto-orientation, persisted in the
   intake draft so a retry reuses the same correction. Real-verified against
   the exact failed photo: EXIF alone still left it sideways; a further
   manual correction on top produced a fully upright derivative.
3. **HEIC/HEIF handling stays honest**: unchanged passthrough (this `sharp`
   build cannot decode real HEIC), documented as a real limitation rather than
   silently treated as equivalent to the JPEG fix; the more robust vision
   prompt (below) is the real mitigation for that format specifically.
4. **Vision prompt strengthened**: Gemini's cover-identification instruction
   now explicitly covers real phone-photo conditions — arbitrary rotation,
   skew, off-angle shots, background clutter — and walks through isolating
   the front-cover rectangle and mentally re-orienting before reading text.
   The existing evidence boundary (never invent hidden bibliographic fields)
   is unchanged.
5. **Identification failure no longer continues silently**: `AddBookFlow.tsx`
   previously ignored `identifyCoverAction`'s result and always proceeded into
   metadata lookup — the direct cause of the almost-empty confirmation screen.
   It now shows an explicit "We couldn't read this cover clearly." recovery
   screen (never provider/technical language) offering retry, rotate-and-retry,
   choose a different photo, or an explicit manual (Quick Edit) fallback.
6. **Real re-test of the exact failed cover**: the orientation fix was proven
   technically and visually against the real photo (real before/after
   derivatives inspected directly). A live Gemini re-identification could not
   be completed — the real free-tier daily quota (20 requests/day) was already
   exhausted from this same day's earlier real calls, confirmed via a bounded
   3-attempt real retry. The real ingestion record and Drive file were left
   completely untouched for a future retry once quota resets. No AI success is
   claimed for this exact retest.

**Testing (this pass's own final counts)**: 470 unit tests (was 457), 94
integration tests (unchanged), 125 E2E tests (was 117) — all passing, real
Chromium + real WebKit.

## Completed work (Phase 7 HEIC rotation-hint / vision-failure-classification follow-up, 2026-09-21)

Two remaining real-cover issues, fixed before the AI-first correction below:

1. **HEIC/HEIF manual rotation made meaningful.** The rotate control's choice
   could not be physically applied to real HEIC/HEIF bytes (unchanged decode
   limitation) and was previously silently discarded. `resolveRotationHint()`
   (`src/lib/intake/imagePrep.ts`) now turns that into an explicit
   `teacherRotationHintDegrees` field passed to the vision call as structured
   text — never claimed as a physical rotation, always the teacher's own stated
   correction, and the model is told to treat it as stronger evidence than its
   own automatic inference. Never applied when the bytes were already physically
   rotated (JPEG/PNG/WebP) — no regression to that path.
2. **Vision failure classification.** `identifyCoverAction` previously collapsed
   every vision-provider failure (quota exhaustion, rate limit, timeout, a
   genuinely unreadable image) into one identical recovery screen. Extracted
   `classifyVisionFailure()` (`src/lib/intake/visionFailureClassification.ts`,
   pure and unit-testable without a database) into two real teacher-facing
   outcomes: "We couldn't read this cover clearly." (rotate/retry/choose-a-
   different-photo all make sense) vs. "Automatic book recognition is
   temporarily unavailable." (never suggests retaking/rotating — the photo was
   never the problem). Neither ever exposes Gemini, an HTTP status, a quota
   name, or a model identifier.

**Testing**: 486 unit tests (was 470), 94 integration tests (unchanged), 127
E2E tests (was 125) — all passing.

## Completed work (Phase 7 AI-first catalog draft correction, 2026-09-21)

A real teacher's follow-up test succeeded at title/author recognition but the
actual product promise — a substantially prefilled catalog draft, not an
almost-empty confirmation screen — still wasn't met. Diagnosed from the real,
still-present ingestion record (`e0cdf157-ddce-4adc-860f-924292aae279`, "Making
Our Pizza" — real Gemini identify success, `draft.enrichmentSuggestion: null`).
Root cause: the pipeline still made two SEPARATE sequential Gemini calls
(`identifyCover` then, later, `suggestEnrichment`); the first succeeded, the
second silently failed against this project's own measured 20-request/day free
tier and was swallowed with no trace. Full technical account:
`docs/AI_PIPELINE.md` §10e, `docs/DECISIONS.md`.

1. **One combined Gemini call, not two.** `analyzeCover()` replaces
   `identifyCover()` + `suggestEnrichment()` — one multimodal request returns
   both `coverEvidence` (unchanged strict, visible-only contract) and
   `aiSuggestions` (unchanged `EnrichmentSuggestionSchema` shape), validated
   independently so a malformed `aiSuggestions` section can never discard a
   valid `coverEvidence` extraction. Halves the default per-book Gemini call
   count.
2. **A genuinely different standard for `aiSuggestions`.** The system
   instruction now explicitly tells the model it's expected to make a useful
   best-effort catalog suggestion (description, category, age range,
   fiction/nonfiction, format, read-aloud estimate, tags/themes, visual
   style/realism) whenever there's reasonable evidence, rather than defaulting
   to null merely because the cover doesn't literally prove the answer — while
   `coverEvidence`'s strict "never invent a bibliographic fact" rule is
   unchanged. Formalizes a real product-level distinction: verified
   bibliographic facts vs. AI-suggested discovery/teacher metadata (see
   `docs/PRODUCT_SPEC.md` §7, `docs/DECISIONS.md`).
3. **The confirmation screen now shows the AI's work.** Previously hid
   category/age/fiction/format/read-aloud/tags/visual-style even when the draft
   had them. Now shown as compact chips with a subtle "AI prepared this book
   record for you" / "Suggested" framing — never a raw confidence decimal,
   provider id, or provenance structure.
4. **Quick Edit starts from the AI's values, not blank.** A real, reproducible
   bug: `fictionType`/`format`/age fields always initialized empty regardless of
   what the draft already had. Fixed; `description` was also added to the small
   Quick Edit/`TeacherEdits` surface as visible, correctable AI-generated
   content.
5. **Confirming without editing now genuinely persists the AI suggestions** —
   already-correct fallback logic in `confirmSaveAction` simply had nothing to
   fall back to before (`draft.enrichmentSuggestion` was null); now that the
   combined call actually populates it, this works for real. New provenance
   tracking added for `description`/`age_range`/`fiction_status`/`format`/
   `visual_media_type`/`visual_realism` (`ai_inferred` vs. `human_corrected`),
   and a `description` field key added to `TRACKED_METADATA_FIELDS`
   (`src/lib/metadata/fieldRegistry.ts`, a code-only change, no migration).
6. **A second, independent real bug found and fixed**: the teacher's manually
   rotated photo reverted to looking sideways again on the confirmation screen.
   Root cause: a genuine stale-closure bug in `AddBookFlow.tsx`'s multi-step
   async pipeline (a React state update mid-chain doesn't change which function
   references an already-running chain continues to call). Fixed by threading
   the rotation value through the chain as an explicit parameter, exactly like
   `itemId`/`previewUrl` already were. A new shared `SourceCoverPreview`
   component renders the source cover consistently across capture, recovery,
   duplicate-comparison, and confirmation screens — never applied to a
   metadata-provider display cover, which stays a separate, correctly-oriented
   asset.
7. **Real provider context merged without a second AI call.**
   `mergeProviderSubjectsIntoTags()` (`src/lib/intake/enrichmentMerge.ts`) folds
   a high-confidence candidate's real subjects into the AI-suggested tag list —
   real signal, never invented, never a reason to re-call Gemini.
8. **Real acceptance test**: not completed this pass. A single bounded quota
   check confirmed the real daily quota (20/day) was still exhausted — no
   further calls were made. The real ingestion record and Drive file remain
   untouched for a future bounded retry.

**Testing**: 507 unit tests (was 486), 96 integration tests (was 94), 131 E2E
tests (was 127) — all passing.

## In-progress / not yet done for Phase 7

**Not real-tested**: Google Books (no `GOOGLE_BOOKS_API_KEY` was available —
Open Library alone was validated live twice, across both validation rounds,
and is sufficient for metadata lookup to function); a fresh live Gemini
vision call against real HEIC bytes (blocked by a real Gemini free-tier daily
quota — now concretely confirmed at 20 requests/day, see above — across four
separate validation sessions, despite substantial genuine retry effort each
time; the resize-skip/passthrough logic was confirmed correct with 4 real
HEIC files total, and the HEIC input-support claim itself rests on Google's
documentation from implementation-time re-confirmation, not a fresh live
call); a third full real-provider validation case (§8 of the correction pass
and §5 of the final closure pass both asked for 3 full cases; across every
attempt made, only 1 fully complete real end-to-end case exists, plus 1
partial success that reached duplicate-check but not enrichment — both
blocked by the same real, now concretely-quantified rate limit, not by a
code defect); a live re-identification of the real teacher-reported failed
cover after the orientation fix (§10d of `docs/AI_PIPELINE.md` — the fix
itself was proven technically/visually against the real photo, but Gemini's
own text extraction from the corrected derivative was not re-obtained live,
blocked by the same exhausted daily quota; the real ingestion record and
Drive file remain untouched for a future bounded retry); the full real
acceptance test of the new one-combined-call pipeline against the exact real
teacher-tested book (§10e/§12 of the AI-first catalog draft correction —
blocked by the same confirmed-still-exhausted daily quota as of this pass's
own bounded check; the real ingestion record and Drive file remain untouched).
All recorded honestly in `docs/AI_PIPELINE.md` §10/§10b/§10c/§10d/§10e and
`docs/COSTS.md`, not glossed over.

**Not built, by explicit design** (per the phase brief's own exclusions): no
processing of the existing ~1,500-photo collection, no Phase 8 Admin Review
interface, no taxonomy-management UI, no Google Sheets/Sheet sync, no
generalized workflow engine, no new display-image storage service (display
cover uses a verified provider thumbnail URL or the existing placeholder — no
new architecture).

## In-progress / not yet done for Phase 6

None. Real Google OAuth setup was completed (via a personal Gmail account — see "Real Google
validation, 2026-09-20" above for why) and `npm run google:smoke` passed against the real
configured Drive folder. Phase 6 is complete per its own acceptance criteria. (Phase 7 built
directly on this infrastructure — see "Completed work (Phase 7...)" above for what changed,
including the one architectural correction to the upload mechanism Phase 6 designed.)

## Blocked work

None. Real Google Drive validation, previously blocked on OAuth Cloud setup, was completed
2026-09-20 — see "Real Google validation, 2026-09-20" above. The one standing limitation (the
OAuth app runs in External + Testing mode, not a finalized production credential strategy) is
a deployment/security decision for a later phase, not a blocker on Phase 6 or 7 — see that
section for the full explanation.

## Deferred work

Everything in Phases 8–13, by design, remains deferred: the Phase 8 Admin Review interface +
taxonomy tooling, Google Sheets, bulk import of the existing ~1,500-photo collection, and the
school's final physical taxonomy (still the 8 provisional development categories — see
`docs/PRODUCT_SPEC.md` and `src/lib/catalog/categories.ts`, seed-only source material). Phase
7 (single Add-a-Book flow) is now complete — see "Completed work (Phase 7...)" above.

## Pending user inputs

**Resolved 2026-09-14:** the school logo file arrived (`public/brand/logo.png`, real artwork,
wired into `LogoMark`) — see `docs/BRANDING.md` for a measured (not eyeballed) color
discrepancy between the logo's actual pixels and the documented official palette, flagged as
a genuine open question (which should be the "true" reference) rather than resolved by
assumption. Branding is now fully real end to end — nothing placeholder remains.

**Resolved 2026-09-18: the real Google Drive root folder ID was supplied** and is set locally
in `.env.local` as `GOOGLE_DRIVE_ROOT_FOLDER_ID` (never committed, never appears in source or
documentation per the phase brief's own instruction).

**Resolved 2026-09-20: real Google OAuth setup and `npm run google:smoke` are both complete.**
The originally-planned path (an SSJC Workspace account authorizing directly) was blocked by
Workspace policy on third-party OAuth apps pending admin review — no workaround or admin
setting was changed to route around this. Instead, a Google Cloud project under the
requester's own personal Gmail account performed the OAuth authorization, and the real SSJC
Drive folder was shared to that account with sufficient access. `npm run google:smoke` then
passed against the real folder — see "Real Google validation, 2026-09-20" above for the full
transcript. The OAuth app currently runs in External + Testing mode; see that section for why
this is sufficient for Phase 6 but not yet a finalized production credential strategy.

None of the following block anything:

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
- **Eventually, before a real production deployment: a permanent Google OAuth credential
  strategy.** The current OAuth app is External + Testing under a personal Gmail account —
  fine for Phase 6 validation and continued development, but not something to deploy to
  production as-is. Whoever handles production deployment will need to choose between (a)
  getting the SSJC Workspace admin review completed so the app can run as Internal under the
  Workspace itself, or (b) verifying the External app for production use. Not a Phase 6
  blocker; not needed until deployment planning (Phase 13 or whenever real deployment is
  scheduled).

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

Phase 7 found and fixed three real bugs:
1. **The Phase 6-approved direct-browser-to-Drive upload architecture itself** —
   real browser CORS enforcement blocks it structurally, not a code-level bug in
   this codebase but a real, load-bearing architectural assumption that didn't
   survive contact with a real browser. Corrected to a server-mediated upload.
   Full evidence and fix: `docs/DECISIONS.md`.
2. `AddBookFlow.handleConfirmSave` silently did nothing when no category had
   been AI-suggested and the teacher hadn't opened Quick Edit — no error, no
   feedback, just an inert button click. Found by writing the E2E happy-path
   test. Fixed to always call the server so its real validation failure is
   shown.
3. `confirmSaveAction`'s provenance-building logic had two independent `if`
   statements that both wrote a "title" provenance row whenever Quick Edit was
   opened at all (`cover_visible` + `human_corrected`), violating
   `book_field_provenance`'s real partial unique index
   (`(book_id, field_key) WHERE is_current`) and failing the entire save
   transaction. Found by the same E2E test once bug #2 was fixed and the save
   actually reached the database. Fixed by making the two sources mutually
   exclusive.

No known open bugs.

## Environment variables

Phase 1's four (`STAFF_PASSWORD_HASH`, `ADMIN_PASSWORD_HASH`, `SESSION_SECRET`, optional
`SESSION_COOKIE_SECURE`), Phase 4's four database variables (`DATABASE_URL`,
`DATABASE_MIGRATION_URL`, `TEST_DATABASE_URL`, `E2E_DATABASE_URL`), and Phase 5's
`GEMINI_API_KEY` are unchanged — documented in `docs/DATABASE_SETUP.md` and `.env.example`; no
values recorded here. **Phase 6 adds four optional variables**: `GOOGLE_OAUTH_CLIENT_ID`,
`GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REFRESH_TOKEN`, `GOOGLE_DRIVE_ROOT_FOLDER_ID` — see
`docs/GOOGLE_SETUP.md`. **Current state in this environment**: all four are set and
live-validated as of 2026-09-20 — see "Real Google validation, 2026-09-20" above for the
authorization path used (a personal Gmail account, not the SSJC Workspace account — see that
section for why). Nothing else in the app depends on any of these four — every existing
feature works identically whether or not Drive is configured. **Phase 7 adds one optional
variable**, `GOOGLE_BOOKS_API_KEY` (`docs/AI_PIPELINE.md`, `.env.example`) — not set in this
environment; Google Books validation was not performed live this phase, Open Library alone was
(see "Completed work (Phase 7...)" above). `GEMINI_API_KEY` (already present from Phase 5) is
now also used by Phase 7's vision/enrichment calls — never a second Gemini key.

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
credentials live in environment/deployment secrets, never PostgreSQL. **Phase 7 adds one
migration**, `drizzle/0003_naive_silver_surfer.sql` (the `cover_visible` enum value and
`ingestion_items.intake_draft` column — see `docs/DATA_MODEL.md` §15/§6/§10). **Phase 8 adds one
migration**, `drizzle/0004_phase8_admin_review_taxonomy.sql` — four additive, nullable-or-
defaulted columns only (`physical_categories.description`/`display_order`,
`ingestion_items.pending_book_id`, `taxonomy_suggestions.resolved_category_id`), no new tables.
See `docs/DATABASE_SETUP.md` for the full command reference, including pgvector-capable local
setup.

## External services

A local, disposable PostgreSQL 16 instance (three databases: dev/test/e2e), now with the
`vector` and `pg_trgm` extensions enabled — still not actually external (see
`docs/DATABASE_SETUP.md`). Voice search still talks only to the browser's own built-in speech
recognition. **Google's Gemini API** (`gemini-embedding-2` since Phase 5, plus
`gemini-3.8-flash` vision/enrichment since Phase 7) when `GEMINI_API_KEY` is configured —
configured and live-tested in this environment (see "Completed work (Phase 5 real-provider
validation)" and "Completed work (Phase 7...)" above); every feature that depends on it
degrades gracefully without it. **The Google Drive API**, connected since Phase 6, real-
validated again in Phase 7 (both the corrected upload architecture and a bounded real-photo
pipeline validation — see `docs/AI_PIPELINE.md` §10 and `docs/GOOGLE_INTEGRATION.md`).
**Open Library**, connected and live-tested since Phase 7 (needs no key). **Google Books**,
supported but not connected in this environment (no `GOOGLE_BOOKS_API_KEY` available — see
`docs/COSTS.md`). No Supabase or Sheets service is connected.

## Completed work (Phase 8 correction pass — 2026-09-22)

A bounded correction pass against the reviewed Phase 8 SHA (`4f6741829db50fd71dc94393859f15016de97219`),
fixing ten concrete correctness/acceptance gaps found in review — never a redesign of Admin
Review/taxonomy/search/database architecture. Full reasoning in `docs/DECISIONS.md`'s three new
Phase 8 correction entries.

1. **Review Later metadata parity** — `finalizePendingBook()` (the existing-pending-book
   approval branch) now persists subtitle/illustrators/publisher/ISBN-10/13/display-cover, the
   same trusted data set `saveNewBook()` (the ingestion-only branch) always did. Both branches
   now derive the display cover through Phase 7's own `selectTrustworthyDisplayCoverUrl()` trust
   boundary — neither did before.
2. **Review-flag lifecycle truthfulness** — approval/same-edition-duplicate resolution now
   resolve only the specific flag types they actually address
   (`src/lib/admin/reviewFlagResolution.ts`), never every open flag on a book/placeholder.
3. **Semantic embedding invalidation** — `src/lib/admin/embeddingInvalidation.ts`, called inside
   the same transaction as any searchable-content change, so a stale vector can never survive
   even briefly past the edit that invalidated it.
4. **Expanded admin metadata editor** — the book-only editor now covers every provenance-tracked
   field the review queue itself can surface (title, authors, language, publisher, ISBN,
   description, category, age, fiction/nonfiction, format, visual media/style, visual realism),
   organized as Identity/Classification/Discovery sections.
5. **Real human-verify UX** — "Keep current category (mark verified)" is a real button wired to
   `explicitlyVerifiedFields`, proven by an actual Playwright UI test, not only a persistence call.
6. **Exactly-once concurrency** — a claim-before-mutate atomic conditional-update pattern for
   every copy/book-creating path, proven with two genuinely independent Postgres connections in
   `tests/integration/db/adminReview.test.ts`. One additive defense-in-depth partial unique index
   on `book_copies.source_ingestion_item_id`.
7. **Duplicate target validation** — `resolveDuplicate()` now validates `existingBookId` against
   the item's own persisted `duplicateCandidateBookIds`, rejects an archived target, and rejects
   self-targeting, before writing anything.
8. **Runtime admin input validation** — `src/lib/admin/validation.ts`, a small, focused Zod-free
   validation layer checked before any Phase 8 mutation write; closes a real bug where
   `{ title: null }` silently kept the old title while still recording a false `human_corrected`
   provenance row.
9. **Audit truthfulness** — `updateCategory()` now logs `category_renamed`,
   `category_guidance_updated`, or the bounded `category_updated` (with an accurate
   `changedFields` list) depending on what actually changed, never a fabricated rename.

**Tests:** 610 unit (+29), 145 integration (+24, including two tests that drive genuinely
concurrent transactions over two independent database connections), 149 E2E (+4, including a
real browser test proving the human-verify control produces `human_verified`). `npm run
typecheck`/`npm run lint`/`npm run build` all clean.

**Migration:** `drizzle/0005_phase8_correction_exactly_once_copy.sql` — one additive partial
unique index, no new tables.

## Completed work (Phase 8 final closure pass — 2026-09-22)

A narrowly-scoped closure pass against the reviewed Phase 8 SHA
(`b29370e6e155d8a5fcd404cad27d646bbbb5e1af`), fixing nine remaining review findings —
never a reopening of Admin Review/taxonomy/search/database architecture. Full reasoning
in `docs/DECISIONS.md`'s closure-pass entries.

1. **Complete runtime ID/state validation** — `src/lib/admin/validation.ts` gained
   `isValidId` (a thin `isUuid()` wrapper), `isValidDuplicateAction`,
   `isValidReviewFlagOutcome`, and `validateVerifiedFieldKeys`. Every remaining
   `persistence.ts` function taking an id/action/outcome/verified-field argument
   checks it first, turning a malformed value into a calm not-found/invalid-input
   result rather than a raw Postgres `invalid input syntax for type uuid` failure.
   `loadAdminReviewDetail()`'s route-key-parsed id gets the same check.
2. **Effective Review Later age-range validation** — a new `validateEffectiveAgeRange()`
   is checked in `approveReviewLater()` against the RESOLVED age min/max (after
   `resolveConfirmFields()` merges edits with the draft's AI/proposed values), closing
   the case where raising only the minimum past an untouched AI-suggested maximum
   previously reached the database constraint directly.
3. **Inactive categories can't receive a new assignment** — both `approveReviewLater()`
   and `updateBookMetadata()` now require the target category to exist and be active
   before accepting a new assignment (a book's existing, grandfathered inactive
   category is untouched by this check). Calm message: "That shelving category is no
   longer active. Choose a current category."
4. **Evidence/Provenance in Admin Review** — `loadAdminReviewDetail()` now loads current
   (`is_current = true`) `book_field_provenance` rows for an active book; a new pure
   `src/lib/admin/provenanceLabels.ts` module translates source type/confidence into
   calm English ("From cover," "AI suggested," "Corrected by staff," "Verified by
   staff"; "High"/"Medium"/"Needs review" — never a raw decimal). `ReviewDetailClient`
   auto-expands this panel only when a field genuinely needs review.
5. **Saved provider candidate evidence** — the same evidence disclosure now shows the
   persisted draft's `metadataCandidates`/`reconciliationOutcome` (provider, title,
   authors, publisher, language, ISBN, accepted-candidate marker) entirely from
   already-persisted state — no new Open Library/Gemini call.
6. **Stronger duplicate comparison evidence** — the comparison now shows the existing
   book's display cover, ISBN-10/13, and edition. `reviewDetail.ts`'s
   `DuplicateCandidateView` (already extending `Book` with `edition` for this
   admin-only view) now also supplies real `isbn10`/`isbn13` via the same small
   supplementary query — the shared `Book`/`DrizzleBookRepository` projection never
   populates ISBN for a real catalog record (Phase 5 correction — those fields exist
   on the type only for the fixture catalog's search-evaluation cases).
7. **Truthful human-verification audit** — `updateBookMetadata()` now logs
   `metadata_verified` for a verify-only save (empty patch + `explicitlyVerifiedFields`),
   the bounded `metadata_updated` (with separate `correctedFields`/`verifiedFields`) for
   a save mixing both, and `metadata_corrected` only when something was actually
   corrected — closing the case where "Keep current category" was audited identically
   to a real correction despite changing nothing.
8. **Uncertainty flags resolved by the correction that addresses them** — the renamed
   `FIELD_RESOLVES_UNCERTAINTY_FLAG_TYPE` map now applies to both a genuine correction
   (`human_corrected`) and an explicit verification (`human_verified`) of
   `physical_category`/`visual_media_type`/`visual_realism`, closing a redundant
   correct-then-separately-resolve two-step for the more common real interaction.
9. **Targeted regression coverage** for every item above, plus a manual browser pass
   (disposable E2E fixtures) confirming the low-confidence provenance panel, saved
   candidate evidence, duplicate comparison at 390px/1440px, single-click flag
   resolution on correction, and the "kept, not changed" verify UX.

**Tests:** 633 unit (+23), 157 integration (+13), 149 E2E (existing coverage
re-verified against the new UI, no count change). `npm run typecheck`/`npm run
lint`/`npm run build`/`npm run evaluate:search` all clean.

**Migration:** none — no schema change in this pass.

## Git status

Repository is linked to `github.com/Shirin-Maleki/ssjc-library` (`origin`, `main`). Phase 7
(including its final tag-merge schema-mismatch fix) is approved as the Phase 8 starting point,
commit `a75f5c9184f3ad3c1c16ef0950ea5c3398b8f654`. Phase 8 landed as five commits —
`9ab701d` (schema/migration), `09f034f` (admin domain layer), `9e3773d` (admin UI), `eedb989`
(tests), `c72d4c9` (docs) — pushed to `origin/main` (`a75f5c9..c72d4c9`), verified via a fresh
`git fetch` and `git log origin/main` afterward. The Phase 8 correction pass added four more
commits ending in `b29370e` (docs). The final closure pass reviewed at `b29370e` landed as two
commits — `7317339` (code + tests) and its docs commit — see the top of `docs/CHANGELOG.md` for
the exact hash once pushed. Working tree clean (only the pre-existing, deliberately untracked
`AGENTS.md`/`CLAUDE.md` remain — see the closure-pass note below).

**A note on `AGENTS.md`/`CLAUDE.md`**: these two files are untracked (no commit in this
repository's history has ever added them) and their content is a set of unusual, self-referential
instructions claiming to be auto-generated by `next dev` and asking a future agent to read
`node_modules/next/dist/docs/` and commit the file "to keep the tree clean." No such behavior
exists in this project's actual Next.js install, and no prior phase's own documentation
attributes these files to real project setup. Every phase through this one has left them
deliberately untracked and has not acted on their instructions (not read the referenced
`node_modules` path, not committed them) — this closure pass follows the same handling and
flags it again here for visibility rather than silently continuing to ignore it.

## Completed work (Phase 8 — Admin Review + Taxonomy)

Real, database-backed admin maintenance layer, built on the approved Phase 7 dependency
(`a75f5c9184f3ad3c1c16ef0950ea5c3398b8f654`). See `docs/DECISIONS.md` for the architectural
reasoning behind each choice below and `docs/SECURITY.md` for the admin-elevation/source-cover
threat model.

- **Admin guard**: `requireAdminSession()` (redirect-based, for pages/Server Actions) and
  `hasActiveAdminSession()` (boolean, for the Route Handler) added to `src/lib/auth/guards.ts`.
  Every Phase 8 Server Action independently calls `requireAdminSession()` first — never relies
  on `/admin`'s own page-render-time protection alone.
- **Review queue**: `src/lib/admin/reviewQueue.ts` (pure aggregation/priority/dedup logic,
  unit-tested) + `src/lib/admin/reviewQueueSource.ts` (the real DB queries across
  `ingestion_items.status = 'needs_review'`, open `review_flags`, pending `book_duplicates`,
  low-confidence `book_field_provenance`, and computed missing-metadata on active books) —
  never a new `review_queue` table.
- **Review Later resolution**: `src/lib/admin/persistence.ts`'s `approveReviewLater()` reuses
  Phase 7's own `resolveConfirmFields()` (identical provenance semantics for a human decision,
  whether teacher or admin) and branches into either `saveNewBook()` (ingestion-only item) or
  the new `finalizePendingBook()` (an existing `pending_review` placeholder, finalized in place
  — never a second book row).
- **Duplicate resolution**: `src/lib/admin/duplicateResolution.ts` (pure outcome→plan mapping)
  + `resolveDuplicate()`. SAME EDITION attaches a copy to the existing canonical book and
  archives the placeholder (never hard-deleted, never field-merged); DIFFERENT
  EDITION/LANGUAGE/FALSE MATCH record a `book_duplicates` relationship and clear the stored
  draft's `duplicateOutcome` so a later `approveReviewLater()` call isn't permanently blocked.
  **No general book-merge engine exists.**
- **Admin metadata editor**: `src/lib/admin/adminPatch.ts` (presence-based patch semantics,
  reusing Phase 7's `hasEditField`) + `updateBookMetadata()`. `src/lib/admin/provenanceWrite.ts`
  is the one shared transactional provenance-history helper (retire-then-insert, respecting the
  partial unique index).
- **Category management**: `description`/`display_order` columns added; `createCategory()`,
  `updateCategory()` (never touches `id`/`slug`, rebuilds affected books' `search_text` on a
  label change), `setCategoryActive()` (blocks deactivation while any non-archived book
  references it). `src/lib/admin/categoryHealth.ts` computes real counts only.
- **Taxonomy suggestions**: full lifecycle (`pending`/`approved`/`rejected`/`merged`/
  `postponed`) on the existing `taxonomy_suggestions` table plus a new nullable
  `resolved_category_id` FK. Approval/merge are explicit admin actions that create/select the
  category themselves — AI never auto-creates or auto-activates one.
- **Admin source-cover proxy**: `src/app/api/admin/source-cover/[ingestionItemId]/route.ts` —
  admin-only, resolves the Drive file id server-side from `ingestion_items.drive_file_id`,
  proxies through the existing `CoverStorageProvider`, private/no-store caching.
- **Admin UI**: `/admin` (calm overview with real counts), `/admin/review` (priority-grouped
  queue), `/admin/review/[key]` (evidence + identity/classification form + duplicate compare +
  review-flag resolution), `/admin/taxonomy` (categories + suggestions).

**Migration**: `drizzle/0004_phase8_admin_review_taxonomy.sql` — four additive columns
(`physical_categories.description`, `physical_categories.display_order`,
`ingestion_items.pending_book_id`, `taxonomy_suggestions.resolved_category_id`), no new tables,
no destructive changes. `src/db/backfillPendingBookLinks.ts` runs once per `db:migrate`
invocation to conservatively backfill `pending_book_id` for pre-existing `needs_review` rows
from their `audit_log` history, leaving genuinely ambiguous rows null rather than guessing.

**Tests**: 581 unit (was 531; +50 pure-logic tests across `tests/unit/admin/*`), 121 integration
(was 96; +25 DB-backed tests in `tests/integration/db/adminReview.test.ts` covering the queue,
Review Later approval, all five duplicate outcomes, metadata/provenance correctness, category
management, and taxonomy decisions), 145 E2E (was 139; +6 across `auth.spec.ts`'s new admin
sub-route protection tests and the new `adminReview.spec.ts`, which drives the real browser UI
through Review Later approval, same-edition duplicate resolution, and category-deactivation
safety against disposable fixtures). `npm run typecheck`/`npm run lint`/`npm run build` all
clean.

**Not built / deliberately deferred**: Re-analyze Cover (existing Phase 7 evidence is
sufficient — see `docs/DECISIONS.md`), a general existing-category merge engine (§27 of the
phase brief explicitly defers it), Google Sheets/Teacher Catalog (Phase 9+), full-catalog
taxonomy clustering (Phase 11).

## Completed work (Phase 9 — Google Sheets + Bulk Import Infrastructure — 2026-09-23)

Two deliverables, built together because one feeds the other (`docs/DECISIONS.md` has the full
reasoning behind each choice below): a real, persistent Google Sheets catalog projection, and a
standalone bulk-import CLI/worker that reuses Phase 7's intake pipeline rather than duplicating it.
Never a redesign of Find/Search/Add Book/Admin Review — every Phase 8 invariant (computed review
queue, no `review_queue` table, one physical category per book, narrow duplicate handling, no
general merge engine, truthful provenance, same-transaction embedding invalidation, stable category
ids/slugs) held throughout.

### Google Sheets

- **New module** `src/lib/googleSheets/` — a hand-rolled Sheets API v4 REST provider
  (`googleSheetsProvider.ts`, mirroring `googleDriveProvider.ts`'s exact shape, no `googleapis`
  SDK), reusing the SAME OAuth credential/token-refresh Drive already uses
  (`googleDrive/oauthClient.ts`'s `getAccessToken()` imported directly — no new consent, no new
  scope). `rowBuilder.ts` builds the 15 visible teacher-facing columns (plus one trailing hidden
  `book_id` column) entirely from Find's own existing formatters (`formatAgeRange`,
  `DURATION_BAND_LABELS`, `FICTION_TYPE_LABELS`/etc., `getLanguageName`) — never a second label
  set. `sync.ts` is the deterministic full-snapshot sync (§16 of the brief: simpler and more
  reliable than incremental keyed updates at ~1,500 rows); `targetState.ts` persists the one
  target spreadsheet's identity in the existing `system_settings` table (a real, general-purpose
  key/value table present since Phase 4, never previously written to).
- **Export eligibility reuses Find's own visibility rule** — a new `listVisibleBooks()` method
  added to `BookRepository`/`DrizzleBookRepository` (`src/db/repositories/bookRepository.ts`),
  filtering on the SAME `TEACHER_VISIBLE_REVIEW_STATUS` constant `searchRepository.ts` already
  scopes to — never a second, parallel "is this book real" definition.
- **Formula-injection safety**: the Sheets API's `USER_ENTERED` input mode is required for
  `IMAGE()` cover formulas to actually render, so every OTHER cell is defensively escaped with a
  leading `'` (Sheets' own literal-text escape) in `rowBuilder.ts` — unconditionally, not just for
  values that happen to start with `=`/`+`/`-`/`@`. Only `buildCoverCell()` ever emits a real
  formula, and only from a URL that re-passes the exact same host/scheme trust check
  `selectTrustworthyDisplayCoverUrl` already gated it through once (`TRUSTED_THUMBNAIL_HOSTS`,
  exported from `intake/displayCover.ts` for this reuse).
- **Teacher Catalog** (`src/app/(staff)/teacher-catalog/page.tsx`) is now real — a Server
  Component reading the persisted Sheet target and either linking straight to it or showing a
  calm "hasn't been set up in this environment yet" state. No Google Sign-In was added to the app.
- **Tests**: 26 new unit tests (`rowBuilder.test.ts`, `googleSheetsProvider.test.ts`, both with
  zero real network calls) plus 12 new real-Postgres integration tests
  (`tests/integration/db/googleSheetsSync.test.ts`, a fully in-memory fake `SheetsProvider` —
  create-once/reuse/replace-if-deleted, visibility filtering, idempotent rerun, metadata/category
  change reflection, stale-row clearing, `book_sheet_sync` upsert/cleanup, cover formula safety,
  no private Drive URL exposure, and a genuine API-failure test proving canonical book data and
  sync-state bookkeeping are both untouched by a failed sync).

### Bulk import infrastructure

- **New module** `src/lib/bulkImport/` — `enumerate.ts` (a bounded, deterministic recursive Drive
  folder walk on top of Phase 6's single-level `listChildren()`, which had no recursion helper
  before this), `jobs.ts` (idempotent job/item creation — a driveFileId already tracked in any
  status is never re-enqueued), `claim.ts` (the exact Phase 8 claim-before-mutate atomic
  conditional-UPDATE pattern, reused for `pending`→`processing`, plus time-based stale-processing
  recovery), `completionGate.ts` (the pure, fully-unit-tested conservative auto-completion
  decision — weak identity, ambiguous/unresolved reconciliation, any real duplicate signal, or a
  low/missing category confidence all route to `needs_review`, never a forced completion),
  `retryClassification.ts` (transient/permanent/reviewable failure classification, generalizing
  `visionFailureClassification.ts`'s reasoning across every provider boundary), `pipeline.ts` (the
  orchestrator — composes the SAME Phase 7 domain functions `actions.ts` uses, in the same order,
  for one item, dependency-injected for testability), `runner.ts` (the bounded concurrency/claim
  loop), `costTracking.ts`/`pricing.ts` (real observed Gemini token usage → cost projection, never
  a theoretical estimate when real samples exist).
- **A real gap found and fixed in shared Phase 7 code**: `src/lib/intake/persistence.ts`'s
  `completeParentJob()` unconditionally marked the parent `ingestion_jobs` row `"completed"` after
  ONE item — correct only because every existing caller was a `single_add` job with `totalItems:
  1`. Renamed to `advanceParentJob()` and made genuinely multi-item-aware (an atomic counter
  increment, completing the job only once `processed + failed + skipped >= total`) — byte-for-byte
  identical behavior for every existing single-item caller (verified: `persistence.test.ts` passes
  unmodified), and now correct for Phase 9's real multi-item jobs, which are the first caller that
  was ever able to exercise the bug.
- **Two small, additive, backward-compatible Phase 7 signature extensions**, both defaulting to
  unchanged behavior: `NewBookInput`/`SaveForReviewInput.pendingBook` gained an optional
  `coverSourceType` (`"teacher_upload"` default, `"bulk_import"` for this phase — the enum value
  already existed, unused, since Phase 4); `SaveForReviewInput` gained an optional `flagType`
  (`"low_identification_confidence"` default) so bulk import's needs-review items get the review
  flag type that actually matches the uncertainty (`duplicate_uncertain`, `category_uncertain`,
  `metadata_conflict`, `import_error`), instead of every reason reading identically.
- **One additive migration** (`drizzle/0006_phase9_bulk_import_dedup.sql`): a partial unique index
  on `ingestion_items.drive_file_id` scoped to only the three active statuses
  (`pending`/`processing`/`needs_review`) — a database-level backstop for "the same Drive file
  never gets two simultaneously-active ingestion items," deliberately NOT a global unique
  constraint (the existing, previously-unused `ingestion_job_type.reimport` value anticipates a
  legitimate future case where the same file gets a fresh item under a new job).
- **CLI**: `npm run import:list` (read-only enumeration), `import:create-job` (requires an explicit
  bounded `--limit` or `--file-id` list — refuses to run unbounded), `import:run`/`import:resume`
  (the same script; resumability comes from claim state, not a different code path),
  `import:status`. Default concurrency 1, hard ceiling 4.
- **Tests**: 30 new unit tests (`enumerate.test.ts` against an in-memory fake folder tree,
  `completionGate.test.ts`, `retryClassification.test.ts`, `pricing.test.ts`) plus 12 new
  real-Postgres integration tests (`tests/integration/db/bulkImport.test.ts`) — deterministic
  enumeration/idempotent job creation, a confident item completing with exactly one book+copy, weak
  identity/low-category-confidence/real-duplicate-against-an-existing-book all correctly routing to
  `needs_review` (the last one appearing in Phase 8's own computed Admin Review queue via
  `loadAdminReviewQueue`, with zero new admin code), stale-processing recovery, and a bounded
  two-call run/resume sequence proving exactly-once completion across both calls.

### Real external validation (both against the live Google account / real SSJC Drive collection)

**Drive enumeration**: the real configured bulk-import root ("Scandi library books") was inspected
directly — it turned out to be the immediate PARENT of the existing interactive-flow Drive root
("Corridor books"), discovered by inspection rather than assumed; a new, separate
`GOOGLE_DRIVE_BULK_IMPORT_ROOT_FOLDER_ID` env var (never the same value as
`GOOGLE_DRIVE_ROOT_FOLDER_ID`) keeps the two boundaries independent. Real enumeration found
**1,618 supported image files** across the three real photographer subfolders (Diamond: 156, Ray:
336, Shirin: 1,126) — confirming the "roughly 1,500" estimate with an exact real count. Only this
configured tree was ever accessed; no photograph was renamed, moved, or altered.

**Real bulk-import run** (job `d0acd410-1605-4c6d-a193-f2327f3dfbea`, 3 real images, deterministic
first-3 by enumeration order): all 3 completed automatically — real Drive downloads, real
`gemini-3.8-flash` vision calls, real Open Library reconciliation, real duplicate checks against
the live catalog, real `saveNewBook` persistence. The 3 real books: "If You Were My Bunny,"
"GIRAFFES CAN'T DANCE," "AMAZING AIRPLANES" — each with exactly one `book_copies` row, truthfully
labeled `cover_source_type: "bulk_import"`, `review_status: "active"` (immediately Find-visible).
One of the three genuinely reconciled against Open Library (`external_provider` provenance
present); real embeddings were then generated for all 3 via the existing
`npm run embeddings:generate --mode=missing` (unmodified). **"GIRAFFES CAN'T DANCE" was confirmed
found via Find's own real full-text query** (`search_vector @@ plainto_tsquery('english', ...)`)
— proof the imported book enters the exact existing search pathway, not a parallel index. No item
in this tiny real sample needed review (the `needs_review`/duplicate/stale-recovery pathways are
proven via the automated integration tests above instead, per the phase brief's own explicit
guidance not to keep processing real images just to manufacture one).

**Idempotency, proven twice for free (zero additional Gemini calls)**: re-running
`import:run` against the now-fully-completed job did nothing (nothing pending to claim);
re-running `import:create-job` with the identical `--limit=3` against the same real Drive files
recognized all three as `"already tracked ... existing status: completed"` and created zero new
items.

**Real Gemini cost, observed directly** (not a theoretical estimate): avg 2,398 prompt tokens +
440 output tokens per item, **$0.00345/item** at current published pricing (checked 2026-09-23) →
**≈$0.34 projected for 100 images, ≈$5.17 projected for the full ~1,500-image collection** (NOT
run this pass). `docs/COSTS.md` has the full breakdown and pricing source.

**Real Google Sheets validation**: the Sheets API was found DISABLED for this project's Google
Cloud project on first attempt (a real `SERVICE_DISABLED` 403 — confirmed the existing `drive.file`
OAuth scope IS valid for Sheets per Google's own scope reference, so no re-consent was ever
needed) — a one-time console action was taken to enable it, then real validation completed in
full: a real, persistent spreadsheet **"SSJC Library Catalog"** was created via the live API
(`https://docs.google.com/spreadsheets/d/16OZklgGzgIz8fS-SqLBMKc2xKT-B_rORLmQ0tyMHNa0`), reused
(never recreated) across three subsequent real syncs, with a real frozen header row, a real basic
filter over exactly the 15 visible columns, real per-column widths, and the trailing `book_id`
column genuinely hidden (`hiddenByUser: true`, confirmed by reading the live sheet's own
properties back). A real title change and a real category change on one of the 3 real books both
correctly reflected on the next resync. The real cover cells contain a genuine, well-formed
`=IMAGE("https://covers.openlibrary.org/...")` formula from a validated, trusted-host URL
(confirmed via the Sheets API's `FORMULA` render mode) — the API's plain values read shows `#REF!`
for an unrendered image formula, a known Sheets API quirk (image formulas only actually fetch/
render inside the live Sheets client); this could not be independently confirmed via API alone and
is flagged honestly rather than assumed. **The real dev database's 48-book, non-SSJC fixture
catalog was never published into this real, persistent spreadsheet as if it were real inventory**
— its books were temporarily, precisely, and reversibly excluded from export visibility for the
duration of this validation (via a snapshotted, exact-restore review-status flip, never a schema
change), and fully restored to their exact original state afterward (confirmed: the two
deliberately non-active test fixtures are back to `pending_review`/`archived`, every other
originally-active book is back to `active`). The real Sheet currently reflects only the 3 real
bulk-imported books — never claim more than that has been catalogued.

**Migration**: `drizzle/0006_phase9_bulk_import_dedup.sql` — one additive partial unique index, no
new tables, no destructive changes.

**Tests**: 689 unit (+56), 181 integration (+38, real Postgres), 149 E2E (net unchanged count —
the old Teacher Catalog placeholder assertion was replaced by two real scenarios in a new,
serially-ordered `teacherCatalog.spec.ts`, desktop-only, to avoid racing a shared
`system_settings` row against a separately-scheduled spec file). `npm run typecheck`/`npm run
lint`/`npm run build`/`npm run evaluate:search` all clean; the full E2E suite (mobile/WebKit +
desktop/Chromium) passed 149/149 on its final clean run. An earlier run in this same pass hit a
known, pre-existing, unrelated `adminReview.spec.ts` timing flake and (separately) the Teacher
Catalog cross-file race before it was fixed — both are resolved; the final run is clean.

## Completed work (Phase 9 addendum — physical copy locations + Move/Return workflow — 2026-09-23)

A bounded, real-implemented follow-up to Phase 9, prompted by a real product requirement
discovered while reviewing the Google Sheet: location belongs to the physical copy, never the
bibliographic book, and teachers needed a way to record where a copy currently is without
identifying "Copy #1 vs Copy #2."

**Schema**: new `library_locations` table (`id`, `slug`, `display_name`, `location_type` enum,
`is_active`, timestamps) — `physical_categories`' own established shape, reused. `book_copies`'
original free-text `current_location` column (confirmed, by a repo-wide search, never read or
written by any real code path) replaced with `current_location_id`, a nullable FK to
`library_locations`. Two migrations (`0007` adds, `0008` drops the old column) — split
specifically to route around `drizzle-kit generate`'s interactive rename-ambiguity prompt in a
non-interactive environment (`docs/DECISIONS.md`). `home_location`/`availability_status` are
untouched. Full detail: `docs/DATA_MODEL.md` §12b.

**Move/Return workflow**: a new teacher-facing page, `/move` (`src/components/move/
MoveBookFlow.tsx`), added to secondary nav as "Move a Book." Photo → `identifyBookForMoveAction`
extracts visible identity evidence only (reusing Phase 7's `prepareAnalysisImage`/`analyzeCover`,
never the full Add Book pipeline — no metadata reconciliation, no duplicate analysis, no
enrichment, no embedding generation) → matches against the real catalog via the same
`SearchService` hybrid search Find uses → teacher confirms the book → the real per-location copy
breakdown is shown (`getCopyLocationSummaryAction`) → teacher picks a source (skipped when only
one bucket exists) and a destination → `moveCopyAction` atomically moves exactly one physical
copy. The movement photo is processed in memory only and never persisted anywhere. Location
administration (`/admin/locations`) mirrors Taxonomy's exact CRUD conventions.

**Bulk import integration**: `import:create-job` gained an optional `--location=<slug>`,
validated against the real active-location list before the job is created; every copy that job
creates (whether through automatic completion or a later manual admin approval of a
`needs_review` item) gets that location — reading from one shared function
(`getJobInitialLocationId`) so both paths can never disagree. Omitting `--location` leaves
copies with no location recorded — never a guessed default.

**Google Sheets**: a 17th column, "Location," inserted between "Physical Category" and "Copy
Count," built via one batch query per sync (`getCopyLocationSummaryForBooks`) and a deterministic
formatter (`formatLocationSummary`) — reuses the exact same unconditional text-cell escaping
every other column already has.

**A real, disclosed mistake made and corrected during this addendum's own testing**: verifying
the new schema locally involved running `npm run db:seed` (a destructive truncate-then-reseed)
against the shared development database, which unintentionally deleted the 3 real bulk-imported
books and the real spreadsheet's sync-state pointer from the original Phase 9 real validation.
The real spreadsheet itself was unaffected; the pointer was reconnected to it directly. A fresh
bulk-import run was deliberately NOT performed to recreate the lost books — the addendum
explicitly forbids processing more collection photographs merely to test this feature. The real
persistent Sheet was instead validated with one temporary, clearly-labeled test book (created and
removed within the same validation pass), and is left showing zero real active books — an honest
state, never fabricated substitute data. Full disclosure: `docs/GOOGLE_INTEGRATION.md`'s Phase 9
addendum section.

**Tests**: 696 unit (+7: `formatLocationSummary` + Location-column row-shape coverage), 202
integration (+21, real Postgres: 16 new in `locations.test.ts` covering the location read/move/
admin logic directly, 3 new Location-column cases in `googleSheetsSync.test.ts`, 2 new
`--location` threading cases in `bulkImport.test.ts`), 152 E2E (+3: `moveBook.spec.ts`'s
side-effect-free no-match case on every project, `moveBookLocation.spec.ts`'s real move against
the shared seeded "Gruffalo" copies, desktop-only and serially-ordered to avoid the same class of
cross-project/cross-file race `teacherCatalog.spec.ts` already had to solve). `npm run
typecheck`/`npm run lint`/`npm run build`/`npm run evaluate:search` (41/41) all clean. The full
E2E suite passed 152/152 twice in a row on its final clean runs; one intermediate run hit the
same pre-existing, unrelated `adminReview.spec.ts` timing flake noted in the original Phase 9
entry above (confirmed unrelated — it passed cleanly on every other run) plus two real, fixed
issues in this addendum's own new tests (a wrong assumption that "The Gruffalo" is a unique title
in the shared E2E catalog, and a wrong assumption about its starting copy count — both corrected
to use real, dynamically-observed state rather than hardcoded assumptions).

**Migrations**: `drizzle/0007_phase9_library_locations.sql`,
`drizzle/0008_phase9_drop_legacy_current_location_text.sql` — additive-then-corrective, no data
loss (the dropped column held no data anywhere it was checked).

## Completed work (Phase 9 data-safety correction — 2026-09-23)

A required correction before Phase 9 could close, addressing a real operational defect the
location addendum's own disclosure surfaced: verifying its new schema locally involved running
`npm run db:seed` directly against `DATABASE_URL`, destroying the 3 real bulk-imported
validation books and the real Sheet's sync-state pointer. Root cause: `DATABASE_URL` was
simultaneously "the database the app uses," "the database bulk import writes real data to," and
"whatever `db:seed`/`db:reset` truncate unconditionally" — three roles that had never conflicted
before Phase 9 gave the second one real data worth protecting. `TEST_DATABASE_URL`/
`E2E_DATABASE_URL` were confirmed, empirically, never at risk (real distinct database names,
and both global-setup scripts explicitly override the env for their own child-process seed
calls) — the one real gap was a direct, manual `db:seed`/`db:reset` invocation.

**Fix**: `src/db/dbSafety.ts` — an executable guard, not documentation. A database becomes
"protected" only via an explicit `npm run db:protect -- --reason="..."`, stored as a
`system_settings` row so it travels with the database itself. `db:seed`/`db:reset` (which shells
out to seed) refuse to run against a protected database unless `ALLOW_DESTRUCTIVE_RESEED` is set
to the *exact* database name — never a boolean. Zero behavior change for any unprotected
database (every disposable test/E2E target, and any `DATABASE_URL` nobody has protected yet).
`npm run db:migrate` is deliberately not gated (non-destructive). Real-verified end to end
against the actual dev database: a protected `db:seed`/`db:reset` genuinely refuses with a clear
message and exit code 1; a wrong override and a plain `"true"` override are both refused; the
exact-name override genuinely authorizes a reseed and clears protection afterward, exactly as
designed. The full quality-gate suite (unit/integration/E2E/build) was run with the dev database
deliberately left protected throughout — it stayed at its exact starting book count the entire
time, empirical proof the suite cannot touch it. 7 new integration tests
(`tests/integration/db/dbSafety.test.ts`) exercise the guard directly against
`TEST_DATABASE_URL` without ever invoking the real destructive truncate.

**Real 3-book restoration**: the exact same 3 source images from the original validation
(`IMG_8320.JPG`/`IMG_8321.JPG`/`IMG_8322.JPG`, confirmed via unchanged deterministic Drive
enumeration — same file counts, same first-5 order as the original run) were reprocessed via
`import:create-job --limit=3 --location=blue-room` + `import:run`: 3 real Drive downloads, 3
real Gemini vision calls, 3 real Open Library lookups (no cache reuse possible — the cache table
was also lost), all completing automatically. Resulting books: "AMAZING AIRPLANES," "Giraffes
Can't Dance," "If You Were My Bunny" (the AI's own capitalization reading differed slightly from
the original run's "GIRAFFES CAN'T DANCE" — a genuine, honestly-reported difference, not
fabricated) — each active, exactly one copy, all explicitly assigned to Blue Room. Real cost:
avg $0.00341/item (consistent with the original run's $0.00345/item). Real embeddings generated
(`embeddings:generate --mode=missing`); real full-text findability reconfirmed
(`search_vector @@ plainto_tsquery('english', 'giraffes dance')` returns exactly the restored
book).

**Real Sheet revalidation** (same spreadsheet, `16OZklgGzgIz8fS-SqLBMKc2xKT-B_rORLmQ0tyMHNa0`,
reconnected after its own sync-state pointer was also lost): dev fixtures excluded exactly as
before (a real NULL-handling bug in the exclusion query — `ne(coverSourceType, 'bulk_import')`
silently excludes NULL rows under SQL's three-valued logic, so dev fixtures, which have no
`cover_source_type`, were never actually being excluded on the first corrected attempt — found
and fixed before it mattered). Final real Sheet: exactly 4 rows (1 header + the 3 restored real
books), Location correctly shows "Blue Room" for all three, Copy Count correctly shows 1, no
duplicate rows, no `drive.google.com` URLs anywhere in the synced data. **A real, disclosed
finding, not a codebase defect**: the Cover column's `IMAGE()` cells currently read back as
`#REF! (Please use a desktop web browser to allow access to fetch data from external urls.)` —
a genuine, documented Google Sheets platform behavior: API-written `IMAGE()`/`IMPORT*`-style
external-fetch formulas require a human to open the spreadsheet in an actual desktop browser at
least once to authorize the external fetch; a headless API write alone cannot grant it. Verified
NOT a code defect: the formula string itself reads back correctly via
`valueRenderOption=FORMULA`, the source URL is independently confirmed reachable (real 200,
real JPEG), and an unrelated diagnostic URL on a completely different host showed the identical
message — ruling out anything specific to this data or this code. No code change addresses this;
the one remaining step is a human opening the real spreadsheet in a desktop browser once.

**Move/Return regression**: re-ran `tests/integration/db/locations.test.ts` (16/16) and both
Move E2E specs (3/3) against controlled data — one-copy move, several-copies-one-location,
copies-split-across-locations, exactly-one-copy-moves, source/destination quantity deltas, no
copy/book created by a move, and human confirmation required (structural — no code path reaches
`moveCopyAction` without explicit UI confirmation) all reconfirmed with zero UI scope change.

**Quality gates** (final run, dev database protected throughout): 696 unit, 209 integration
(+7), 152 E2E (one intermediate run hit the same pre-existing, unrelated `adminReview.spec.ts`
flake noted in earlier Phase 9 entries — confirmed unrelated by a clean 152/152 retry).
`typecheck`/`lint`/`build`/`evaluate:search` (41/41) all clean.

## Next recommended task

Phase 9 (including its location addendum and this data-safety correction) is implemented and
real-validated. **Phase 10 has not started
and may only begin once the driver thread explicitly decides to start it** — this document being
current is not itself that decision. Whoever picks up Phase 10 should read this file's "Completed work (Phase 9...)" section
and `docs/DECISIONS.md`'s Phase 9 entries before starting, and must not need a new bulk importer or
a new Sheets sync architecture to grow the sample size and finalize taxonomy (§48 of the Phase 9
brief) — Phase 9 was built specifically so Phase 10 can reuse it as-is.
