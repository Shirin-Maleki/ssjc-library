# Testing

Status: reflects what's actually built and run through Phase 4 — every command below was
executed against the real project, not just written.

## Running the suite

```
npm run typecheck        # tsc --noEmit
npm run lint             # eslint
npm run test             # vitest run — unit tests, no database
npm run test:integration # vitest run against a real Postgres database (see docs/DATABASE_SETUP.md)
npm run test:e2e         # playwright test — E2E, against a real production build + real Postgres
npm run build            # next build
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

## E2E tests (Playwright) — `tests/e2e/`

Run against **real Chromium and real WebKit** (the mobile project uses WebKit specifically,
because that's the engine behind iPhone Safari — the brief is explicit that this app will be
used heavily on phones, so testing only against Chromium would have missed a real bug, below).

| File | Covers |
|---|---|
| `auth.spec.ts` | Welcome screen rendering, Tap to Enter reveal, wrong/right password, show/hide toggle, full keyboard-only login, route protection on every protected path, logout, admin unlock (wrong/right password), admin elevation clearing on logout |
| `navigation.spec.ts` | Every remaining placeholder Home destination (Add, Lists, Guide, Teacher Catalog) reaches its "coming later" state and can navigate back; the two primary tiles are meaningfully larger than secondary nav items |
| `find.spec.ts` | The ten numbered flows the brief requires — see below |
| `voice.spec.ts` | A scripted fake `SpeechRecognition` (installed via `page.addInitScript()`, never a real microphone) exercising the real production UI: Home → Find → voice → mocked transcript → normal results; existing filters survive a voice search; no-speech, permission-denied, cancel, and an unsupported-browser fallback |
| `readingLists.spec.ts` (Phase 4: desktop project only, serial order — see the comment at the top of the file) | Empty/populated overview, the Add-to-list dialog's no-lists-yet state, create (required name, optional/whitespace/trimmed creator), a list surviving reload, rename, delete with confirmation (and cancelling it), an empty list's guidance, add-to-list from both Search Results and Book Detail (including that it never accidentally navigates to Book Detail), duplicate-add idempotency and "Already added" messaging scoped to the test's own list, remove (without touching the catalog), Book Detail↔list-detail return navigation, a malformed/external `from=` value falling back safely, a nonexistent list id's not-found state, a full keyboard-only create flow, and (Phase 4 correction pass) the **actual two-independent-browser-context acceptance test**: two separate `browser.newContext()`s, each with its own login/cookies, proving a list Context A creates — and a book Context A adds to it — is visible to Context B without Context B doing anything itself |
| `guide.spec.ts` | The real Guide renders with one `<h1>` and the expected section headings; the physical-category-vs-tags example matches real fixture data; the alphabetical-return rule is stated; Add a Book/Review Later are described in the future tense with no fake button; links to Find a Book and Reading Lists work; the shared-across-staff nature of Reading Lists is disclosed (Phase 4: no longer "device-local") |

Phase 4 correction pass also added two `find.spec.ts` cases (run on both projects, like the
rest of that file): a malformed Book Detail id (`/books/not-a-uuid`) and a valid-but-nonexistent
UUID both render the calm "Book not found" state, never a database error.

**103 tests, 0 failures** (Phase 4 correction pass) — `readingLists.spec.ts` runs on the desktop
project only (18 tests, serial, including the new two-browser acceptance test), everything else
still runs on both mobile/WebKit and desktop/Chromium. Re-run three consecutive times end to end
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

## What's not tested yet (by design)

Nothing in Add or the Admin dashboard beyond their placeholder states — there's no real
functionality there yet to test. Google and AI integrations have no tests because nothing is
connected yet (Phases 6, 7, 9). Semantic search/embeddings/pgvector have no tests because
they're entirely out of scope for Phase 4 (see `docs/DATABASE_SETUP.md`, "The Phase 5
replacement seam"). Find a Book, voice search, Reading Lists, and the Library Guide are all
fully tested at the unit, integration, and E2E level for everything Phases 2–4 actually built —
Phase 4 additionally adds real-database coverage (migrations, repositories, and the
two-connection shared-persistence proof) that didn't exist, and couldn't have existed, before
there was a real database to test against.
