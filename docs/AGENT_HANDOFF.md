# Agent Handoff

If you are a coding agent (or a future instance of yourself) picking this project up without
prior context, read in this order:

1. `README.md` — project overview and orientation.
2. `docs/IMPLEMENTATION_STATUS.md` — exact current state, what's done, what's next.
3. This file.
4. `docs/DECISIONS.md` — every significant decision and why, so you don't relitigate settled
   choices or accidentally contradict them.
5. `docs/PRODUCT_SPEC.md`, `docs/ARCHITECTURE.md` / `docs/DATA_MODEL.md`, and `docs/SEARCH.md`
   (if touching Find a Book) as needed for the task at hand.

## What this project is

A staff-only web app that is the operating system for a physical children's library at a
school — finding books, adding books, keeping physical shelving simple while digital metadata
is rich, evolving taxonomy, catching duplicates. It is being built as a deliberate,
phase-gated project (see below) and is also a UX/product-design portfolio piece, reviewed by
the requester's own design/technical advisor between phases.

## The process you must follow

This project moves **one phase at a time**, never automatically continuing into the next.
The full 14-phase plan (Phase 0–13) is in `docs/IMPLEMENTATION_STATUS.md`. At the end of
whatever phase you're working on:

1. Test what you built.
2. Update documentation (`IMPLEMENTATION_STATUS.md` at minimum, others as relevant).
3. Produce a detailed implementation report in the exact format specified in the original
   project brief (phase objective, status, executive summary, user-visible changes, technical
   implementation, files created/modified, database changes, design/UX decisions,
   architectural decisions, external services, environment variables, Google integration
   status, AI status, testing performed, known issues, incomplete items, deviations from
   spec, security/privacy notes, documentation updated, git status, user inputs needed,
   recommended next step) — ending with a copy/paste handoff section written for a non-
   technical reviewer.
4. **Stop.** Do not begin the next phase without explicit approval.

If a phase is too large, split it (Phase X.A, Phase X.B) rather than cutting corners to
finish it in one pass.

## Constraints that must never be silently violated

- No child-facing UI, no child accounts, no gamification.
- Every book has exactly one primary physical category (required, table-managed); unlimited
  digital tags.
- Never recommend or display a book not actually in this library's catalog.
- AI never silently creates a physical category, merges/deletes records, or overwrites
  human-verified metadata. AI suggests; a human confirms.
- Book intake targets ~30–60 seconds of teacher attention; no large metadata forms shown to
  regular staff.
- No individual teacher/admin accounts — two shared-secret role gates only (see
  `docs/DECISIONS.md`).
- No student/child PII anywhere in the schema. No persisted voice audio. No persisted
  natural-language search queries by default.
- Never process the full ~1,500-photo backlog in one run — the phase plan enforces staged
  batches (small test batch → taxonomy research batch → full run, each requiring separate
  approval).
- Never fabricate bibliographic data (ISBN, publisher, year, edition) that isn't actually
  evidenced.
- Secrets live only in environment variables, never committed; never log credentials, tokens,
  or raw voice/query content.
- Don't ask the user unnecessary engineering questions (OAuth flow details, credential
  structuring, etc.) — research and recommend those yourself, document the reasoning, and
  only ask about genuine product/design/business decisions (app name, brand palette, taxonomy
  calls, which Google account/folder to connect, whether a workflow is wanted).

## Where things stand right now

Phase 0 (architecture), Phase 1 (foundation, design system, staff/admin auth), Phase 2 (mock
catalog + Find a Book, plus a visual/mobile revision), Phase 3 (voice search, Reading Lists,
Library Guide), and Phase 4 (the real database, plus a focused correction pass closing a handful
of acceptance gaps — see the "Additional lessons" note below) are all complete. A real Next.js
app runs a fully deterministic search/browse/filter experience against a real Postgres database
(Drizzle ORM, committed migrations, the full 23-table schema) instead of an in-memory fixture
array; Reading Lists are genuinely shared across every staff member/device via authenticated
Server Actions, not `localStorage`; the Library Guide is real content. Still no Google or AI
integration, and no semantic search (Phase 5 — deliberately deferred, no `embedding` column,
no pgvector). The full brand system (name, palette, typography, logo) is real — nothing
placeholder remains there. See `docs/IMPLEMENTATION_STATUS.md` for the authoritative,
continuously updated detail — this file only orients you to the process, not the current
state, since state changes every phase and duplicating it here would drift.

