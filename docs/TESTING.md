# Testing

Status: reflects what's actually built and run through Phase 7, including its real
Google Drive/Gemini/Open Library validation — every command below was executed
against the real project, not just written.

## Running the suite

```
npm run typecheck        # tsc --noEmit
npm run lint             # eslint
npm run test             # vitest run — unit tests, no database (includes Google Drive mocked tests)
npm run test:integration # vitest run against a real Postgres database (see docs/DATABASE_SETUP.md)
npm run test:e2e         # playwright test — E2E, against a real production build + real Postgres
npm run build            # next build

# Opt-in, requires real Google OAuth credentials — never part of the above, never CI:
npm run google:smoke     # a real, bounded, self-cleaning round trip against the configured Drive folder
```

`npm run test:e2e` builds and starts the app itself (`playwright.config.ts`'s `webServer`)
against fixture credentials computed at config-load time — nothing sensitive is ever written
to disk. No real environment variables or `.env.local` are needed for `test`/`test:e2e`/`build`
(the E2E suite's `webServer` supplies its own fixture credentials and its own `DATABASE_URL`
pointed at `E2E_DATABASE_URL`). `test:integration` requires `TEST_DATABASE_URL` to be set (see
`docs/DATABASE_SETUP.md`) — Phase 4's brief is explicit that real database tests must run
against an actual Postgres instance, never a mocked Drizzle client.

## Unit tests (Vitest) — `tests/unit/`

| File | Covers |
|---|---|
| `auth/session.test.ts` | Token creation/verification, admin elevation activity/expiry, sliding renewal (including the "admin elevation lapsed → downgrade to staff on renewal" path), rejection of garbage/wrong-secret/expired tokens |
| `auth/password.test.ts` | bcrypt verification: correct, incorrect, empty, and unconfigured-hash cases |
| `auth/rateLimit.test.ts` | Throttling allows attempts under the threshold, blocks at the threshold, resets on success |
| `validation/auth.test.ts` | The login form's Zod schema accepts/rejects appropriately |
| `catalog/age.test.ts` | `formatAgeRange` display conversion, `bookMatchesAgeYears` (including the "requested year's midpoint must fall in range, not just its start" edge case), `parseAgeYearsFromText` phrasings |
| `catalog/duration.test.ts` | `getReadDurationBand` boundaries (exactly 5 and exactly 10 minutes), `parseDurationBandFromText` phrasings, including that an explicit minute count is resolved through the same banding function as real durations |
| `search/normalize.test.ts` | Text normalization, diacritic stripping (including the ø/æ fix), stop-word removal |
| `search/rank.test.ts` | Exact-title-over-tag-only scoring, zero score for no/generic-word-only matches, author-match credit, age/realism intent bonuses only applying when genuinely satisfied |
| `search/filters.test.ts` | AND-across-groups / OR-within-a-group semantics, age/duration/illustration-style filter matching, and (Phase 4 correction pass) a multilingual book matching a filter on either its primary or an additional language |
| `search/facets.test.ts` (Phase 4 correction pass) | A multilingual book's additional languages appear as real facet options, never duplicated, alongside primary-language-only books unaffected |
| `catalog/languages.test.ts` (Phase 4 correction pass) | The centralized ISO 639-1 registry recognizes the six original fixture languages plus a real code outside them (e.g. "de"/German), rejects a non-code, and the Zod boundary schema matches the same way |
| `metadata/fieldRegistry.test.ts` (Phase 4 correction pass) | The `book_field_provenance.field_key` registry validates every currently-tracked key (including the `age_range` example `docs/DATA_MODEL.md` §4 names), rejects an untracked key, and every key maps to one of the documented identity/category/age/visual/metadata concepts |
| `utils/uuid.test.ts` (Phase 4 correction pass) | `isUuid`/`uuidSchema` accept real UUIDs case-insensitively and reject malformed values |
| `components/CatalogErrorFallback.test.tsx` (Phase 4 correction pass) | The Find/Book Detail error boundary shows only the calm generic message — never the underlying error's own text, even when that text looks SQL/driver-shaped — and its retry button calls `reset` |
| `search/autocomplete.test.ts` | Minimum-length gating, catalog-derived suggestions, category-vs-topic type labelling, prefix-over-substring ranking, deduplication, result cap |
| `search/urlParams.test.ts` | Query/filter round-trip through URL search params |
| `search/searchBooks.test.ts` | Every deterministic scenario the brief names by example — see below |
| `voice/messages.test.ts` | Every voice status message, the privacy note's exact wording (no "on-device" claim, no audio-saving claim), button label changes |
| `voice/speechRecognition.test.ts` | Capability detection (both `SpeechRecognition` and `webkitSpeechRecognition`), final/interim transcript extraction, an empty-but-final transcript vs. no result at all |
| `voice/useVoiceSearch.test.ts` | The full status machine against a scripted fake `SpeechRecognition`: idle→listening→processing, no-speech (both an empty final transcript and the browser ending with no result at all), permission-denied, generic error, cancel→idle, and a dedicated assertion that `localStorage.setItem` is never called during a listening session |
| `components/SearchInput.voice.test.tsx` | Component-level: a final transcript navigates through the exact same `buildFindHref()` URL typed Enter produces, with existing filters preserved; cancel restores the pre-voice query without navigating; no-speech/permission-denied/unsupported all render the right calm copy |
| `reading-lists/format.test.ts` | `formatCreatedBy` (Anonymous fallback for undefined/whitespace), `formatBookCount` pluralization, `formatListDate` (including an unparseable-date fallback), `isBookInList` |
| `reading-lists/localStorageRepository.test.ts` | Every repository method against real `localStorage` (jsdom) — this class is no longer used in production (see Phase 4 below) but stays covered as reference/example code |
| `components/ReadingListsProvider.test.tsx` (Phase 4) | The client-side load-failure path: a rejected `getAll()` surfaces the calm "couldn't be loaded" message, distinct from a genuinely empty list; a successful empty load shows the real empty state, not an error. This replaces E2E coverage of the old "corrupted localStorage" scenario, whose premise no longer applies now that Reading Lists aren't stored in the browser at all — see below |
| `embeddings/document.test.ts` (Phase 5) | `buildEmbeddingDocument` determinism (byte-identical output, stable `sourceHash`), tag alphabetical sorting, omitting undefined fields entirely (never `undefined`/`null`/`NaN` in the output text), multilingual primary+additional language names; `buildSearchIndexText` never contains structural label words (the "Read-aloud length" regression), still contains every real content value |
| `embeddings/fakeProvider.test.ts` (Phase 5) | Deterministic (same text → same vector), different text → different vector, correct dimensionality, L2-normalization, `embedDocuments` matching `embedQuery` per-text |
| `embeddings/index.test.ts` (Phase 5) | `getConfiguredEmbeddingProvider()` returns `undefined` (never throws) with no `GEMINI_API_KEY`, returns a real `GeminiEmbeddingProvider` when one is set |
| `search/hybridScore.test.ts` (Phase 5; extended in the real-provider validation pass) | Each retrieval signal's contribution in isolation (exact/FTS/trgm/semantic), the full-text/semantic contribution caps relative to `exactTitle`, a vector distance at or beyond the meaningful ceiling contributing nothing, an exact deterministic match outranking a purely semantic match on an unrelated book, threshold filtering (never pads), deterministic alphabetical tie-break; plus (real-provider validation) the exact 0.30 boundary is a real, evidence-based value, not the placeholder `1` it used to be |
| `search/intent.test.ts` (Phase 5 correction pass) | Direct audit of `parseSearchIntent` against every documented phrasing: an age-range midpoint ("2 to 5"), an explicit age, a duration range not colliding with the age-range regex, "real photos" vs. bare "realistic", "watercolor"/"collage" illustration styles, a catalog language name, an explicit minute count, and a query with no recognizable structured signal |
| `search/rank.test.ts` (extended, Phase 5 correction pass; extended again in the real-provider validation pass) | Fiction/nonfiction, format-name, and category-name keyword matching — the soft/strong structured-fit signals `docs/SEARCH.md` §2's hard/strong/soft table documents — plus confirmation that an unrecorded format/fiction status never fabricates a match; plus (real-provider validation) a category/format match is never credited from a query word that's merely a substring of a category/format word (the "day"/"everyday" collision), and "very" is never credited as a meaningful token via tag/description matching (the "very"/"every" collision) |
| `search/normalize.test.ts` (extended, Phase 5 correction pass) | `normalizeTitle` — the one canonical title normalizer now shared by both the storage side (`seed.ts`) and the query side (`searchRepository.ts`'s exact-match condition) — strips a leading article, and a query retyped WITH its article normalizes to the same value as one without |
| `search/autocompleteAction.test.ts` (Phase 5 correction pass) | `autocompleteAction`'s own ordering logic (prefix-first, then the documented type priority, then alphabetical) with `searchRepository.autocomplete` mocked — including topic and language rows passing through untouched |
| `embeddings/geminiProvider.test.ts` (Phase 5 correction pass; extended in the real-provider validation pass) | The asymmetric retrieval input contract actually reaches the network request: `embedQuery` wraps its input as `"task: search result \| query: …"`, `embedDocuments` wraps each input as `"title: none \| text: …"`, and the two differ for identical underlying text — `fetch` is mocked, so this proves the contract is applied, never real semantic quality; plus (real-provider validation) retry-on-429 behavior: retries once then succeeds, respects a numeric `Retry-After` header, gives up after `MAX_RETRIES` and surfaces the real HTTP error, never retries a 400 |
| `components/SearchInput.autocomplete.test.tsx` (Phase 5 correction pass) | A topic suggestion renders with the "Topic" type label and a language suggestion with the "Language" label — UI-level proof that `AutocompleteRow`'s always-declared types actually reach the screen |

| `intake/reconciliation.test.ts` (Phase 7) | `resolveProviderLanguage` (ISO code passthrough, MARC mapping, display-name resolution, unrecognized→`undefined`); `reconcileIdentity` outcome thresholds (ISBN-alone high-confidence, title+author high-confidence, title-only ambiguous, no-evidence never producing a false positive, multi-candidate ranking, conflicting-language not falsely credited, publisher substring match, punctuation-normalized ISBN match) |
| `intake/categorySuggestion.test.ts` (Phase 7) | `validateCategorySuggestion` accepts a genuinely active slug, returns `undefined` for null/invented/deactivated slugs, and the label always comes from the real active category, never the model |
| `intake/draft.test.ts` (Phase 7) | `IntakeDraftSchema` round-trips a valid draft unchanged; `readIntakeDraft` returns `undefined` (never throws) for null/garbage/stale-schema-version input; `parseIntakeDraft` throws on a genuinely invalid draft and strips any `teacherEdits` field outside the limited correction surface |
| `intake/imagePrep.test.ts` (Phase 7) | Real `sharp` resize of a real oversized JPEG/PNG (aspect ratio preserved, never upscaled), real HEIC/HEIF passthrough (the documented sharp limitation), and a genuinely corrupt-bytes fallback that never throws |
| `ai/retry.test.ts` (Phase 7) | `withGeminiRetry` succeeds immediately, retries on 429/503 then succeeds, gives up after `MAX_RETRIES` with the real error, never retries a 400 or a status-less error — real timers faked, not slept |
| `ai/geminiProvider.test.ts` (Phase 7) | `GeminiBookIntelligenceProvider` against a mocked `@google/genai` SDK: configuration-missing/invalid-image guards, a well-formed response Zod-validates correctly, the image is sent as base64 `inlineData` with the given MIME type, the documented model id is used, malformed/schema-violating/empty responses all map to `invalid_response`, 429/503 map to `rate_limited`/`transient_provider_failure` after internal retries, a single transient 503 recovers via retry, no raw provider error text leaks into the mapped error, enrichment never sends image bytes, injects only the real active category list into the prompt, and rejects an out-of-vocabulary `fictionType` |
| `metadataProviders/googleBooksProvider.test.ts` / `openLibraryProvider.test.ts` (Phase 7) | Configuration-missing guard (Google Books); no-signal short-circuit (no `fetch` call); ISBN query preferred over title/author; real-shaped result normalization including split ISBN-10/13; no-results never fabricates a candidate; genuine HTTP error/malformed-JSON/timeout mapping; Open Library's descriptive `User-Agent`, current `/search.json` endpoint (never the legacy one), and MARC language passthrough |
| `metadataProviders/cache.test.ts` (Phase 7) | `buildCacheKey`: ISBN-based key normalization, ISBN preferred over title/author, genuinely different keys for different evidence shapes, author-order-independent, stable with no signal at all |

Environment note: tests run with `environment: "node"`, not `jsdom` — an early attempt to use
`jsdom` caused `jose`'s WebCrypto key handling to see cross-realm `Uint8Array` instances and
fail with a cryptic key-type error. Since Phase 1's unit tests are pure logic with no DOM
dependency, `node` is both correct and faster; `jsdom` remains available per-file via a
`// @vitest-environment jsdom` pragma whenever a later phase adds component tests that
actually need a DOM.

## Integration tests (Vitest, against a real Postgres) — `tests/integration/`

Run with `npm run test:integration`, against `TEST_DATABASE_URL` — migrated and seeded exactly
once per run via a Vitest `globalSetup`. Nothing here mocks Drizzle, the schema, or a query
result; every assertion is a real round-trip to a real running Postgres instance.

| File | Covers |
|---|---|
| `db/migrations.test.ts` | The committed migrations actually produce all 23 tables; a handful of specific columns/constraints/indexes exist as designed (the `books_isbn13_unique` partial index, the age check constraints, the `book_field_provenance` current-row partial unique index) |
| `db/bookRepository.test.ts` | `DrizzleBookRepository` against real seeded data: correct book count, contributor ordering via `array_agg(... order by sort_order)`, multi-value `visual_media_type` arrays round-tripping correctly, `copyCount` matching a real `count(*)` on `book_copies`; (Phase 4 correction pass) the multilingual seed book's `additionalLanguageCodes` projected by the repository itself — not merely visible via a raw `book_languages` query — including "de" (outside the original six fixture languages), and a single-language book's `additionalLanguageCodes` staying `undefined` |
| `db/readingListRepository.test.ts` | Full CRUD, idempotent `addBook` via the composite primary key, and the mandated **two-independent-connection acceptance test**: a list created and populated through one `DrizzleReadingListRepository` instance (its own separate Postgres connection) is immediately visible, with the same data, through a second, completely independent instance/connection — the actual proof that Reading Lists are genuinely shared, not just that one repository method returns the right object; (Phase 4 correction pass) `createWithBook` as one atomic transaction (the new list already contains the book; both rows persist; a nonexistent book fails the *entire* operation and leaves no orphan list), typed domain errors (`ReadingListNotFoundError`/`BookNotFoundError`/`InvalidIdError`) instead of raw foreign-key/UUID-syntax exceptions, and malformed ids treated as a safe no-result for `getById`/`delete` |
| `db/searchRepository.test.ts` (Phase 5, extended in the correction pass) | Catalog visibility (pending/archived books never appear in candidates, facet rows, or autocomplete, active/incomplete-metadata books still do); exact/near-exact matching (author full name, exact title); full-text OR-semantics (a multi-word descriptive query returns real results; a filler query returns none — the "read"-label regression); trigram floor (a real typo is a candidate, an unrelated query isn't); language hard-filtering via primary+additional; incomplete metadata never producing an invented format/realism/duration value; structured intent producing real SQL candidates, not just a ranking bonus; vector storage/distance retrieval; **topic/tag and language autocomplete** (a real tag/language autocompletes, one used only by a `pending_review` book never does, and one used only as an ADDITIONAL language on an active book still does) |
| `db/migrationUpgrade.test.ts` (Phase 5 correction pass) | The exact scenario `docs/SEARCH.md` §4 describes: a fresh database is brought to precisely the Phase 4 (migration `0000`) schema state with real relational data inserted directly, the real Phase 5 migrations (`0001`/`0002`) are applied via drizzle's own `migrate()` — not a stripped-down copy of the migrations folder — confirming `search_text`/`search_vector` are NULL/empty immediately after (reproducing the bug), then correctly backfilled (title, contributor, publisher, category, tag, and additional-language content, each independently verified as full-text-searchable), backfilling twice is a no-op (idempotent), the book's id/copy count/Reading List reference all survive unchanged, and editing the book's metadata afterward both updates conventional search and makes a previously-stored embedding's source hash detectably stale |
| `db/boundedPagination.test.ts` (Phase 5 correction pass) | 300 synthetic active books sharing one category (substantially more than any candidate-retrieval limit elsewhere in this codebase) — `findVisibleBookIdsPage` never returns more than `limit + 1` rows regardless of the real total, returns deterministic `sort_title` order, `countVisibleBooks` returns the exact real total (not a capped candidate-pool size), `hasMore` is `false` once `limit` reaches the true total, and (the actual proof, via `vi.spyOn(bookRepository, "getBooksByIds")`) a 5-result and a 15-result ("Show More") page each project only that many books, never all 300 |
| `db/duplicateMatcher.test.ts` (Phase 7) | `findDuplicateCandidates` against the real seeded catalog — exact ISBN match, exact title+author+language match, same-title-different-language, same-title-no-author-overlap, an empirically-measured `pg_trgm` similarity case for `ambiguous_similar_title` (the real score was measured against this database, not assumed), no-match for a genuinely unrelated title, and an archived book never surfacing as a duplicate even on an exact ISBN match |
| `db/persistence.test.ts` (Phase 7) | `saveNewBook` creates a book + its physical copy + marks the ingestion item completed, all in one transaction; a title-less save is rejected before any transaction opens; an invalid category slug rolls back the *entire* transaction (no orphaned book row, ingestion item stays `processing`); `addAnotherCopy` inserts a copy without mutating the existing book and throws for a nonexistent book id; `saveForReview` marks `needs_review` with the full draft and creates no book when no `pendingBook` is given, or a real `pending_review` book + `review_flags` row when one is |

## Search evaluation (Phase 5, expanded in the correction pass) — `tests/evaluation/`

Run with `npm run evaluate:search`, against `TEST_DATABASE_URL` (same seeded database as the
integration suite). A committed, human-readable dataset (`tests/evaluation/dataset.ts`, **41
cases** across known_item/structured/safety/exploratory — expanded from an initial 13) run
through the real `SearchService` and reported as recall / top-1 / **top-5** / prohibited-result
violations, broken down **per category**, not just one aggregate number — see `docs/SEARCH.md`
§11 for the full case inventory. Two development-only evaluation fixtures ("Back Before You Know
It," "My First Day at Oakwood") are inserted and removed by the evaluation harness itself, never
part of `src/db/seed.ts`, for the two exploratory themes the real 48-book catalog has no credible
match for. This is a *report* as much as a test: a genuine regression fails it loudly rather than
being tuned away, and it is what caught the structured-intent-candidate regression (§2) before it
shipped in the original Phase 5 work, and (2026-09-17) the too-loose semantic-distance ceiling
and the "very" substring collision before either reached the live product's default configuration
— see `docs/DECISIONS.md`. **41/41 cases pass** as of this writing (34 recall checks, 9 top-1
checks, 1 top-5 check, 0 prohibited-result violations). **When a real `GEMINI_API_KEY` is
present, the harness's own `beforeAll` now generates real embeddings for that run's
seeded+fixture books before the cases run**, and the report's own final line states plainly which
mode actually ran (`REAL HYBRID` vs. conventional-only) — never silently assumed either way. At
least one fully clean real-hybrid run (0 embedding failures) reproduced this same 34/34, 9/9,
1/1, 0-violation result under genuine real-hybrid conditions. This test issues one live
query-embedding call per case (41 total) plus one bulk document-embedding call in a tight loop —
denser real API usage than any real user's search pattern — and has visibly hit the provider's
own rate limit under repeated back-to-back runs during validation (its timeout was raised to
120s accordingly). When no key is configured, every case still runs conventional retrieval only,
reported as such; deterministic fake embeddings elsewhere in this codebase still prove
storage/retrieval/scoring mechanics only, never cited as semantic-quality evidence.

## Google Drive unit tests (Phase 6) — `tests/unit/googleDrive/`

All mocked at the HTTP boundary (`fetch`) — never real network calls, never dependent on
real credentials, always part of the normal `npm test` run. See
`docs/GOOGLE_INTEGRATION.md` for the architecture these tests cover.

| File | Covers |
|---|---|
| `config.test.ts` | Missing client id/secret/refresh token/root folder id (individually and all at once); a whitespace-only value treated as missing; configuration errors never contain a real secret value; `isDriveConfigured()` never throws. |
| `validation.test.ts` | Every allowed source-cover MIME type accepted, an unsupported one rejected; size validation (valid, zero, negative, `NaN`, `Infinity`, over the 25 MiB limit); filename normalization (path separators replaced, control characters/null bytes stripped, whitespace collapsed, throws `invalid_file` when nothing survives). |
| `retry.test.ts` | Immediate success (no retry); retries a 429 and a transient 503 then succeeds; honors a numeric `Retry-After` header; gives up after the bounded maximum (4 total attempts) and returns the last real response; never retries 400/401/403/404; retries then recovers from a network-level failure; rethrows after exhausting retries on a persistent network failure. |
| `rootContainment.test.ts` | The root itself, a direct child, and a multi-level nested descendant are all contained; a file entirely outside the root is denied; an inaccessible parent denies safely without throwing; a cycle in the ancestry graph terminates and correctly denies (even a cycle that *also* has a branch reaching the root still resolves correctly); a chain longer than `MAX_ANCESTRY_DEPTH` is denied, one within it succeeds; multiple parents are contained if any one path reaches the root. |
| `oauthClient.test.ts` | Successful token exchange; the refresh token/client id/secret are actually sent to Google's token endpoint; expiry parsing and in-memory reuse before expiry; refresh triggered again once within the expiry safety margin, not before; `invalid_grant` mapped to `authorization_revoked_or_invalid`; 401 → `authorization_required`; 429 → `rate_limited`; a persistent 5xx → `transient_provider_failure`, a transient one recovers on retry; a thrown error never contains the real client secret or refresh token used in the test; `configuration_missing` is thrown without ever calling `fetch` at all. |
| `googleDriveProvider.test.ts` | `verifyConnection` for both a My Drive-style and a Shared Drive-style root, and its failure mappings (missing/trashed/not-a-folder root → `root_folder_missing`; revoked credential → `authorization_required`); bounded `listChildren` (page-size cap, pagination token round-trip, parent-scoped/trashed-excluded query, Shared Drive compatibility flags, denies a folder outside the root); `getFileMetadata` normalization (a rename doesn't change `id`, missing-file/permission-denied mappings, a malformed non-JSON response) **and (2026-09-20 correction) root-scoping**: succeeds for a direct child, a nested descendant, and the configured root itself; rejects an accessible-but-outside-root id with `outside_configured_root`; a compile-time-only check (`@ts-expect-error`, verified by `npm run typecheck`) that the private raw-metadata fetch never reaches the public `CoverStorageProvider` interface; `verifyConnection` continuing to work correctly (not circular); `downloadSource` (real byte return, refuses a folder/trashed file/no-download-capability file); `initiateResumableUpload` (returns the `Location` header as `sessionUri`, `upload_failed` when Google omits it, pre-Drive-call rejection of an unsupported MIME type or oversized file *before* any network call, an invalid or outside-root parent, the session URI never appearing in a thrown message); `confirmUploadedFile` (a valid match; parent/MIME/size mismatches — including a mismatched-but-still-in-root parent, which is a business-rule failure, not a security one; outside-root; missing file); a dedicated secret-safety test across a realistic `verifyConnection` failure. |
| `smokeOrchestration.test.ts` (2026-09-20 correction) | The pure, provider-injected orchestration behind `npm run google:smoke`, against an in-memory fake `CoverStorageProvider` — proves the cleanup guarantee directly: a fully happy-path run cleans up via Step F and calls `trashFile` exactly once; an upload failure (Step C) never calls `trashFile` at all (no file was ever created); a confirmation failure (Step D), a download failure (Step E), a byte-mismatch, a Step F safety-check failure, and a Step G mutation-safety failure each still trigger a real cleanup attempt after a successful upload; a cleanup failure is reported in its own field, never overwriting or hiding the original validation failure; the disposable-prefix guard (`isSafeToCleanUp`) is tested directly. |

**Real Google connectivity is never exercised by these tests or by `npm test`/CI** — see
"Real Google smoke test" below.

## Real Google smoke test (Phase 6, opt-in, requires real credentials) — `npm run google:smoke`

**Not part of `npm test`, `npm run test:integration`, or any CI gate.** Requires real
`GOOGLE_OAUTH_CLIENT_ID`/`GOOGLE_OAUTH_CLIENT_SECRET`/`GOOGLE_OAUTH_REFRESH_TOKEN`/
`GOOGLE_DRIVE_ROOT_FOLDER_ID` (`docs/GOOGLE_SETUP.md`) — exits with a clear
`configuration_missing` message and a non-zero exit code when they aren't present, rather
than silently skipping or fabricating a result.

Performs, against the real configured Drive folder: (A) OAuth token refresh + root
verification; (B) a bounded listing of the root's immediate children plus a tiny bounded
metadata sample from up to three child folders — no download, no processing, no
renaming; (C) generates a real, valid, tiny PNG entirely in memory (constructed
chunk-by-chunk with real CRC32s via `scripts/google/smokeOrchestration.ts`'s own
`generateTinySyntheticPng()`, never a binary asset committed to the repository) and
uploads it through the real resumable-upload implementation — the same code path the
future Phase 7 upload flow will use, not a shortcut; (D) confirms the resulting file
server-side; (E) downloads it back and verifies a byte-for-byte match; (F) trashes only
that exact disposable file, after independently re-checking its id, filename prefix, and
root containment; (G) lists the root again and confirms every pre-existing child id
survived unchanged, printing `existing library assets modified: NO` only when that's
genuinely demonstrated. **Run against real credentials 2026-09-20 and passed** — full
transcript in `docs/IMPLEMENTATION_STATUS.md`, "Real Google validation, 2026-09-20." The
real configured root ("Corridor books") is a My Drive folder with three pre-existing
photographer subfolders, all confirmed unchanged after the test.

**Cleanup guarantee (2026-09-20 correction):** the step orchestration
(`scripts/google/smokeOrchestration.ts`'s `runSmokeTest`) attempts to trash the disposable
test file from every failure path once Step C has created one — not just the Step F happy
path — so a confirmation, download, or safety-check failure never orphans
`__ssjc_phase6_smoke_*.png` in the real configured root. This is deterministically proven
by `smokeOrchestration.test.ts` against a fake provider, not something only a real Drive
run can demonstrate. `scripts/google/smoke.ts` itself is now a thin CLI wrapper around that
tested orchestration.

## E2E tests (Playwright) — `tests/e2e/`

Run against **real Chromium and real WebKit** (the mobile project uses WebKit specifically,
because that's the engine behind iPhone Safari — the brief is explicit that this app will be
used heavily on phones, so testing only against Chromium would have missed a real bug, below).

| File | Covers |
|---|---|
| `auth.spec.ts` | Welcome screen rendering, Tap to Enter reveal, wrong/right password, show/hide toggle, full keyboard-only login, route protection on every protected path, logout, admin unlock (wrong/right password), admin elevation clearing on logout |
| `navigation.spec.ts` | The one remaining placeholder Home destination (Teacher Catalog) reaches its "coming later" state and can navigate back; the two primary tiles are meaningfully larger than secondary nav items — Find/Reading Lists/Guide/Add a Book each graduated to a real experience with its own spec file (Phase 7 removed Add a Book from this file's placeholder list) |
| `find.spec.ts` | The ten numbered flows the brief requires — see below |
| `voice.spec.ts` | A scripted fake `SpeechRecognition` (installed via `page.addInitScript()`, never a real microphone) exercising the real production UI: Home → Find → voice → mocked transcript → normal results; existing filters survive a voice search; no-speech, permission-denied, cancel, and an unsupported-browser fallback |
| `readingLists.spec.ts` (Phase 4: desktop project only, serial order — see the comment at the top of the file) | Empty/populated overview, the Add-to-list dialog's no-lists-yet state, create (required name, optional/whitespace/trimmed creator), a list surviving reload, rename, delete with confirmation (and cancelling it), an empty list's guidance, add-to-list from both Search Results and Book Detail (including that it never accidentally navigates to Book Detail), duplicate-add idempotency and "Already added" messaging scoped to the test's own list, remove (without touching the catalog), Book Detail↔list-detail return navigation, a malformed/external `from=` value falling back safely, a nonexistent list id's not-found state, a full keyboard-only create flow, and (Phase 4 correction pass) the **actual two-independent-browser-context acceptance test**: two separate `browser.newContext()`s, each with its own login/cookies, proving a list Context A creates — and a book Context A adds to it — is visible to Context B without Context B doing anything itself |
| `guide.spec.ts` | The real Guide renders with one `<h1>` and the expected section headings; the physical-category-vs-tags example matches real fixture data; the alphabetical-return rule is stated; Add a Book/Review Later are described in the future tense with no fake button; links to Find a Book and Reading Lists work; the shared-across-staff nature of Reading Lists is disclosed (Phase 4: no longer "device-local") |
| `addBook.spec.ts` (Phase 7) | The full Add-a-Book flow against deterministic fixtures (`E2E_FAKE_INTAKE_PROVIDERS=true`, real Drive/Gemini/metadata calls skipped entirely — never a live API in this suite; see `docs/AI_PIPELINE.md` §9): cover selection preview + Change Photo; a full new-book save requiring a Quick Edit category (no AI configured in E2E); a real, visible save-time error instead of a silent no-op (see the two real bugs below); exact-duplicate detection against the real seeded "The Gruffalo" fixture leading to Add Another Copy; Review Later preserving the intake; an unsupported file type rejected before any upload begins. Runs on both the desktop and mobile (real WebKit) projects — unauthenticated `/add` access is already covered by `auth.spec.ts`'s own route-protection test. **Two real bugs this suite caught and fixed**: `AddBookFlow`'s save handler silently no-op'd when no category had been AI-suggested and Quick Edit was never opened; `confirmSaveAction`'s provenance list wrote two competing "title" rows whenever Quick Edit was opened at all, violating `book_field_provenance`'s real one-current-row-per-field unique index. See `docs/DECISIONS.md`/`docs/CHANGELOG.md` for both. |

Phase 4 correction pass also added two `find.spec.ts` cases (run on both projects, like the
rest of that file): a malformed Book Detail id (`/books/not-a-uuid`) and a valid-but-nonexistent
UUID both render the calm "Book not found" state, never a database error.

**103 tests, 0 failures against the Phase 5 architecture** (same count as the Phase 4 correction
pass — no new E2E test files were needed; the existing `find.spec.ts` flows exercise the new
real search pipeline end to end without modification, aside from the two fixes below).
`readingLists.spec.ts` runs on the desktop project only (18 tests, serial, including the
two-browser acceptance test), everything else still runs on both mobile/WebKit and
desktop/Chromium. Re-run three consecutive times end to end
with no flakes before being
considered done.

### Find a Book flow coverage (`find.spec.ts`)

Every flow the brief names by number: (1) topic search → open a result → back, preserving
the query in the URL; (2) autocomplete, keyboard-selected, not just clicked; (3) the
"animal books with real photos" case, asserting the *top* result is genuinely real
photography (a free-text match, not a hard filter — see docs/SEARCH.md for why only the top
result is asserted, not every result); (4) Swedish-language filtering; (5) age-4 filtering;
(6) Under-5-minutes duration filtering; (7) three filter dimensions intersecting correctly;
(8) the mobile filter dialog end to end (open, change, apply, confirm the resulting URL and
active-filter chip); (9) Show More revealing more than the initial five; (10) the zero-result
recovery state. Flows 4–7 and 9 run against the real Filters dialog UI (clicking real
checkboxes/buttons), not by constructing URLs directly — so a regression in the dialog itself
would be caught, not just a regression in the URL-parsing logic underneath it.

### Real bugs this suite caught — Phase 1

The mobile/WebKit project initially failed 10 of 38 tests — every test that performed a
*second* navigation after login (clicking any Home link, or logging out) landed back on the
Welcome screen instead of its destination, while the *first* navigation (login itself) always
worked. Root-caused by adding temporary request logging to the proxy and inspecting real
server output (not guessed at): the session cookie's `Secure` flag, tied to
`NODE_ENV === "production"`, was being set even though the test server runs over plain HTTP;
Chromium tolerates `Secure` cookies on `localhost` as a developer convenience, WebKit doesn't
reliably extend that tolerance to client-side `fetch()`-driven navigations. Fixed by adding an
explicit `SESSION_COOKIE_SECURE` override (full writeup in `docs/SECURITY.md`). This is
exactly the class of bug that only shows up on a real device engine — a good justification,
in hindsight, for the extra setup cost of installing and testing against WebKit rather than
treating Chromium as sufficient.

A second, smaller bug the suite caught: "Find a Book" / "Add a Book" were built as plain
`<span>` elements rather than real headings, which an accessibility-minded E2E assertion
(`getByRole("heading", ...)`) correctly failed on — fixed by making them `<h2>` elements,
which also directly serves the brief's heading-hierarchy accessibility requirement, not just
the test.

### Real bugs this suite caught — Phase 2

Writing `tests/unit/search/searchBooks.test.ts` against the real fixture catalog (not
synthetic data) surfaced three genuine ranking bugs before any UI existed to hide them — full
writeups in `docs/SEARCH.md`: an author-name collision ("Eric Carle" also matching "Eric
Hill"), a stop-word gap that let "age" boost unrelated books tagged "courage," and a
fixture-description wording accident that let a stylized picture book match a real-photograph
search. A fourth, `normalizeSearchText("Frøet")` producing `"fr et"` instead of `"froet"`, was
caught by a plain diacritics unit test. All four are exactly why the domain logic was tested
in isolation before wiring it to any component — none of them were visible from reading the
code casually, only from asserting on real behavior.

Visual QA also caught one non-bug worth recording: the mobile Filters dialog's first category
pill ("Animals & Nature") appeared to render in a highlighted state in an early screenshot,
which looked like a stray pre-checked filter. Re-captured with the test's mouse cursor moved
away first, it was confirmed to be a CSS `:hover` artifact from the Playwright click that had
just opened the dialog landing at the same screen coordinates as the new pill underneath —
not an application bug — and required no code change.

### A real bug found outside any test suite: bcrypt hashes silently mangled by `.env` loading

Setting up real local credentials for the first time surfaced a bug no automated test had
caught, because the E2E suite's own env-injection path (`playwright.config.ts`) turned out to
have the exact same latent bug — it just hadn't been triggered yet, since it only manifests
once a `.env.local` file exists anywhere in the project. Full root-cause in `docs/SECURITY.md`
and `docs/DECISIONS.md`; fixed in both `scripts/hash-password.mjs` and
`playwright.config.ts`, with a new regression test
(`tests/unit/scripts/hashPassword.test.ts`) that reimplements the exact expansion behavior
that caused it and asserts the escaped form survives while an unescaped one doesn't. Worth
noting as a testing-process lesson: this bug was invisible to the existing E2E suite precisely
*because* that suite's own fixture generation had the same flaw — a bug and its test coverage
sharing the same blind spot is a real risk whenever the test harness and the thing it's
testing both touch the same non-obvious platform behavior.

### Real bugs this suite caught — Phase 3

None of these are search bugs — all three are in the new Reading Lists/voice UI, caught by
this phase's own testing:

1. **A native HTML `required` attribute silently blocked the custom validation message.** The
   Create/Rename/Add-to-list name fields had both `required` and a JS `handleSubmit` check
   that sets an accessible `role="alert"` error — but the browser's own validation UI
   intercepted the empty submission first, so the custom message never rendered. Caught by an
   E2E assertion expecting that message to appear after clicking submit with an empty field.
   Fixed by removing `required` everywhere a field already has this pattern.
2. **The Add-to-list dialog auto-skipped its "select an existing list" view whenever no lists
   existed yet**, jumping straight to the create-new-list form. The JSX for the empty-list
   case (a "You don't have any reading lists yet" message plus a "Create new list" button) was
   already correct; a separate `handleOpenChange` shortcut bypassed it entirely. Every test
   starting from a fresh browser context (i.e., most of them) hit this, several timing out
   waiting for a "Create new list" button that was never rendered because the dialog had
   already skipped past it. Fixed by removing the shortcut — the existing empty-state JSX was
   the right behavior all along.
3. **`react-hooks/set-state-in-effect`** (a newer, stricter lint rule) caught a real instance
   in `ReadingListsProvider`'s mount effect: calling a local `useCallback`-wrapped `refresh()`
   function that itself calls `setLists`, from inside a `useEffect`. Fixed by inlining the
   repository call and handling its resolution directly in the effect instead of through a
   named helper — see `docs/AGENT_HANDOFF.md` for the general pattern (also hit, and fixed the
   same way, in `SearchInput`'s voice-transcript effect).

A fourth finding was a genuine cross-browser platform difference, not an app bug: **WebKit's
default Tab order excludes plain `<button>` elements** unless the OS's Full Keyboard Access is
on. A keyboard-only E2E test that tabbed through a dialog's Cancel/Submit buttons passed on
desktop/Chromium and failed on mobile/WebKit. Rewritten to submit via Enter from within the
last text field instead — both the more realistic keyboard interaction and the one that's
reliable on both engines.

### Real bugs this suite caught — Phase 4

1. **`readingLists.spec.ts` broke almost entirely on the first Postgres-backed run (34 of 98
   test instances failing)** — not an application bug, but a real, important discovery: the
   whole file's tests had been written against Phase 3's implicit assumption that Reading Lists
   reset per browser context (true for `localStorage`, false the moment they're genuinely
   shared Postgres data). Fixed by giving every created list a collision-proof name
   (`uniqueName()` in `tests/e2e/helpers.ts`), restricting the file to the desktop project in
   serial order (eliminating cross-project/cross-worker races on the one shared database), and
   rewriting the two assertions that legitimately depend on the list being *globally* empty (the
   overview's CTA and the Add-dialog's zero-state message) to run first, before anything else
   creates data — see the comment at the top of `tests/e2e/readingLists.spec.ts` and
   `docs/DECISIONS.md`.
2. **A genuine test-only race, found via deep tracing (not guessed at): several tests called
   `page.goto()` immediately after clicking "Create & add," without waiting for that dialog to
   actually close.** `createList` and `addBook` are now two sequential, genuinely asynchronous
   Server Action round-trips — a full page reload landing between them tears the page down
   while `addBook`'s request is still in flight, silently orphaning it. Diagnosed by adding
   real instrumentation at every layer (a file-based log inside the Server Actions themselves,
   proving `addBookToReadingListAction` was never even reached) rather than guessing from
   symptoms alone. Fixed with `await expect(dialog).toBeHidden()` before any navigation that
   follows an Add-to-Reading-List mutation. Full account in `docs/DECISIONS.md`, "Reading
   Lists: from localStorage to Postgres." Two dead-end hypotheses chased and ruled out along the
   way, for anyone debugging something that looks similar later: a React hydration warning seen
   early in the same runs turned out to be unrelated noise, and forcing the Postgres connection
   pool down to a single connection (`max: 1`) did not change the symptom, ruling out
   connection-pool visibility as the cause.
3. **A locator-ambiguity bug surfaced only after fixing #2**, once tests could reliably run to
   completion: "adding the same book twice" checked for the text "Already added" anywhere in
   the Add-to-list dialog, but by the time this test runs, several earlier tests have already
   added the same first-search-result book to their own lists — so the dialog legitimately
   shows "Already added" next to multiple list rows, not just this test's own. Fixed by scoping
   the check to the specific list row matching this test's own unique name.

### Real bugs this suite caught — Phase 4 correction pass

1. **`addBook`'s new "nonexistent reference throws a typed domain error, not a raw database
   exception" work initially only pre-checked that the *book* existed, not the list.** A new
   integration test (`addBook against a missing list throws a typed domain error`) caught this
   immediately: `reading_list_items` has a foreign key to *both* `reading_lists` and `books`, so
   a nonexistent `listId` still hit a raw `PostgresError` (`23503`,
   `reading_list_items_list_id_reading_lists_id_fk`) on the insert, before the code ever reached
   its own "list not found" check. Fixed by checking both referenced rows exist, in that order,
   before the insert — a direct demonstration of why "add a test proving the domain error" isn't
   redundant with "the fix looks obviously correct": the first implementation looked correct and
   wasn't.

### An environmental issue, not a code bug: orphaned browser processes degrading E2E runs

Re-running the E2E suite after the changes above initially showed non-deterministic failures —
a different, unrelated spec file each time (voice, auth, guide, find), always a navigation/page-
load timeout, never anything this correction pass actually touched. Root cause, found by
checking system load and swap rather than re-reading test code that hadn't changed:
`chrome-headless-shell` processes left over from an earlier, unrelated session — running for
over a day, consuming roughly 1.5GB of swap — were degrading every subsequent Playwright run's
page-load timing unpredictably. `ps aux | grep ms-playwright` found them; killing them dropped a
full run from 15–35 minutes to 35 seconds, after which the suite passed 103/103 three
consecutive times. Worth knowing before assuming a flaky E2E run means a real regression: check
for leftover browser processes from a previous session first, especially after a long working
session with many backgrounded/interrupted test runs.

### Real bugs this suite (and the evaluation harness) caught — Phase 5

1. **A five-word descriptive query returned zero results end to end**
   ("animal books with real photos") — `plainto_tsquery`'s implicit AND required every word to
   appear verbatim in a single book's document, which no real photography/animal book's text
   did. Found by the first E2E run against the new architecture (`find.spec.ts` Flow 3). Fixed
   with an OR-of-lexemes tsquery. Full writeup in `docs/SEARCH.md` §3.
2. **Fixing #1 exposed a second, more interesting bug**: the OR query then made the ordinary
   word "read" match every seeded book, because the structural label "Read-aloud length"
   appeared in literally every document. Found immediately after fixing #1, by testing the
   known "zero-results" filler-query case from Phase 2–4's own test suite
   (`docs/SEARCH.md`'s "Real bugs this phase's testing caught," #3's spiritual successor) and
   seeing it regress. Fixed by splitting the full-text index text from the labeled embedding
   document (`buildSearchIndexText` vs. `buildEmbeddingDocument`) plus a meaningful-overlap gate
   requiring ≥2 matched lexemes.
3. **"Show More" appeared not to increase the result count** — actually a test-timing bug, not
   a product bug: the test read `rows.count()` once, synchronously, right after clicking,
   racing the real server navigation Phase 5 introduced (Phase 2–4's "Show More" was an instant
   client-side slice with nothing to race). Fixed by making the test assertion auto-retry.
4. **The most significant find: structured free-text intent (an age/duration/language/style
   phrase) produced no reachable SQL candidates at all for a query sharing no literal keyword
   overlap with a matching book** — found by the search evaluation harness
   (`tests/evaluation/`), not by E2E testing. "A book for a 4 year old" is a real Phase 2–4
   capability (the deterministic age-intent ranking bonus) that had silently regressed the
   moment retrieval moved from "score the whole catalog" to "score only SQL-bounded
   candidates" — an age-appropriate book with zero keyword overlap with the query text was
   never even retrieved as a candidate, so its ranking bonus never got a chance to apply. Fixed
   by `buildIntentConditions()`, a dedicated SQL candidate query for recognized structured
   intent signals. Verified directly: 4 candidates before the fix, 38 (the real count of
   age-appropriate seeded books) after. Full writeup in `docs/SEARCH.md` §2. This is exactly the
   kind of regression the evaluation harness exists to catch, and it worked.

### Real bugs and gaps this suite caught — Phase 5 correction pass

1. **A material data-safety gap, not caught by any test until this pass specifically looked for
   it**: migration `0001` added `search_text` as nullable but nothing ever backfilled it for
   pre-existing rows — every test up to this point only ever exercised a from-zero
   migrate-then-seed database, which never exposed this. Found by deliberately writing
   `tests/integration/db/migrationUpgrade.test.ts` to simulate an *already-populated* Phase 4
   database. Fixed by folding an automatic backfill into `db:migrate` itself. See
   `docs/SEARCH.md` §4 and `docs/DECISIONS.md`.
2. **A title-normalization mismatch**: `normalizeTitle()` (article-stripping, diacritic-
   stripping) was only ever applied when *writing* `normalized_title` at seed time — the
   exact-match query compared a bare `trimmed.toLowerCase()` against it, so a query still
   carrying its own leading article never matched. Found by auditing the exact-match code path
   directly, not by a failing test (there was no test covering this at all). Fixed by exporting
   and reusing the one canonical function on both sides. See `tests/unit/search/normalize.test.ts`.
3. **A report/implementation mismatch**: `AutocompleteRow`'s type always declared "topic" and
   "language" as real suggestion types, and the original Phase 5 report described autocomplete
   as covering them — but `SearchRepository.autocomplete()` never actually queried for either.
   Found by a reviewer comparing the report's claims against the actual query list. Fixed by
   adding both, with visibility-scoped, additional-language-aware queries.
4. **The original evaluation dataset (13 cases) covered only a fraction of the documented
   pipeline** — no ISBN cases (the fixture catalog had never recorded any ISBN at all), no
   diacritics case, no per-category reporting, no top-5 metric, and no case proving hard filters
   dominate thematic relevance. Expanded to 41 cases across four reported categories; two real
   ISBNs were added to two real fixture books (`src/lib/catalog/fixtures.ts`) specifically to
   make the ISBN cases possible without fabricating a synthetic book.
5. **The Gemini adapter sent identical, unlabeled text through both `embedQuery` and
   `embedDocuments`** — Google's own retrieval guidance is that a document being indexed and a
   query searching for one should be formatted differently. Found by an explicit audit requested
   for this pass, not a failing test (no real provider exists in this environment to fail
   against). Fixed with `gemini-embedding-2`'s documented asymmetric text-prefix contract; the
   embedding composition version was bumped so any hypothetical existing embedding is detectably
   stale. **Not independently verified against a live API call.**

### Real bugs this pass caught — Phase 5 real-provider validation (2026-09-17)

1. **`HTTP 429` from Gemini's `batchEmbedContents`, reproduced live**, not hypothesized — repeated
   calls within one validation session (smoke tests, dev-catalog generation, multiple evaluation
   runs) reliably triggered it. Fixed with bounded retry-with-backoff (`fetchWithRetry`,
   `geminiProvider.ts`); a sustained, heavy burst can still exceed 2 retries (observed directly:
   several later evaluation runs still failed to generate embeddings even after multi-minute
   waits) — not eliminated, but the ordinary transient case is now absorbed. 4 new unit tests
   (`tests/unit/embeddings/geminiProvider.test.ts`).
2. **The semantic meaningful-distance ceiling (`hybridScore.ts`) was still too loose after its
   first correction.** `1` (never gated anything) → `0.36` (from one query's real distances) →
   **`0.30`** (from three real queries' distances, after `0.36` was itself caught letting 31/49
   catalog books clear it for an unrelated known-item query — visible directly as "35 matches" in
   a product screenshot for a single-title lookup, and in the evaluation harness's own top-3 for
   `known-item-exact-title`). Full measurement in `docs/DECISIONS.md`.
3. **"very" (a literal substring of "every"/"everyday") was falsely triggering tag/description
   keyword matches** — the known-item query "The Very Hungry Caterpillar" boosted an unrelated
   book via its "everyday life" tag. Fixed by stop-wording "very" (`normalize.ts`), the same fix
   class as the pre-existing "age" (inside "courage"). A related, distinct collision — "day"
   inside "everyday", specific to category/format matching — was fixed with a new whole-word
   matcher used only for those two fields.
4. **A pre-existing E2E locator ambiguity, exposed (not caused) by real embeddings changing
   result ordering**: `find.spec.ts`'s "Flow 3" asserted `getByText("Real photography")` on the
   top result row, which now also legitimately matches that text inside the row's own grounded
   explanation sentence ("Matches the title, the 'animals' topic, and Real photography") — a
   genuine strict-mode selector ambiguity, not a ranking regression (the actual top result did
   have `visual_realism: real_photography`, exactly as required). Fixed with `{ exact: true }` to
   target the metadata badge specifically.

All four are fixed and covered by regression tests (unit tests for 1–3; the corrected E2E
assertion for 4). Full detail and the underlying measurements: `docs/SEARCH.md` §5/§9,
`docs/DECISIONS.md`.

### Real bugs this pass caught — Phase 6 correction pass (2026-09-20)

Found by review before real OAuth credentials were ever introduced, not by a failing test —
both were genuine gaps in code that otherwise had full mocked test coverage passing cleanly.

1. **The public `getFileMetadata(fileId)` had no root-containment check at all**, unlike
   every other provider method — a real escape hatch for arbitrary Drive metadata access
   despite the interface's own doc comment openly acknowledging the gap rather than hiding
   it. Fixed by renaming the raw fetch to a private `fetchRawMetadata` and making the public
   `getFileMetadata` enforce containment before returning anything; `verifyConnection()`
   calls the private raw fetch directly for the root's own metadata, avoiding a circular
   "is the root contained within itself" check. 6 new tests
   (`googleDriveProvider.test.ts`), including a compile-time-only `@ts-expect-error` check
   (verified by `npm run typecheck`) that the private fetch never reaches the public
   interface.
2. **The real smoke test (`scripts/google/smoke.ts`) could orphan its own disposable test
   file** — every failure path called `process.exit(1)` directly, including failures after
   Step C had already created a real Drive file, leaving `__ssjc_phase6_smoke_*.png` in the
   real configured root with no cleanup attempt. Fixed by extracting the step orchestration
   into a pure, provider-injected function (`scripts/google/smokeOrchestration.ts`) that
   never exits the process and always attempts cleanup once a real file exists, reporting a
   cleanup failure separately from the original validation failure. 11 new tests
   (`smokeOrchestration.test.ts`) prove this against an in-memory fake provider — no real
   Google credentials needed to verify the guarantee.

Full detail and reasoning: `docs/DECISIONS.md`.

## Query performance evidence at realistic scale (Phase 5)

The 48–51-row dev/test/e2e seed is too small to expose real index-usage problems, so
performance claims in `docs/SEARCH.md` are backed by `EXPLAIN ANALYZE` against a throwaway
~2,551-row synthetic database (generated, measured, and dropped — not part of the repository or
any committed seed), sized within the catalog's stated ~1,500–5,000-book target:

| Query | Time | Plan |
|---|---|---|
| Hard filter / queryless browse | 0.76ms | Sequential scan (correct choice — ~99% of rows match `review_status='active'`) |
| Exact/prefix match | 1.36ms | Sequential scan |
| Full-text (OR-tsquery + meaningful-overlap gate) | 4.97ms | Bitmap index scan on `books_search_vector_idx` (GIN) |
| Trigram fuzzy match, before fix | 6.7ms | Sequential scan — the trigram index existed but was never used |
| Trigram fuzzy match, after fix | 0.16ms | Bitmap index scan on `books_title_trgm_idx` (GIN) — **~40x faster** |
| Structured intent (age) | 0.06ms | Sequential scan (short-circuited by `LIMIT`) |
| Vector cosine distance (exact scan, 500 embedded rows) | 2.06ms | Sequential scan + top-N sort |

The trigram regression this table documents (row 4→5) was a real, previously-undiscovered bug
— see `docs/SEARCH.md` §3 and `docs/DECISIONS.md`, "Trigram fuzzy matching needs the `%`
operator." All other queries used an appropriate plan on first measurement. Every number above
comes from an actual `EXPLAIN ANALYZE` run, not an estimate.

## Manual verification performed

- Visually inspected real Playwright screenshots (not just automated assertions) of every
  major screen at both a mobile viewport (390×844, matching a contemporary iPhone) and a
  desktop viewport (1440×900) — see `docs/screenshots/phase-1/` locally (not committed to
  git; screenshots are treated as phase-report artifacts, not repository content — referenced
  by path in each phase's report).
- Caught and fixed a real layout issue this way: Home's content was top-anchored, leaving a
  large, unresolved empty void below on tall/wide viewports — fixed by vertically centering
  the content within the available space.
- Computed real WCAG contrast ratios for every text/background and border/surface token pair
  actually in use (see `docs/ACCESSIBILITY.md`) rather than relying on a visual guess — this
  caught two real failing pairs, both fixed before this phase was considered done.
- Phase 2: captured and inspected real screenshots of the initial Find state, populated
  results, autocomplete open, the zero-results state, the Filters dialog, a browse-by-category
  result set exercising Show More, and Book Detail — at both viewports (`docs/screenshots/
  phase-2/`, same local/not-committed convention as Phase 1). No visual defects were found
  requiring a fix this round, beyond the hover-artifact investigation noted above.
- Phase 3: captured and inspected real screenshots at 320/390/820(tablet)/1440 of every voice
  state (idle/listening/permission-denied), every Reading Lists screen and dialog (empty and
  populated overview, create/rename/delete/add-to-list dialogs, empty and populated detail),
  and the Guide — see `docs/screenshots/phase-3/`. Included a deliberate stress test: a list
  seeded with several books to check whether the tinted `BookCover` system (Phase 2 revision)
  reads as noisy once a list is genuinely book-heavy — it didn't; the four-composition cycle
  stayed legible and restrained even with repeats, so no change was made.
- Phase 5: captured and inspected real screenshots at 320/390/820(tablet)/1440 of the new/
  changed search surfaces — the autocomplete dropdown open, real search results with grounded
  explanations, "Show More" with its exact remaining-count label, and the calm zero-results
  state — see `docs/screenshots/phase-5/` (captured via a throwaway Playwright script, deleted
  after review, per the same local/not-committed convention as Phases 1–3). One real timing
  race in the *capture script itself* was caught and fixed this way (a `networkidle`-based
  wait resolved before a real search navigation completed, capturing the pre-navigation empty
  state) — re-verified as a test-script artifact, not a product bug, by re-running the same
  interaction in isolation with an explicit wait for real content and confirming correct
  results. The "Book With Incomplete Metadata" seed row was visually confirmed rendering
  "Age not specified · Not specified · Not specified" in a real result card, not just asserted
  by a test. No visual defects requiring a fix were found at any of the four widths.
- Phase 5 correction pass: captured and inspected real desktop screenshots (via another
  throwaway, deleted Playwright script) of the tag/topic autocomplete dropdown ("Topic" label
  renders correctly), the language autocomplete dropdown ("Language" label renders correctly),
  the filter-only browse page before and after "Show More" (confirmed the exact real total —
  "12 matches" — and that the button's own remaining-count label, e.g. "Show more (7 more)",
  matches the true total minus what's shown, with every result visible and no button left after
  showing all 12), Book Detail navigated to from a filtered search and back (the return context
  correctly preserved the original query), the zero-results state, and the incomplete-metadata
  book's real-card rendering. No visual defects found.
- Phase 5 real-provider validation (2026-09-17): captured and inspected real desktop (1440×900)
  and mobile (390×844) screenshots — via another throwaway, deleted Playwright script — with real
  Gemini embeddings present in the development database: a known-item query ("The Very Hungry
  Caterpillar"), a structured multi-constraint query (animals + age 4), three exploratory queries
  (winter atmosphere, gentle goodbye, starting-school anxiety), and the autocomplete dropdown.
  Confirmed: the known-item query returns exactly its one correct match with zero semantic noise
  (post-fix); grounded explanations never use AI/vector/embedding language; autocomplete triggers
  zero requests to `generativelanguage.googleapis.com` while typing (verified via network-request
  interception); zero browser console errors on either viewport. An intermittent Next.js
  dev-overlay hydration-mismatch warning was observed and traced to a pre-existing, unrelated
  Phase 3 pattern (`SearchInput.tsx`'s voice-button conditional, depending on client-only feature
  detection) — not touched by this pass. Screenshots:
  `docs/screenshots/real-provider-validation/` (local, not committed, same convention as prior
  phases).

## What's not tested yet (by design)

Nothing in the Admin dashboard beyond its placeholder state — there's no real functionality
there yet to test. Google Sheets integration has no tests because nothing is connected yet
(Phase 9). Find a Book, voice search, Reading Lists, the Library Guide, Google Drive, and
Add a Book (Phase 7) are all fully tested at the unit, integration, and E2E level for
everything each phase actually built. Phase 7's own genuinely-untested items (real Google
Books validation — no key available; a fresh live Gemini call against real HEIC bytes —
blocked by a real rate limit during validation) are recorded honestly in
`docs/AI_PIPELINE.md` §10 and `docs/IMPLEMENTATION_STATUS.md`, not glossed over here.

**Genuinely not tested in Phase 5, and reported honestly rather than glossed over:**

- **Real semantic-quality relevance.** No `GEMINI_API_KEY` exists in this environment, so no
  real embedding has ever been generated and no real semantic retrieval has ever run. Every
  test involving an embedding uses the deterministic `FakeEmbeddingProvider`, which proves the
  storage/retrieval/scoring/graceful-degradation *mechanics* work correctly but carries no real
  semantic meaning whatsoever. Whether a real embedding actually improves exploratory/
  paraphrased-query relevance over conventional retrieval alone is unmeasured.
- **`EXPLAIN`/`EXPLAIN ANALYZE` query-plan evidence at a realistic (~1,500–5,000 row) catalog
  scale.** Only verified functionally against the 48–51-row dev/test/e2e seed so far — index
  usage and query cost at the collection's actual target size have not been measured.
- **Manual visual/accessibility verification at real viewport widths for the new/changed Find
  UI surfaces** (autocomplete dropdown, Show More loading state, calm search-failure copy) —
  only automated Playwright assertions exist for these so far, unlike Phases 1–3's own
  screenshot-based manual review documented above.

Phase 4's real-database coverage (migrations, repositories, the two-connection
shared-persistence proof) remains fully in place and unaffected by Phase 5.
