# Testing

Status: reflects what Phase 1 actually built and ran — every command below was executed
against the real project, not just written.

## Running the suite

```
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm run test        # vitest run — unit tests
npm run test:e2e    # playwright test — E2E, against a real production build
npm run build       # next build
```

`npm run test:e2e` builds and starts the app itself (`playwright.config.ts`'s `webServer`)
against fixture credentials computed at config-load time — nothing sensitive is ever written
to disk. No real environment variables or `.env.local` are needed to run any of the above.

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
| `search/filters.test.ts` | AND-across-groups / OR-within-a-group semantics, age/duration/illustration-style filter matching |
| `search/autocomplete.test.ts` | Minimum-length gating, catalog-derived suggestions, category-vs-topic type labelling, prefix-over-substring ranking, deduplication, result cap |
| `search/urlParams.test.ts` | Query/filter round-trip through URL search params |
| `search/searchBooks.test.ts` | Every deterministic scenario the brief names by example — see below |
| `voice/messages.test.ts` | Every voice status message, the privacy note's exact wording (no "on-device" claim, no audio-saving claim), button label changes |
| `voice/speechRecognition.test.ts` | Capability detection (both `SpeechRecognition` and `webkitSpeechRecognition`), final/interim transcript extraction, an empty-but-final transcript vs. no result at all |
| `voice/useVoiceSearch.test.ts` | The full status machine against a scripted fake `SpeechRecognition`: idle→listening→processing, no-speech (both an empty final transcript and the browser ending with no result at all), permission-denied, generic error, cancel→idle, and a dedicated assertion that `localStorage.setItem` is never called during a listening session |
| `components/SearchInput.voice.test.tsx` | Component-level: a final transcript navigates through the exact same `buildFindHref()` URL typed Enter produces, with existing filters preserved; cancel restores the pre-voice query without navigating; no-speech/permission-denied/unsupported all render the right calm copy |
| `reading-lists/format.test.ts` | `formatCreatedBy` (Anonymous fallback for undefined/whitespace), `formatBookCount` pluralization, `formatListDate` (including an unparseable-date fallback), `isBookInList` |
| `reading-lists/localStorageRepository.test.ts` | Every repository method against real `localStorage` (jsdom): required-name rejection, trimming, Anonymous normalization, survives a simulated reload, rename preserves `createdAt`, idempotent `addBook`, a book in multiple lists, corrupted/malformed stored JSON treated as empty, most-recently-updated-first ordering |

Environment note: tests run with `environment: "node"`, not `jsdom` — an early attempt to use
`jsdom` caused `jose`'s WebCrypto key handling to see cross-realm `Uint8Array` instances and
fail with a cryptic key-type error. Since Phase 1's unit tests are pure logic with no DOM
dependency, `node` is both correct and faster; `jsdom` remains available per-file via a
`// @vitest-environment jsdom` pragma whenever a later phase adds component tests that
actually need a DOM.

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
| `readingLists.spec.ts` | Empty/populated overview, create (required name, optional/whitespace/trimmed creator), a list surviving reload, rename, delete with confirmation (and cancelling it), an empty list's guidance, add-to-list from both Search Results and Book Detail (including that it never accidentally navigates to Book Detail), duplicate-add idempotency and "Already added" messaging, remove (without touching the catalog), Book Detail↔list-detail return navigation, a malformed/external `from=` value falling back safely, corrupted localStorage recovering gracefully, a nonexistent list id's not-found state, and a full keyboard-only create flow |
| `guide.spec.ts` | The real Guide renders with one `<h1>` and the expected section headings; the physical-category-vs-tags example matches real fixture data; the alphabetical-return rule is stated; Add a Book/Review Later are described in the future tense with no fake button; links to Find a Book and Reading Lists work; the device-local limitation is disclosed |

**118 tests** (59 per browser project × mobile/WebKit + desktop/Chromium) — all passing.

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
functionality there yet to test. Database, Google, and AI integrations have no tests because
nothing is connected yet (Phases 4, 6, 7, 9). Find a Book, voice search, Reading Lists, and the
Library Guide are all now fully tested at the unit and E2E level for everything Phases 2–3
actually built.