## A cross-cutting lesson: bcrypt hashes and `.env` files

**Never put a raw, unescaped bcrypt hash into any `.env*` file or into `webServer.env`-style
config.** Every `$` in it must be escaped as `\$` first — `scripts/hash-password.mjs` and
`playwright.config.ts` already do this correctly; if you ever generate a hash somewhere else
(a future admin tool, a new script), escape it there too, or it will be silently corrupted the
moment any `.env.local` file exists in the project (yes, even one with unrelated content —
Next.js's env-expansion pass runs against the whole process environment once triggered, not
just values sourced from a file). Full story in `docs/SECURITY.md` and `docs/DECISIONS.md`.
This bug was invisible to the E2E suite for a while because the suite's own fixture-hash
generation had the identical flaw — don't assume "the tests pass" rules this class of bug out
if the test harness touches the same platform behavior the app does.

## Practical lessons from Phase 4 (worth knowing before touching the database or Reading Lists code)

- **`server-only` belongs on `src/db/client.ts` alone — never on a repository class.** The
  `server-only` package's resolution mechanism only recognizes Next.js's own server-build
  condition; under Vitest it throws unconditionally, which would make the real-database
  integration suite unable to import `DrizzleBookRepository`/`DrizzleReadingListRepository` at
  all. A Client Component still can't reach a live connection through a repository — the only
  path to one is importing `client.ts`, which still throws unconditionally outside Next's own
  server build. Don't "fix" this by adding `server-only` back to the repositories.
- **A real, genuinely async mutation (a Server Action) is not equivalent to a synchronous
  `localStorage` call for E2E test purposes, even though both satisfy the same
  `ReadingListRepository` interface.** Several Phase 3 test patterns — click a button that
  triggers an async create-then-add flow, then immediately `page.goto()` elsewhere — relied on
  that flow completing before the next line ran, which was only ever true because Phase 3's
  implementation was synchronous under the hood. Once it became real network round-trips, that
  assumption broke silently (a full page reload can tear down the page mid-flight and orphan an
  in-flight request). The fix, and the rule going forward: **always wait for an explicit
  completion signal (a dialog closing, a URL changing) before navigating away from a page that
  just triggered an async mutation** — never assume "the click handler returned" means "the
  mutation finished." Full incident write-up in `docs/DECISIONS.md` and `docs/TESTING.md`.
- **Shared, persistent E2E data needs collision-proof names and either isolation or scoped
  locators — plan for this before writing the test, not after it flakes.** Any E2E suite
  covering a genuinely shared datastore (this project's Reading Lists, or anything like it
  later) cannot assume a fresh/empty starting state the way `localStorage`-per-context testing
  could. `tests/e2e/helpers.ts`'s `uniqueName()` and the `mode: "serial"` + desktop-only
  restriction on `tests/e2e/readingLists.spec.ts` are the pattern to reuse for any future
  E2E suite touching shared server-side state.
- **When a bug looks like it could be the database, the framework, or the test, trace don't
  guess** — this phase's own "list appears empty right after adding a book" investigation ruled
  out a React hydration warning and a connection-pooling issue (both real, both red herrings)
  before file-based logging directly inside the Server Actions proved the actual `addBook` call
  was never even reached for the failing runs. Add logging at the actual layer boundary you
  suspect, not just at the symptom.

### Additional lessons from the Phase 4 correction pass

