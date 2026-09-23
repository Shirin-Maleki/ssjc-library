# Changelog

A simple, phase-level record of what actually shipped — not a verbose release process.
Entries are dated by when the work was completed; see `docs/IMPLEMENTATION_STATUS.md` for the
current state and `docs/DECISIONS.md` for the reasoning behind any of these.

## Phase 9 complete — Google Sheets + Bulk Import Infrastructure — 2026-09-23

Two deliverables built together: a real, persistent Google Sheets catalog projection, and a
standalone bulk-import CLI/worker that reuses Phase 7's intake pipeline end to end. Full detail:
`docs/BULK_IMPORT.md` (new), `docs/IMPLEMENTATION_STATUS.md`, `docs/DECISIONS.md`.

**Real external validation, not mocks alone**: real Drive enumeration found 1,618 supported
images across the actual SSJC collection's three photographer subfolders; a real bounded job of 3
real photos completed automatically end to end (real Drive download, real `gemini-3.8-flash`
vision, real Open Library reconciliation) into 3 real active catalog books — one of them
confirmed findable through Find's own real full-text search query. Idempotency was proven twice
for free (rerunning both `import:run` and `import:create-job` against the same real files/job did
nothing further). A real, persistent Google Sheet ("SSJC Library Catalog") was created, reused
across three subsequent syncs (never recreated), and its real formatting (frozen header, filter,
column widths, a genuinely hidden `book_id` column) and a real `IMAGE()` cover formula were all
confirmed by reading the live sheet back via the API.

**A real, one-time external blocker found and resolved**: the Google Sheets API was disabled for
the project's Google Cloud project (a real `SERVICE_DISABLED` 403) — a one-time console toggle,
not a scope or code problem; the existing `drive.file` OAuth scope (Phase 6) was confirmed
sufficient for Sheets once enabled, with no re-consent needed.

**A real gap found and fixed in shared Phase 7 code**: `completeParentJob()` (now
`advanceParentJob()`) assumed every job had exactly one item — true for every existing caller,
false for Phase 9's own multi-item bulk jobs, the first caller able to exercise it. Fixed with
zero behavior change for every existing single-item caller (verified by the existing, unmodified
`persistence.test.ts` suite still passing).

**The full ~1,500-image collection was NOT processed** — only 3 real images, a deliberately
bounded validation sample. Real observed cost: ~$0.00345/image → ≈$5.17 projected for the full
collection (`docs/COSTS.md`).

Tests: 689 unit (+56), 181 integration (+38, real Postgres), 149 E2E (unchanged count — two new
Teacher Catalog scenarios replace the old placeholder test). `npm run typecheck`/`npm run
lint`/`npm run build`/`npm run evaluate:search` all clean. One additive migration
(`drizzle/0006_phase9_bulk_import_dedup.sql`).

**The old 13-phase roadmap's remaining five phases (9: Sheets, 10: bulk import engine, 11:
taxonomy research batch, 12: full import, 13: hardening/QA/deployment) are now two: Phase 10
(Real Collection Import + Taxonomy Finalization) and Phase 11 (Final UI/UX Polish + QA +
Deployment)** — see `docs/IMPLEMENTATION_STATUS.md`'s "revised roadmap" note.

## Phase 8 complete — Admin Review + Taxonomy — 2026-09-22

An admin can now open uncertain/incomplete/pending catalog records and act on them
without rerunning the AI intake pipeline: a real, database-backed review queue
(needs-review ingestion items — with or without a book row yet, open review
flags, pending duplicates, low-confidence fields, and missing useful metadata),
a Review Later resolution flow that finalizes an existing pending placeholder or
creates a brand-new book, a focused five-outcome duplicate comparison (same
edition / different edition / different language / false match / unresolved —
never a general merge engine), a fuller admin metadata editor with the same
presence-based correction philosophy Quick Edit already established, and real
physical-category and taxonomy-suggestion management (create/rename/
activate-deactivate categories with a safe-deactivation rule; a full
pending → approved/rejected/merged/postponed taxonomy suggestion lifecycle,
always gated behind an explicit admin action — AI never auto-creates a category).
Full detail: `docs/IMPLEMENTATION_STATUS.md`, `docs/TAXONOMY.md`, `docs/DATA_MODEL.md`,
`docs/DECISIONS.md`.

**One additive migration** (`drizzle/0004_phase8_admin_review_taxonomy.sql`): two new
`physical_categories` columns (`description`, `display_order`), and two new nullable
FKs (`ingestion_items.pending_book_id`, `taxonomy_suggestions.resolved_category_id`)
— no new tables, no destructive changes, safely upgrades an existing Phase 7 database
(verified with a real integration test run against the populated dev/E2E databases).

**A real coordination bug found and fixed during this pass**: resolving a duplicate
as "different edition/language" or "false match" recorded the decision but never
cleared the ingestion item's own stored `duplicateOutcome` — a subsequent Review
Later approval would have stayed permanently blocked by its own unresolved-duplicate
guard, even though the admin had just resolved it. Caught by an integration test
before it ever reached a real admin.

