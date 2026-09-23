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
| `intake/imagePrep.test.ts` (Phase 7, extended in the real-cover correction pass) | Real `sharp` resize of a real oversized JPEG/PNG (aspect ratio preserved, never upscaled), real HEIC/HEIF passthrough (the documented sharp limitation), a genuinely corrupt-bytes fallback that never throws — plus (real-cover correction pass §2) real EXIF auto-orientation: an upright source needs no correction, a 90-degree correction (orientation=6) proven by the expected dimension swap, a 180-degree correction (orientation=3) proven by a marker pixel actually moving to the opposite corner (dimensions alone can't prove 180°), a landscape source containing a portrait cover (orientation=8), and a teacher's manual rotation composing correctly on top of EXIF auto-orientation (`manualRotationApplied` honestly `false` for HEIC/HEIF, which cannot be pixel-rotated here) |
| `components/CoverCapture.test.tsx` (real-cover correction pass §6) | `nextRotation` cycles 0→90→180→270→0; a freshly selected photo starts unrotated; tapping Rotate 90° updates the preview's transform and is passed through to `onConfirm`; four taps returns to 0 (fixed increments, not open-ended); choosing a new photo resets rotation rather than carrying over the previous photo's correction |
| `ai/retry.test.ts` (Phase 7) | `withGeminiRetry` succeeds immediately, retries on 429/503 then succeeds, gives up after `MAX_RETRIES` with the real error, never retries a 400 or a status-less error — real timers faked, not slept |
| `ai/geminiProvider.test.ts` (Phase 7, rewritten for the AI-first catalog draft correction) | `GeminiBookIntelligenceProvider.analyzeCover()` against a mocked `@google/genai` SDK: configuration-missing/invalid-image guards, a well-formed combined response Zod-validates BOTH `coverEvidence` and `aiSuggestions` in one call (proving exactly 1 Gemini call, not 2), the image is sent as base64 `inlineData`, the documented model id is used, the system instruction contains both the rotation/skew/front-cover-isolation guidance (real-cover correction pass §4) AND the "expected to make a useful best-effort suggestion" language (AI-first catalog draft correction §2/§6) with the strict evidence boundary confirmed still present, only the given active categories are injected, the teacher-provided rotation hint appears in the prompt only when present and needed, malformed/empty JSON maps to `invalid_response`, a malformed `coverEvidence` still fails the whole call but a malformed OR missing `aiSuggestions` section falls back to `EMPTY_AI_SUGGESTIONS` rather than discarding a valid identification, 429/503 map to `rate_limited`/`transient_provider_failure` after internal retries, a single transient 503 recovers via retry, no raw provider error text leaks into the mapped error |
| `ai/schemas.test.ts` (AI-first catalog draft correction §2/§13) | `CoverIdentificationSchema` has no speculative/inferential keys (category, age, fiction, format, etc.) and `EnrichmentSuggestionSchema` has no strict-evidence-only keys — the two halves of a combined response can never be confused for each other; `CombinedCoverAnalysisSchema` validates a real-shaped payload; `EMPTY_AI_SUGGESTIONS` is itself schema-valid |
| `intake/enrichmentMerge.test.ts` (AI-first catalog draft correction §4/§13) | `mergeProviderSubjectsIntoTags` merges new provider subjects into AI tags, de-duplicates case-insensitively, never wipes existing AI tags (proving suggestions survive metadata reconciliation), returns the same array when there's nothing to merge, caps at 10 tags, trims/skips empty subjects |
| `intake/visionFailureClassification.test.ts` (real-cover correction pass, final round §2) | `classifyVisionFailure` maps `invalid_image`/`invalid_response` to `cover_unreadable` and `rate_limited`/`transient_provider_failure`/`timeout`/`unexpected_provider_failure`/a non-`AIProviderError` to `identification_unavailable`; neither teacher-facing message ever mentions Gemini, an HTTP status, or a quota/model term |
| `components/ConfirmBook.test.tsx` (AI-first catalog draft correction §7/§8) | The default screen displays AI-suggested description/category/age-range/fiction-type/format/read-aloud-band/visual-style/tags with an "AI prepared this book record for you" banner, and shows none of that (no banner, no "Suggested" chips) when AI never ran; never exposes a raw confidence decimal or a model name; Quick Edit initializes fiction type/format/age range/category/description from the AI values, not blank; confirming without ever opening Quick Edit calls `onConfirm({})` (the server-side fallback is what actually persists the AI suggestions); a Quick Edit correction is what reaches `onConfirm`, overriding the AI value; the source cover preview renders with the persisted rotation applied |
| `components/DuplicateCheck.test.tsx` (AI-first catalog draft correction §9) | The "Just photographed" source thumbnail renders with the teacher's persisted rotation; the metadata-provider "In the library" display cover is never rotated, proven side by side in the same render |
| `metadataProviders/googleBooksProvider.test.ts` / `openLibraryProvider.test.ts` (Phase 7) | Configuration-missing guard (Google Books); no-signal short-circuit (no `fetch` call); ISBN query preferred over title/author; real-shaped result normalization including split ISBN-10/13; no-results never fabricates a candidate; genuine HTTP error/malformed-JSON/timeout mapping; Open Library's descriptive `User-Agent`, current `/search.json` endpoint (never the legacy one), and MARC language passthrough |
| `metadataProviders/cache.test.ts` (Phase 7) | `buildCacheKey`: ISBN-based key normalization, ISBN preferred over title/author, genuinely different keys for different evidence shapes, author-order-independent, stable with no signal at all |
| `admin/completeness.test.ts` (Phase 8) | `computeMissingMetadataFields`/`describeMissingMetadata`: deterministic field order, correct English list formatting (1/2/3+ items, Oxford comma at 3+), never a raw field key or number in the sentence |
| `admin/reviewQueue.test.ts` (Phase 8) | `buildAdminReviewQueue` merges multiple signals sharing a key into one item, never duplicates a repeated reason code, sorts by priority-then-oldest-first; `reasonCodeForReviewFlagType`/`classifyNeedsReviewReason` map every case including a stale/unreadable draft; `buildLowConfidenceSignal` combines multiple low-confidence fields into one signal |
| `admin/adminPatch.test.ts` (Phase 8) | `hasPatchField` presence-vs-value semantics (omitted/null/real-value); `resolveProvenanceForPatch`: one decision per tracked field regardless of how many raw columns map to it (both age bounds → one `age_range` decision), an explicit clear still counts as a correction, an explicitly verified field with no patch change becomes `human_verified`, a field that is both patched and "verified" is recorded only as `human_corrected` |
| `admin/categorySlug.test.ts` (Phase 8) | `slugify` lowercases/hyphenates/strips diacritics; `generateUniqueCategorySlug` returns the clean slug with no collision, appends `-2`/`-3`/... only on a real collision, treats a deactivated category's slug as still reserved |
| `admin/duplicateResolution.test.ts` (Phase 8) | `planDuplicateResolution` for all five outcomes: same edition (with and without a pending placeholder to archive), different edition/language, false match, unresolved — exactly which of archive/finalize/relationship-row each implies |
| `admin/validation.test.ts` (Phase 8 correction pass, extended in the final closure pass) | `validateAdminMetadataPatch`/`validateApprovalEdits`: title/language can never be explicitly cleared, an unrecognized language/format/fiction/visual-realism/visual-media value is rejected, age range bounds (0-216, min<=max merged against existing values) are enforced, a genuinely nullable field can still be cleared, empty-string array entries are rejected; `validateCategoryInput`/`validateTaxonomyLabel` reject a blank label and an out-of-range display order. **Closure pass additions:** `isValidId` accepts a real UUID and rejects a malformed/empty/injection-shaped string; `isValidDuplicateAction`/`isValidReviewFlagOutcome` accept every real value and reject an arbitrary one; `validateVerifiedFieldKeys` accepts registered metadata field keys and rejects an unregistered one; `validateEffectiveAgeRange` accepts a valid or open-ended resolved range and rejects the exact Review-Later scenario (effective min > max after merging with an untouched AI/draft bound) |
| `admin/reviewFlagResolution.test.ts` (Phase 8 correction pass) | The exact flag types Review Later approval and same-edition duplicate resolution each resolve — approval includes `category_uncertain`/`duplicate_uncertain`, same-edition deliberately excludes `category_uncertain` (the placeholder is archived, not re-categorized); neither ever includes `missing_metadata`/`metadata_conflict`/`user_flagged`/`import_error` |
| `admin/provenanceLabels.test.ts` (Phase 8 final closure pass) | `describeProvenanceSource`/`describeConfidence`/`describeProvider`/`describeReconciliationOutcome`: every source type maps to a calm label with no underscore/raw-enum leakage, `external_provider` defaults to "From Open Library" but prefers a specific recorded `sourceLabel`, a missing OR low confidence level both map to "Needs review" (never a raw decimal), a known provider id maps to its real name while an unrecognized one falls back to the raw value rather than hiding it, every reconciliation outcome maps to plain language and a missing one reads as "Not confirmed" |
| `bulkImport/enumerate.test.ts` (Phase 9) | `enumerateSourceImages` against an in-memory fake folder tree: walks a real-shaped multi-level tree (root → subfolder → photographer folder → images), ignores non-image files and a simulated Google Sheet/Doc/PDF, skips trashed files, accepts every allowed image MIME type, paginates within one folder via `nextPageToken`, produces stable deterministic ordering across repeated calls, never escapes the configured root, and throws `EnumerationLimitExceededError` rather than silently truncating a pathologically large tree |
| `bulkImport/completionGate.test.ts` (Phase 9) | `decideBulkCompletionGate`: completes automatically only when every signal is strong; routes to `needs_review` with the correct flag type for unusable identification, no language, ambiguous/unresolved reconciliation, every non-`no_match` duplicate outcome, a missing or low-confidence category suggestion; a medium-confidence category is allowed to auto-complete (matching the interactive flow's own leniency); checks run in a fixed order when multiple things are wrong at once |
| `bulkImport/retryClassification.test.ts` (Phase 9) | `classifyBulkImportError`: rate limits/transient failures classify as transient and non-run-fatal; a corrupt/not-found file classifies as permanent; a vision response the provider couldn't parse classifies as reviewable (never blindly retried); missing/revoked Drive configuration and missing Gemini configuration are both run-fatal; a plain unknown error/non-Error throw is handled without crashing |
| `bulkImport/pricing.test.ts` (Phase 9) | `projectCostFromObservedUsage` returns `undefined` (never a fabricated zero) with no real samples; computes a real per-item average and projects it linearly to 100/~1,500 images from real observed token counts; always labels the projection with the pricing-checked date |
| `googleSheets/rowBuilder.test.ts` (Phase 9) | `buildCoverCell`: a real `IMAGE()` formula only for a trusted https host, empty for an untrusted host/non-https/malformed URL/missing cover, no raw double quote from input ever survives into the formula. `buildCatalogRow`: exactly 16 columns (15 visible + 1 hidden), no UUID/provenance/internal field name in the visible header; every ordinary text cell is escaped with a leading `'` (formula-injection safety) unconditionally, including values that don't look dangerous; the cover column is the only formula-producing cell; copy count is sent as a real number; category shows the display label never the slug; language shows a friendly name never a raw code; age range/read time reuse Find's own formatters; genuinely unrecorded fields show "Not specified," never a fabricated value |
| `googleSheets/googleSheetsProvider.test.ts` (Phase 9, mocked Sheets REST — same `vi.spyOn(globalThis, "fetch")` approach as `googleDriveProvider.test.ts`) | `createSpreadsheet` sends a real create request and returns the durable id/sheetId/url; `getSpreadsheetMeta` returns `undefined` (never throws) on a 404 and real metadata when it exists; `updateValues` uses `USER_ENTERED` input mode; `clearValues`/`batchUpdate` hit their real endpoints with the given range/requests; a 403 maps to `permission_denied`, a 429 to `rate_limited`, and no thrown error message ever contains the access token or client secret |

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
| `db/duplicateMatcher.test.ts` (Phase 7, extended in the correction/closure passes) | `findDuplicateCandidates` against the real seeded catalog — exact ISBN match, exact title+author+language match now classified `same_title_different_edition` (never `exact_copy_same_edition` without a real ISBN — correction pass §3), same-title-different-language, same-title-no-author-overlap, an empirically-measured `pg_trgm` similarity case for `ambiguous_similar_title`, no-match for a genuinely unrelated title, an archived book never surfacing as a duplicate even on an exact ISBN match, and (closure pass §1, test "E") the full real chain — a high-confidence candidate's ISBN survives `resolveCandidateAcceptance`'s gate and still reaches `exact_copy_same_edition` correctly |
| `db/persistence.test.ts` (Phase 7, extended in the correction/closure/AI-first passes) | `saveNewBook` creates a book + its physical copy + marks the ingestion item AND its parent job completed with coherent `processed_items`/`completed_at`, all in one transaction; a title-less save is rejected before any transaction opens; an invalid category slug rolls back the *entire* transaction; `addAnotherCopy` inserts a copy without mutating the existing book, also marks its own parent job completed, and throws for a nonexistent book id; `saveForReview` marks the item `needs_review` with the full draft preserved AND now also marks the parent job `completed` (closure pass §2 — the automated run is done even though the item still awaits human review), creates no book when no `pendingBook` is given, or a real `pending_review` book + `review_flags` row when one is — and that book stays excluded from normal Find (`findVisibleBookIdsPage`), same as any other non-`active` book; a human-corrected `description` is stored as `human_corrected` provenance, never `ai_inferred`, and an AI-suggested description a teacher never touched is stored as `ai_inferred` and genuinely persisted (AI-first catalog draft correction §11/§13) |
| `db/identityCandidates.test.ts` (Phase 7 correction pass §7, extended closure pass §1) | `persistIdentityCandidates` persists every candidate considered marking exactly the selected one, clamps an out-of-range raw score to the real `numeric(3,2)` column limit, a retry replaces rather than appends, an empty list clears prior rows — and (test "C") an ambiguous candidate with a real ISBN is retained for audit but persisted `was_selected: false`, with its ISBN confirmed never reaching proposed values |
| `intake/candidateAcceptance.test.ts` (Phase 7 final closure pass §1) | `resolveCandidateAcceptance`/`wasSelected` — an ambiguous candidate's ISBN never populates proposed values (test A); an unresolved candidate produces no proposed values at all (test B); `wasSelected()` is false for every candidate when nothing was accepted (test C, unit half); a high-confidence (real ISBN match) candidate is accepted and its fields adopted, including ISBN (test D); cover-visible evidence alone (no provider candidates at all) still produces usable proposed values, since high-confidence provider metadata is never required to save a book |
| `intake/displayCover.test.ts`, `components/BookCover.test.tsx` (Phase 7 correction pass §2) | `selectTrustworthyDisplayCoverUrl` requires `high_confidence` reconciliation, rejects an untrusted/malformed/non-http(s) URL, upgrades `http:` to `https:` from a trusted host; `BookCover` renders a real `<img>` when `displayUrl` is set, the typographic placeholder otherwise |
| `intake/uploadChunking.test.ts`, `intake/uploadSessionToken.test.ts`, `components/uploadToSession.test.ts`, `api/intakeCoverChunk.test.ts` (Phase 7 correction pass §1) | The chunk-size constant and its Vercel/Google-granularity rationale; the encrypted opaque upload-session token round-trips and rejects tampering; `nextChunkEnd`'s pure chunk-boundary math; the `/api/intake/cover/chunk` Route Handler's `Content-Range`/status-check parsing and 308-vs-done branching (mocked `@/lib/intake/ingestionRecord` and `@/lib/googleDrive` to sidestep their `server-only` guards) |
| `db/adminReview.test.ts` (Phase 8, extended in the correction pass and the final closure pass) | Against real Postgres: a `needs_review` item with no book row appears in the queue; an unreadable draft doesn't crash it; a resolved item disappears; an open review flag appears then disappears on resolution; `loadAdminReviewDetail` resolves both ingestion- and book-keyed queue entries; `approveReviewLater` for both the ingestion-only path (new book+copy, exactly once) and the existing-pending-book path (finalizes in place, never a second book), and rejects an already-resolved item / a titleless approval; all five `resolveDuplicate` outcomes including the real coordination bug this pass found (clearing the stored draft's `duplicateOutcome` so a later approval isn't permanently blocked) and same-edition's placeholder-archival + review-flag resolution; `updateBookMetadata` provenance correctness (one field changes → only that field's provenance changes, an explicit verify → `human_verified`, a stale `updated_at` is rejected, the current-provenance unique index survives two successive edits); category creation/rename (id/slug preserved, affected search text rebuilt) and the deactivation-blocked-while-referenced rule; taxonomy suggestion approve/reject/merge; a meaningful `book_archived` audit entry. **Correction pass additions**: ingestion-only vs. existing-pending-book approval preserve equivalent subtitle/illustrator/publisher/ISBN metadata, and a trusted high-confidence candidate's thumbnail (never an ambiguous one) becomes the display cover on both branches; approval resolves only the flags it addresses while an unrelated flag survives, and same-edition duplicate resolution never falsely resolves an unrelated flag; a previously-embedded book's stale vector is cleared immediately by a metadata edit or category rename (and untouched by an ISBN-only edit or a guidance-only category edit) even with conventional search seeing the new content right away; fixing missing contributors or visual style through `updateBookMetadata` makes the corresponding queue item disappear; **two tests drive genuinely concurrent transactions over two independent Postgres connections** proving a competing SAME EDITION resolution and a competing ingestion-only approval can each create at most one copy/book, the loser always getting a calm already-resolved result; `resolveDuplicate` rejects a non-candidate book id, an archived target, and self-targeting; `updateBookMetadata` rejects an invalid language and an explicit title-clear end-to-end (writing nothing and recording no false provenance), while a genuinely nullable field can still be cleared; `updateCategory`'s audit action truthfully distinguishes a rename, a guidance-only edit, and a bounded multi-field update. **Final closure pass additions**: every id-taking function (`updateBookMetadata`, `archiveBook`, `approveReviewLater`, `resolveDuplicate`, `resolveReviewFlag`, `updateCategory`, `setCategoryActive`, `approveTaxonomySuggestion`, `rejectTaxonomySuggestion`, `mergeTaxonomySuggestionIntoCategory`) returns a calm not-found/invalid result for a malformed id rather than a raw Postgres uuid-syntax error; `resolveDuplicate` rejects a malformed duplicate action and `updateBookMetadata` rejects an unregistered `explicitlyVerifiedFields` key before writing anything; `approveReviewLater` rejects an effective age min > max (admin raises only the minimum past an untouched AI-suggested maximum) before any book is created; both `approveReviewLater` and `updateBookMetadata` refuse to newly assign a deactivated category (an existing grandfathered assignment is left untouched); `loadAdminReviewDetail` exposes current provenance including a low-confidence field while excluding a superseded row, and exposes a persisted draft's saved metadata candidates/reconciliation outcome/selected-candidate marker without any provider call; duplicate candidates carry edition/ISBN-10/ISBN-13/display cover when the existing book has them; the real Keep-current-category flow (empty patch + `explicitlyVerifiedFields`) audits as `metadata_verified` never `metadata_corrected`, a correction-only save stays `metadata_corrected`, and a save mixing both audits as the bounded `metadata_updated` with separate `correctedFields`/`verifiedFields`; correcting `physicalCategorySlug` resolves an open `category_uncertain` flag while an unrelated `visual_style_uncertain` flag survives untouched |
| `db/bulkImport.test.ts` (Phase 9) | Against real Postgres, with fully-scripted fake Drive/AI/metadata providers (zero real network calls): `createBulkImportJob` creates exactly one item per newly-discovered file in deterministic order, is idempotent on rerun (never a duplicate item for an already-tracked file), and respects an explicit `--limit`/`--file-id` bound; a confident item completes automatically creating exactly one active book + one copy; weak identification, a low-confidence category suggestion, and a real duplicate against an existing active book all correctly route to `needs_review` (the duplicate case never silently attaches a copy); a permanent provider failure (an empty/corrupt image) is marked `failed` without pointless retries; `recoverStaleProcessingItems` resets a genuinely stuck `processing` item back to `pending` after the staleness threshold and never touches one still within it; a bounded `runBulkImportJob` call processes exactly `maxItems` and a second call resumes and finishes the rest, with both real books ending up genuinely completed exactly once; a `needs_review` item appears in Phase 8's own computed `loadAdminReviewQueue` with zero new admin code |
| `db/googleSheetsSync.test.ts` (Phase 9) | Against real Postgres, with a fully in-memory fake `SheetsProvider` (zero real network calls): the target spreadsheet is created exactly once and its identity persists in `system_settings`; a second call reuses it (never a duplicate); a spreadsheet deleted out-of-band (a real 404) is transparently replaced; sync includes only visible (`active`) books, excluding archived/pending_review; rerunning with no data changes is idempotent (same spreadsheet, same row count); a title/category change is reflected on the next sync; the visible catalog shrinking clears the correct number of stale trailing rows; `book_sheet_sync` rows are upserted for synced books and removed for books no longer visible; a trusted display cover produces a real `IMAGE()` formula while an untrusted/missing one produces an empty cell; no raw Drive source URL/file id ever appears in synced row data; a simulated Sheets API failure never mutates canonical book data and never marks a document "synced" that wasn't, and a retried sync after a failure succeeds cleanly |

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
| `auth.spec.ts` (extended, Phase 8) | Welcome screen rendering, Tap to Enter reveal, wrong/right password, show/hide toggle, full keyboard-only login, route protection on every protected path, logout, admin unlock (wrong/right password), admin elevation clearing on logout, the real Phase 8 admin overview rendering after unlock; a staff-only session (no admin elevation) redirected back to the unlock prompt from both `/admin/review` and `/admin/taxonomy` directly; an elevated admin reaching both sub-pages; the admin-only source-cover proxy rejecting a request with no admin elevation (real HTTP 403, not a redirect) |
| `adminReview.spec.ts` (Phase 8, extended in the correction pass) | Against disposable fixtures created directly in the shared E2E database (never real Drive/library records): a `needs_review` ingestion item appears in the queue, opens, accepts a category choice, and approves into a record that is immediately conventionally searchable in Find; a same-edition duplicate decision adds a physical copy to the existing book and archives the pending placeholder, never creating a second active bibliographic record; a category referenced by an active book shows its real referencing count and a disabled Deactivate control rather than allowing a silent orphan. **Correction pass additions**: correcting a missing author through the real (now-expanded) Admin UI editor makes the queue item disappear; clicking the real "Keep current category (mark verified)" button leaves the category selection visibly unchanged, shows a "kept, not changed" confirmation message, records `human_verified` provenance, and resolves the corresponding `category_uncertain` flag |
| `navigation.spec.ts` (Phase 9: Teacher Catalog graduated from a placeholder) | The Teacher Catalog destination itself moved to `teacherCatalog.spec.ts` (below); this file now only covers that every Home destination (Find/Reading Lists/Guide/Add a Book/Teacher Catalog) has graduated to a real experience and that the two primary tiles are meaningfully larger than secondary nav items |
| `teacherCatalog.spec.ts` (Phase 9) | Both Teacher Catalog scenarios, in one `test.describe.serial()` block so they can never race each other over the same shared `system_settings` row: (1) no Sheet target configured — a real, calm "hasn't been set up in this environment yet" state, never the old placeholder copy; (2) a real Sheet target configured — the page shows the real explanatory copy and a working `target="_blank"` link to the exact configured URL. Runs desktop-only (`playwright.config.ts`'s `testIgnore`) — `system_settings` is genuinely shared, persistent Postgres data across the whole E2E run exactly like `readingLists.spec.ts`, and Playwright can schedule separate spec FILES concurrently even within one project; putting both scenarios in one serially-ordered file (rather than splitting the "not configured" half into `navigation.spec.ts`) is what actually eliminates the race |
| `find.spec.ts` | The ten numbered flows the brief requires — see below |
| `voice.spec.ts` | A scripted fake `SpeechRecognition` (installed via `page.addInitScript()`, never a real microphone) exercising the real production UI: Home → Find → voice → mocked transcript → normal results; existing filters survive a voice search; no-speech, permission-denied, cancel, and an unsupported-browser fallback |
| `readingLists.spec.ts` (Phase 4: desktop project only, serial order — see the comment at the top of the file) | Empty/populated overview, the Add-to-list dialog's no-lists-yet state, create (required name, optional/whitespace/trimmed creator), a list surviving reload, rename, delete with confirmation (and cancelling it), an empty list's guidance, add-to-list from both Search Results and Book Detail (including that it never accidentally navigates to Book Detail), duplicate-add idempotency and "Already added" messaging scoped to the test's own list, remove (without touching the catalog), Book Detail↔list-detail return navigation, a malformed/external `from=` value falling back safely, a nonexistent list id's not-found state, a full keyboard-only create flow, and (Phase 4 correction pass) the **actual two-independent-browser-context acceptance test**: two separate `browser.newContext()`s, each with its own login/cookies, proving a list Context A creates — and a book Context A adds to it — is visible to Context B without Context B doing anything itself |
| `guide.spec.ts` | The real Guide renders with one `<h1>` and the expected section headings; the physical-category-vs-tags example matches real fixture data; the alphabetical-return rule is stated; Add a Book/Review Later are described in the future tense with no fake button; links to Find a Book and Reading Lists work; the shared-across-staff nature of Reading Lists is disclosed (Phase 4: no longer "device-local") |
| `addBook.spec.ts` (Phase 7, extended in the correction pass, the real-cover correction pass, and the AI-first catalog draft correction) | The full Add-a-Book flow against deterministic fixtures (`E2E_FAKE_INTAKE_PROVIDERS=true`, real Drive/Gemini/metadata calls skipped entirely — never a live API in this suite; see `docs/AI_PIPELINE.md` §9): cover selection preview + Change Photo; a full new-book save requiring a Quick Edit category (no AI configured in E2E); a real, visible save-time error instead of a silent no-op (see the two real bugs below); exact-duplicate detection against the real seeded "The Gruffalo" fixture (filename containing "gruffalo") leading to Add Another Copy; a real display-cover render end-to-end (filename containing "displaycover"); an ambiguous same-title-different-edition duplicate (filename containing "similartitle") whose "Different book" path shows the real captured title, never the uploaded filename; Review Later preserving the intake; an unsupported file type rejected before any upload begins. Runs on both the desktop and mobile (real WebKit) projects. **Real-cover correction pass additions** (filename containing "unreadable"): rotate control in fixed 90-degree increments; no-usable-title shows the explicit recovery screen instead of a pointless lookup; retry re-runs identification on the same already-uploaded source; "Continue and enter the details myself" reaches confirmation honestly. **Final round additions**: a filename containing "serviceunavailable" simulates the distinct "Automatic book recognition is temporarily unavailable." screen (never a rotate control, never photo-retake language, distinct from "unreadable"). **AI-first catalog draft correction additions** (filename containing "aidraft" — a fixture producing real-shaped fake AI suggestions): the confirmation screen arrives with the "AI prepared this book record for you" banner, description, real seeded category, fiction type, format, read-aloud band, and tags all visible; confirming with NO Quick Edit still saves those AI-suggested values (proving they survive metadata reconciliation and are genuinely persisted on save, not silently dropped); a photo rotated once during capture (real E2E-caught regression, now fixed — see `docs/DECISIONS.md`'s stale-closure account) stays visibly rotated all the way through identification, metadata processing, and the confirmation screen's cover preview. **Real bugs this suite caught and fixed** (in order found): `AddBookFlow`'s save handler silently no-op'd when no category had been AI-suggested and Quick Edit was never opened; `confirmSaveAction`'s provenance list wrote two competing "title" rows whenever Quick Edit was opened at all; a stale-closure bug lost the teacher's manual rotation on the way to the confirmation screen. See `docs/DECISIONS.md`/`docs/CHANGELOG.md` for all three. |

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