- **"Looks correct" isn't the same as "tested" for multi-row FK checks.** Adding a pre-check for
  "does the referenced book exist" to `addBook`/`createWithBook` looked complete — it wasn't:
  `reading_list_items` has a foreign key to *both* `reading_lists` and `books`, and only the
  book side was checked, so a nonexistent list still hit a raw FK violation. The fix was obvious
  once a real integration test targeted exactly that case; it would not have been caught by
  reading the code again. When a table has more than one FK, write a failing-reference test for
  *each* one, not just the one the task description happened to mention first.
- **A schema/architecture doc's own claims (a promised module, a described registry) are a real
  gap if the module doesn't exist yet** — `docs/DATA_MODEL.md` had described both the language
  registry and the metadata field-key registry as already-centralized application concerns since
  Phase 0, but the language registry was an under-scoped stub and the field registry didn't
  exist at all. When a doc says "validated against X," verify X is actually there and actually
  does what the doc claims, rather than trusting the doc's own confidence.
- **Check UUID-shaped columns for the "malformed input reaches a raw database error" gap
  everywhere an id crosses a trust boundary, not just once.** The same fix (validate shape,
  return/throw a safe domain outcome before querying) was needed independently at three layers
  for Reading Lists (the repository, the Server Action boundary) and separately for Book Detail
  — there's no single place that protects all of them; each externally-reachable id parameter
  needs its own check.
- **A flaky-looking E2E run after a long session may be leftover browser processes, not a code
  regression.** Non-deterministic timeouts across completely unrelated spec files (never the
  ones actually changed) turned out to be `chrome-headless-shell` processes orphaned from an
  earlier session, over a day old, eating ~1.5GB of swap. `ps aux | grep ms-playwright` (or
  `pgrep -f chrome-headless-shell`) and killing anything with an implausibly long `ELAPSED` time
  is the first thing to check before assuming a real regression — it took a full run from
  15–35 minutes down to 35 seconds. Full account in `docs/TESTING.md`.

## Practical lessons from Phase 3 (worth knowing before touching voice or Reading Lists code)

- **`react-hooks/set-state-in-effect` (a newer, stricter lint rule) flags calling any local
  `useCallback`-wrapped function that itself calls `setState`, from inside a `useEffect` —
  even if that function is `async` and the actual `setState` call happens after an `await`.**
  This caught a real instance in `ReadingListsProvider`'s mount effect (it called its own
  `refresh()` helper, which calls `setLists`). The fix was to inline the repository call and
  handle its `.then()` resolution directly in the effect, rather than going through a named
  helper — the same fix pattern used in `SearchInput`'s voice-transcript effect. If you hit
  this error, look for an indirect call to a state-setting function, not just a literal
  `setState(...)` line.