**Reused rather than re-implemented**: `resolveConfirmFields()` (Phase 7) for Review
Later's identity/category/provenance resolution; `rebuildSearchTextForBooks()`
(Phase 5) for category-rename and metadata-edit search consistency;
`generateEmbeddingForBook()` (Phase 5) for post-mutation embedding refresh, always
fire-and-forget and never able to block or fail an admin save.

**Deliberately not built this phase, and documented as such** (`docs/DECISIONS.md`):
Re-analyze Cover, a general book-merge engine, an existing-category merge engine,
any real collection-wide taxonomy analysis.

Tests: 581 unit (+50), 121 integration (+25), 145 E2E (+6). `npm run typecheck` /
`npm run lint` / `npm run build` all clean.

## Phase 8 correction pass — 2026-09-22

Ten concrete correctness/acceptance gaps fixed against reviewed Phase 8
(`4f6741829db50fd71dc94393859f15016de97219`), never a redesign of Admin Review,
taxonomy, search, or the database architecture. Full detail:
`docs/IMPLEMENTATION_STATUS.md`, `docs/DECISIONS.md`.

**Review Later metadata parity**: the existing-pending-book approval branch
(`finalizePendingBook`) was silently dropping subtitle, illustrators, publisher,
ISBN-10/13, and the trusted display cover — now persists the exact same data the
ingestion-only branch always did, and both derive the display cover through
Phase 7's own trust boundary.

**Review-flag lifecycle**: approval and same-edition duplicate resolution now
resolve only the flag types they genuinely address, never every open flag —
previously a newly-approved book's unrelated `missing_metadata` flag (or an
archived placeholder's unrelated `metadata_conflict` flag) could be marked
resolved as a side effect of an unconnected decision.

**Semantic embedding invalidation** (a real gap, not previously covered): Phase
5's live Find query trusts any non-null `embedding` outright — it never
compared the current document hash before this pass. An admin metadata/category
edit now clears the stale vector in the SAME transaction as the content change,
so a stale vector can never keep influencing semantic search, even briefly.

**Admin editor coverage**: the book-only metadata editor previously exposed only
description/category/age/format, while the review queue itself can surface
missing title/authors/language/publisher/ISBN/fiction-type/visual-style —
creating queue items with no way to actually resolve them. Now covers every
provenance-tracked field, organized as Identity/Classification/Discovery.

**A real human-verify control**: "Keep current category (mark verified)" — the
backend's `explicitlyVerifiedFields` support existed but no UI ever used it.

**Exactly-once concurrency**: a real transaction-ordering bug let a losing
concurrent SAME EDITION resolution's copy insert survive its own "already
resolved" error. Fixed with a claim-before-mutate atomic conditional update,
applied to every copy/book-creating path and proven with two genuinely
independent database connections racing each other in a real test.

**Duplicate target validation**: `resolveDuplicate()` now validates
`existingBookId` against the item's own persisted candidates before writing
anything, rejecting an arbitrary book id, an archived target, or self-targeting.

**Runtime input validation**: closes a real bug where `{ title: null }` (or an
invalid language code) silently kept the old required value while still
recording a false `human_corrected` provenance row, claiming a correction that
never happened.

**Audit truthfulness**: a category guidance-only edit is no longer logged as
`category_renamed`.

One additive migration (`drizzle/0005_...`, a defense-in-depth partial unique
index on `book_copies.source_ingestion_item_id`). Tests: 610 unit (+29), 145
integration (+24), 149 E2E (+4).

## Phase 8 final closure pass — 2026-09-22

Nine remaining review findings against reviewed Phase 8
(`b29370e6e155d8a5fcd404cad27d646bbbb5e1af`), never a reopening of its
architecture. Full detail: `docs/IMPLEMENTATION_STATUS.md`, `docs/DECISIONS.md`,
`docs/SECURITY.md`.

**Runtime ID/state validation, closed the rest of the way**: every remaining
admin id argument (`ingestionItemId`, `bookId`, `categoryId`, `flagId`,
`suggestionId`, `existingCategoryId`, a route-key-parsed id) is now checked with
the project's existing `isUuid()` convention before reaching a Postgres `uuid`
comparison, turning a malformed value into a calm not-found result instead of a
raw `invalid input syntax for type uuid` failure. Duplicate-resolution `action`,
review-flag `outcome`, and `explicitlyVerifiedFields` entries are validated
against their real, small vocabularies — no generic validation framework added.

**Effective Review Later age-range validation**: `approveReviewLater` now
validates the actual RESOLVED age min/max pair — after merging the admin's
edits with the draft's AI/proposed values — not just each individually-supplied
bound's own range, closing the case where raising only the minimum past an
untouched AI-suggested maximum previously reached the database constraint
directly.

**Inactive categories can no longer receive a new assignment**: both Review
Later approval and the general metadata editor now require the selected
category to exist and be active before accepting it as a new assignment — a
previously-assigned inactive category stays visible on its existing book, but a
fresh assignment must go through an active category, closing a bypass of the
existing category-deactivation safety model via direct Server Action
invocation.