- **A native HTML `required` attribute silently defeats custom JS validation.** The Reading
  List name fields originally had both `required` and a custom `handleSubmit` check with an
  accessible error message — the browser's own validation UI intercepted the empty submission
  first, so the custom error never rendered (and Playwright never saw it). If a field has its
  own accessible error-message pattern (matching `PasswordInput`'s `role="alert"` convention),
  don't also add `required`.
- **WebKit's default Tab order excludes plain `<button>` elements** unless the OS's Full
  Keyboard Access is enabled — real Safari behavior, reproduced by Playwright's WebKit
  project. A keyboard-only E2E test that tabs through a dialog's Cancel/Submit buttons will
  fail on `[mobile]` (WebKit) even though the dialog is fully keyboard-operable in practice.
  Submit via Enter from within the last text field instead of tabbing to the submit button —
  it's both the more realistic interaction and the cross-browser-reliable one to test.
- **Voice reuses Find's exact navigation path, on purpose — resist the urge to give it its own
  result rendering.** `useVoiceSearch` (`src/lib/voice/`) knows nothing about search, filters,
  or URLs; it only tracks browser SpeechRecognition state. `SearchInput` is the only place a
  final transcript becomes a query, via the same `navigate()`/`buildFindHref()` call typed
  Enter already uses. If a future change needs voice to behave differently from typed search,
  that's a sign the architecture is being violated, not a sign a new voice-specific code path
  is needed.
- **Mock browser APIs via `page.addInitScript()` for voice E2E tests, not a real microphone.**
  `tests/e2e/voice.spec.ts` installs a scripted fake `SpeechRecognition` class before the app
  loads, exercising the real production `useVoiceSearch`/`SearchInput` code end to end. The
  same fake class shape (`onstart`/`onresult`/`onerror`/`onend`) is reused for the Vitest+jsdom
  component test (`tests/unit/components/SearchInput.voice.test.tsx`) via
  `tests/unit/voice/fakeSpeechRecognition.ts` — one fake, two test layers.

## Practical lessons from Phase 2 (worth knowing before touching search code)

- **Read `docs/SEARCH.md` before changing anything in `src/lib/search/` or
  `src/lib/catalog/fixtures.ts`.** It documents four real bugs this phase's own testing
  caught (an author-name collision, a stop-word gap, a fixture-wording accident, and a
  diacritics bug) — each fixed and regression-tested. Don't reintroduce any-shared-word
  matching for authors/illustrators/publishers; it's wrong (see the "Named-entity search
  matching" decision in `docs/DECISIONS.md`).
- **Filters exclude; free-text query signals only rank.** This is a locked architectural rule
  (`docs/DECISIONS.md`), not a style preference — don't make a parsed intent signal (age,
  language, etc.) start excluding books, or you'll silently hide results a teacher didn't ask
  to hide.
- **The fixture catalog is real test data, not filler** — `tests/unit/search/
  searchBooks.test.ts` asserts against actual fixture book IDs for every deterministic
  scenario the brief names (dinosaurs, Eric Carle, real photographs, etc.). If you edit or add
  fixtures, re-run that suite; it will tell you if you've broken one of these scenarios.
- **Don't test hover-order assumptions from a single screenshot** — a visual QA pass this
  phase almost mistook a Playwright mouse-position hover artifact for a real "pre-checked
  filter" bug; moving the cursor away before screenshotting resolved it. If a filter/checkbox
  screenshot looks like it has an unexplained highlighted state, check for this before
  assuming it's a real bug.
- **Radix Dialog is now a real dependency** (`@radix-ui/react-dialog`), used for the Filters
  panel on both mobile and desktop — Phase 0/1 deliberately deferred adding Radix until a
  real combobox/dialog need existed; this was that moment. Reuse it for future dialogs/sheets
  rather than hand-rolling another one.

## Practical lessons from Phase 1 (worth knowing before touching auth or styling code)

- **The Next.js `middleware.ts` convention is now `proxy.ts`** (Next.js 16 renamed it,
  migrated via `npx @next/codemod@canary middleware-to-proxy .`) — the exported function is
  named `proxy`, not `middleware`. Don't reintroduce a `middleware.ts` file.