**Evidence/Provenance in Admin Review**: the active-book Review Detail now
loads and displays current `book_field_provenance` as a restrained,
progressive-disclosure panel (auto-expanded only when a field genuinely needs
review), translated into calm English via a new pure `provenanceLabels.ts`
module — never a raw enum, table name, UUID, or decimal.

**Saved provider candidate evidence for Review Later**: the persisted Phase 7
draft's `metadataCandidates`/`reconciliationOutcome` are now shown inside the
existing evidence disclosure — provider, title, authors, publisher, language,
ISBN, and whether a candidate was the accepted one — read entirely from
already-persisted state, never a new Open Library/Gemini call.

**Stronger duplicate comparison evidence**: the comparison now shows the
existing book's display cover, ISBN-10/13, and edition alongside the prior
title/author/publisher/language/copy-count line (the latter two fetched via one
small supplementary query scoped to this admin-only view, since the shared
`Book`/`bookRepository` projection never populates ISBN for a real catalog
record). The two-column mobile action layout is unchanged.

**Truthful human-verification audit**: a verify-only save (an empty patch plus
`explicitlyVerifiedFields`) now audits as `metadata_verified`; a save mixing a
real correction with a verification audits as the bounded `metadata_updated`
with separate `correctedFields`/`verifiedFields`; a correction-only save stays
`metadata_corrected` — closing the case where the real "Keep current category"
control was being logged as a correction despite changing nothing.

**Uncertainty flags resolved by the correction that addresses them**: changing
`physicalCategorySlug`/visual media/visual realism now resolves the
corresponding `category_uncertain`/`visual_style_uncertain` flag exactly the
same way explicit verification already did — closing a redundant
correct-then-separately-resolve two-step for the far more common real
interaction.

Tests: 633 unit (+23), 157 integration (+13), 149 E2E (unchanged — existing
coverage re-verified against the new UI). `npm run typecheck` / `npm run lint`
/ `npm run build` / `npm run evaluate:search` all clean.

## Phase 7 complete — Add a Book, end to end — 2026-09-20/21

A teacher can now photograph a book cover and, ~30-60 seconds later, have it shelved:
identify → look up bibliographic metadata → check the real catalog for duplicates →
AI enrichment → confirm/Quick Edit/Review Later → save. Full detail:
`docs/AI_PIPELINE.md` (new), `docs/IMPLEMENTATION_STATUS.md`.

**A real, significant architecture correction**: the Phase 6-approved direct-browser-
to-Drive upload was proven, via real Chromium testing (not assumed), to be blocked
by Drive's CORS behavior — the `Origin` bound to a resumable session is fixed at
session-creation time, which happens server-side, so no browser origin is ever
authorized. Corrected to a server-mediated upload through this codebase's first
Route Handler; re-validated live afterward. Full evidence: `docs/DECISIONS.md`.

**Two real bugs the new E2E suite caught and fixed**: a silent no-op when saving
without an AI-suggested category, and a provenance-insert bug that violated a real
database constraint whenever Quick Edit was opened at all (`docs/DECISIONS.md`).
**A third gap found by comparing the built UI against the phase brief's own spec**:
Quick Edit was missing a Format field despite the wiring already existing
end-to-end — added.

**Real-provider validation**: one real photo from the actual SSJC Drive collection
("Kenny and the Little Kickers") went through the complete real pipeline —
Gemini identification, Open Library lookup, reconciliation, duplicate check, and a
real transactional save — successfully. Four more real photos (including 3 real
iPhone HEIC files, explicitly approved for this one-time bounded validation) hit a
real, investigated Gemini daily quota limit; reported honestly rather than retried
indefinitely or glossed over. See `docs/AI_PIPELINE.md` §10.

**Testing**: 342→420 unit tests, 68→82 integration tests, 101→113 E2E tests (real
Chromium + real WebKit), all passing.

## Phase 6 complete — real Google Drive validation passed — 2026-09-20

`npm run google:smoke` ran against the real, configured SSJC Drive folder ("Corridor
books," a My Drive folder) and passed end to end: connection + root verification, bounded
listing of the three pre-existing photographer subfolders (`Shirin`, `Diamond `, `Ray`,
all confirmed accessible and unchanged), a real resumable upload, server-side confirmation
with a real MD5 checksum, byte-for-byte download verification, cleanup of the disposable
test file, and confirmation that every pre-existing item survived unchanged.

Authorization used a personal Gmail account, not the SSJC Workspace account directly — the
Workspace currently blocks third-party OAuth authorization pending admin review, and no
Workspace setting was changed to route around this. The real Drive folder was shared to
that account with sufficient access. This is a working setup for continued development,
proven by the real pass above, but not a finalized production credential strategy — see
`docs/GOOGLE_SETUP.md` and `docs/IMPLEMENTATION_STATUS.md` for the open production decision
this leaves for later. No code changed in this update; documentation-only closure.

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