- **Session cookies need `SESSION_COOKIE_SECURE` awareness.** `next start` sets
  `NODE_ENV=production` even over plain HTTP; a bare `secure: NODE_ENV === "production"` broke
  session persistence specifically on WebKit (real iPhone Safari's engine) for any
  client-side navigation after the first. See `docs/SECURITY.md` for the full story before
  touching `src/lib/auth/session.ts`'s cookie logic.
- **Don't trust a color pairing's contrast by eye** — verify it with the actual WCAG
  relative-luminance formula (see `docs/ACCESSIBILITY.md`'s method). Two placeholder-palette
  tokens failed real measurement in Phase 1 despite looking fine visually.
- **Always test on real WebKit, not just Chromium**, for anything session/cookie/navigation
  related — this is the engine behind actual iPhone Safari, which this app will be used on
  heavily, and it caught a real bug Chromium alone would have hidden.
- **Test for real headings, not just visible text** — an E2E assertion expecting a heading
  role caught that "Find a Book"/"Add a Book" had been built as plain `<span>`s, which was
  also a real accessibility gap, not just a test-strictness issue.

## Key architectural decisions already made (see `docs/DECISIONS.md` for full reasoning)

Postgres via Supabase as canonical database (implemented against a local disposable Postgres
instance in this environment as of Phase 4 — see `docs/DATABASE_SETUP.md`; nothing in the
schema/code is Supabase-specific); **Drizzle** (not Kysely, not an ORM like Prisma) for schema,
migrations, and data access — revised from an initial Kysely choice during Phase 0 review,
before any code existed, specifically because a TypeScript-schema-as-source-of-truth tool suits
a project built by AI coding agents and maintained by a designer better than a
purer-but-more-manual query-builder-only approach. Next.js Server Actions/Route Handlers
with no separate backend service for the web app. Google Drive as the original-image source
of truth with Google Sheets as a one-way generated projection; **original capture and display
cover are explicitly distinct** — the display cover prefers a derived copy of our own
photographed original, falling back to an external provider thumbnail, then a Drive proxy,
never the reverse. pgvector inside the same Postgres database for semantic search, but search
is layered so **exact matching, structured filters, and full-text/trigram search all work
with zero AI dependency** — semantic retrieval only ever augments that, never gates it.

**Books and physical copies are separate tables** (`books` = bibliographic/edition record,
`book_copies` = physical instances with their own location) — do not put location or a copy
counter back on `books`; "Copies: N" is always a derived count, never stored. Age is stored
as **whole integer months**, converted to friendly year ranges only for display, via one pure
function — never store or reason about years directly. Metadata provenance/confidence lives
in `book_field_provenance`, whose tracked-field vocabulary is an **application-level Zod
registry, not a database enum** (add fields there, not via migration), and which preserves a
full evidence history rather than only the latest value. A `book_duplicates` relationship
table distinguishes exact-copy/different-edition/different-language/false-match. **Bulk
import runs as a standalone worker script (`scripts/import/run.ts`), never inside a Vercel
request** — a shared ingestion pipeline (`lib/ingestion`) is used by both single Add-a-Book
and the bulk-import script, but the execution environment differs; do not build bulk
processing as a long-running API route, it will not work within serverless time limits.

The schema was deliberately trimmed from 25 to 23 tables during review (removed `languages`,
`work_groups`, `taxonomy_suggestion_evidence` as over-modeled for current needs) — see
`docs/DATA_MODEL.md` §12 before proposing new tables; check whether an existing table, an
array column, or an application-level constant already covers the need before normalizing
further.

AI provider, embedding model, and exact Google auth mechanism remain genuinely open pending
real credentials and the requester's input — don't lock these in silently.

**Reading Lists (Phase 3 design, Phase 4 real implementation) are genuinely shared Postgres
data, entirely behind a `ReadingListRepository` interface**
(`src/lib/reading-lists/repository.ts`) — components call `useReadingLists()` (the
`ReadingListsProvider` context, mounted once in the staff layout), never Drizzle/Postgres or a
Server Action directly. The real chain is `ReadingListsProvider → RemoteReadingListRepository
(client-safe) → 8 authenticated Server Actions → DrizzleReadingListRepository → Postgres` — the
old `LocalStorageReadingListRepository` is retained only as reference/example code, no longer
used in production. No component, dialog, or page above the repository boundary changed when
this swap happened, confirming the Phase 3 seam worked as designed. The Add-to-list dialog's
"Create new list" step (`createWithBook`, added in the Phase 4 correction pass) is one atomic
transaction, not create-then-add — see the correction-pass lessons above before changing any
Reading List mutation method. Voice search (also Phase 3) is the browser's own Web Speech API
only — no server-side speech key, no AI interpretation of the transcript; it becomes a query
through the exact same `buildFindHref()`/`searchBooks()` path typed search already uses. See
`docs/DECISIONS.md` for the full reasoning behind both.
