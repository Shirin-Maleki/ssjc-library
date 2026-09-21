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
of acceptance gaps) are all complete and approved. **Phase 5 (real search architecture) is
complete and approved as of commit `88b02752363649c297b6e6f3e38202cee2e51a6a`** — a correction
pass (2026-09-17) closed four material acceptance gaps a review found, then a real-provider
validation pass (same day) performed real semantic-quality validation against a live
`GEMINI_API_KEY`, finding and fixing three real bugs along the way (a too-loose semantic-distance
ceiling recalibrated twice from measured evidence, a generic-word substring collision, and
missing rate-limit handling). Find a Book runs a real, bounded, database-backed hybrid search
pipeline (structured SQL filters, full-text + trigram + optional semantic retrieval,
`docs/SEARCH.md`); Reading Lists are genuinely shared across every staff member/device via
authenticated Server Actions; the Library Guide is real content.

**PHASE 6 (Google Drive connection) IS COMPLETE — REAL GOOGLE DRIVE VALIDATION PASSED**
(2026-09-20) — see `docs/GOOGLE_INTEGRATION.md` for the architecture and
`docs/IMPLEMENTATION_STATUS.md` for the full real-validation transcript. A `CoverStorageProvider`
abstraction (`src/lib/googleDrive/`) with a concrete Google Drive implementation, server-side
OAuth token management, a root-folder security boundary (ancestry-walk containment check,
enforced on every method including `getFileMetadata` as of a 2026-09-20 code-safety
correction), bounded/paginated listing, resumable-upload infrastructure for the future Phase 7
browser-upload flow, and upload completion verification are all built, covered by 342 mocked
unit tests, and now real-validated: `npm run google:smoke` ran against the actual configured
SSJC Drive folder ("Corridor books," a My Drive folder with three pre-existing photographer
subfolders) and passed every step (A–G) — real upload, real confirmation with a real checksum,
real byte-for-byte download, real cleanup, and confirmed zero mutation to the pre-existing
collection. No teacher Google login exists or is planned — SSJC staff authentication is
completely unchanged.

**Credential note worth knowing before touching this again:** the SSJC Google Workspace
account could not complete OAuth authorization directly (Workspace policy currently blocks
third-party OAuth apps pending admin review) — real validation used a personal Gmail account
instead, with the real Drive folder shared to it, and the OAuth consent screen running as
External + Testing rather than Internal. This is a genuine, working setup for continued
development, proven by the real smoke-test pass above, but it is **not a finalized production
credential strategy** — see `docs/GOOGLE_SETUP.md` and `docs/IMPLEMENTATION_STATUS.md` for the
full reasoning before deploying this to production. **Phase 7 may now begin once explicitly
approved** — this document does not itself grant that approval.

See `docs/IMPLEMENTATION_STATUS.md` for the authoritative, continuously updated detail — this
file only orients you to the process, not the current state, since state changes every phase and
duplicating it here would drift.

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

## Practical lessons from Phase 5 (worth knowing before touching search code)

- **`import "server-only"` throws unconditionally in any standalone script/test process that
  isn't Next.js' own build** (`tsx some-script.ts`, a plain Vitest run) — there's no bundler
  remapping it to a no-op outside Next's server compilation. `SearchService` and
  `lib/embeddings/index.ts` both carry this guard. `scripts/embeddings/generate.ts` and
  `tests/evaluation/searchEvaluation.eval.ts` both had to work around it — the script by
  importing `GeminiEmbeddingProvider` directly instead of the guarded `getConfiguredEmbeddingProvider()`
  (duplicating its five lines of "no key → undefined, never throw" logic rather than changing
  the production guard for a script's sake), the evaluation harness by `vi.mock("server-only",
  () => ({}))` at the top of the file before importing anything that transitively depends on it.
  This is not new to Phase 5 — `docs/SECURITY.md` already documented the identical reason
  `server-only` isn't on the repository classes themselves — but it's easy to forget when adding
  a *new* server-only-guarded module and then wanting to exercise it from a script or test.
- **A `.ts` file imported as the *entry point* via `tsx` resolves barrel (`export * from`)
  re-exports correctly; a `.mjs` entry point importing the same `.ts` barrel from outside can
  silently return `undefined` for a named export that works fine everywhere else.** Wasted real
  debugging time on this: a throwaway `.mjs` smoke-test script reported `schema.books` as
  `undefined` (and a `const { books } = schema` destructure failed the same way), even though
  the exact same import inside a `.ts` file run via `tsx some-script.ts` — matching how every
  real script in this project (`seed.ts`, `generate.ts`) is actually invoked — worked correctly.
  If a schema/repository import mysteriously comes back `undefined` in a scratch script, check
  whether the *entry file's own extension* matches how the real code is invoked before assuming
  the barrel export itself is broken.
- **`plainto_tsquery`'s implicit AND is wrong for natural-language multi-word queries** — it
  requires every stemmed word to appear in a single document, which a five-word descriptive
  query almost never satisfies verbatim. An OR-of-lexemes tsquery fixes recall but then needs
  its own gate (`ftsHasMeaningfulOverlap`, ≥2 matched lexemes) or a single incidental common word
  will match everything. Don't add one without the other.
- **Whatever text function builds a semantic embedding document is a bad default source for a
  full-text index**, if that document format uses human-readable field labels — a label present
  in every row (e.g. "Read-aloud length") IS content as far as `to_tsvector` is concerned, and
  can turn an ordinary word into a catalog-wide false-positive magnet. Keep the label-free,
  values-only full-text derivation (`buildSearchIndexText`) genuinely separate from the labeled
  embedding document (`buildEmbeddingDocument`), even though they're built from the same input.
- **Once candidate retrieval is SQL-bounded instead of "score the whole catalog in memory,"
  every ranking-only signal that used to apply regardless of keyword overlap (age/duration/
  language/style intent parsed from free text) needs its OWN SQL candidate path** — otherwise a
  book with the right structured attributes but zero literal keyword overlap with the query text
  is never even retrieved to be scored. This is easy to miss because it doesn't show up as an
  error or an empty page — it shows up as "the ranking bonus exists in the code but never
  actually applies for realistic queries," which only a real evaluation dataset (not just unit
  tests of the scoring function in isolation) reliably catches. Build the evaluation harness
  (`tests/evaluation/`) *before* declaring a hybrid retrieval pipeline done, not after.
- **A search evaluation dataset is worth building even under time pressure** — it found the
  single most significant Phase 5 regression (the structured-intent gap above), which no amount
  of unit-testing `combineScores()`/`buildIntentConditions()` in isolation would have surfaced,
  because the bug was specifically about candidates never reaching the scoring function at all.

### Additional lessons from the Phase 5 correction pass

- **"Migrate-from-zero-plus-seed passes" is not the same claim as "migration is safe" — test the
  upgrade-an-existing-database path explicitly, with real data in it.** Every test up to this
  correction pass exercised a freshly-migrated, freshly-seeded database, which can never expose a
  nullable-column-added-but-never-backfilled bug, because a fresh seed always populates every
  column itself. To actually test the upgrade path: bring a fresh database to the OLD schema
  version by running that migration's raw `.sql` directly, insert a tracking row into
  `drizzle.__drizzle_migrations` with that migration's own `folderMillis` (from `drizzle/meta/
  _journal.json`'s "when" field) and any hash value — drizzle's migrator only ever compares
  `created_at` against each migration's timestamp to decide what's pending, it never re-validates
  a hash for something already marked applied — then insert real relational data through raw SQL
  (not through a repository/seed function that might already write the new column), then run the
  REAL `migrate()` against the real migrations folder. See
  `tests/integration/db/migrationUpgrade.test.ts`.
- **When a schema migration adds a column whose value depends on relational data plus complex
  composition logic, don't reimplement that logic a second time in raw SQL for a backfill
  migration** — reuse the existing TypeScript function against the existing repository
  projection instead, triggered by a script (optionally auto-run as part of the migration
  command), even though this technically isn't "a new `.sql` migration file." Two
  implementations of the same composition logic (one in SQL, one in TypeScript) will drift the
  moment either one changes and nobody remembers to update the other — this is the same lesson
  as the title-normalization bug below, just for a bigger piece of logic.
- **A domain concept normalized once (lowercased, article-stripped, diacritic-stripped) for
  storage must be normalized the exact same way, by calling the exact same function, on the
  query side too** — a bare `.toLowerCase()` on the query side "looks like" it matches a
  `normalizeTitle()`-processed stored value closely enough that this class of bug can sit unnoticed
  for an entire phase (a query without the book's own article change is a common enough phrasing
  that it should have been an obvious test case, and wasn't, until an explicit audit went looking
  for it).
- **A TypeScript union type declaring more variants than the code that's supposed to produce them
  is a real, easy-to-miss gap, not just future-proofing** — `AutocompleteRow["type"]` declared
  `"topic" | "language"` since the type was written, and `tsc` has no way to warn "this union
  member is never actually constructed anywhere in the codebase." If a type declares a variant,
  grep for where it's actually produced before assuming it's the type just being extensible.
- **For a retrieval-embedding API where asymmetric document/query formatting matters, verify the
  CURRENT model's actual mechanism before assuming a well-known older convention still applies**
  — `gemini-embedding-001`'s `task_type` enum field is a different, no-longer-applicable
  mechanism from `gemini-embedding-2`'s plain-text instruction-prefix convention; the API surface
  changed between model generations even though the underlying goal (asymmetric retrieval) didn't.
  When no real API credential exists to test against, say so explicitly rather than asserting the
  contract is correct.

### Additional lessons from the Phase 5 real-provider validation pass (2026-09-17)

- **A distance threshold calibrated from one query's real embeddings is not enough — measure
  several structurally different queries before trusting the gap you saw.** The first correction
  (`1` → `0.36`) used one exploratory query's real distances and looked well-justified in
  isolation; a completely different query type (a plain known-item title lookup) immediately
  exposed that `0.36` still let almost the entire small catalog through, because the "noise
  floor" for this embedding model at this catalog's scale (~49 books) turned out to sit lower
  (~0.30-0.32) than the gap the first query happened to show. If you're calibrating a distance/
  similarity threshold from real embeddings, measure a known-item query, a structured query, and
  at least one exploratory query — not just the query type the bug report happened to mention.
- **A small catalog makes "the closest available real answer" and "generic noise" genuinely
  overlap in embedding-distance space — this is a real, inherent limit of the approach at this
  scale, not a bug to keep chasing with a tighter threshold.** Tightening further trades away the
  weakest exploratory queries' only available (if imperfect) answer; loosening lets noise back
  in for precise queries. The right response was picking a defensible trade-off point from real
  evidence and documenting the limitation honestly, not iterating toward an illusory "perfect"
  threshold.
- **A generic word can independently collide with the *tag/description* substring-matching rule
  in a completely different way than it collides with the *category/format* rule** — "very"
  (inside "every"/"everyday") and "day" (also inside "everyday") are two distinct real
  collisions found in the same query, requiring two different fixes (a stop-word addition for
  "very," since tag/description matching's looseness is intentional and shouldn't be narrowed; a
  whole-word matcher for "day," scoped only to category/format, a small fixed vocabulary where
  losing substring tolerance costs nothing real). Finding one substring-collision bug in a query
  doesn't mean you've found all of them in that same query — check every matcher the query's
  tokens could reach.
- **Rate limits from a real provider are not hypothetical once you're actually calling it
  repeatedly in one session** — smoke tests, embedding generation, and repeated evaluation runs
  in quick succession reliably triggered real `HTTP 429`s, and a real wait (even 8+ minutes) does
  not reliably clear it if the underlying quota is a daily one rather than per-minute. Build
  bounded retry-with-backoff before doing any repeated real-provider testing, and budget real
  calls conservatively across a validation session — a diagnostic script that queries already-
  stored embeddings via SQL (one API call for a query embedding, then a plain `<=>` distance
  query) is far cheaper than re-running a full evaluation harness that re-embeds an entire
  catalog just to inspect one query's distance distribution.
- **When manually running the dev server with a throwaway override for a secret you don't know
  the real value of (e.g. `STAFF_PASSWORD_HASH`), escape every `$` in the hash as `\$`, or it will
  be silently mangled the moment any `.env.local` file exists in the project** — this is not a
  new bug, it's the exact pre-existing platform quirk `docs/SECURITY.md`/`docs/DECISIONS.md`
  already document and already fixed inside `scripts/hash-password.mjs`/`playwright.config.ts`;
  it just doesn't protect an ad hoc manual override you type yourself. Diagnose a login that
  "should work" but doesn't (a fast, ~3ms response, a generic "password didn't work" error) by
  temporarily logging the actual `process.env` value the running server sees, not by re-guessing
  the shell quoting.

## Practical lessons from Phase 6 (worth knowing before touching the Drive integration or Phase 7)

- **A provider abstraction pattern that's already proven once in a codebase is worth copying
  file-for-file rather than reinventing, even for a genuinely different vendor.**
  `src/lib/googleDrive/` mirrors `src/lib/embeddings/`'s exact three-part shape
  (`provider.ts` interface+errors / concrete implementation, not `server-only` so it stays
  directly unit-testable / `index.ts` the one `server-only` production factory) — the same
  reason applies for both: `server-only` throws unconditionally under Vitest, so it can only
  ever live on the one factory module nothing needs to construct directly in a test.
- **When a method already fetched a resource's metadata for one reason, check whether a
  security/boundary check elsewhere in the same method is about to re-fetch the same data —
  it's a real, easy-to-miss double API call, not just test noise.** Found while writing
  `googleDriveProvider.test.ts`: the first `assertWithinRoot(fileId)` implementation always
  re-fetched `fileId`'s own parents via a fresh network call, even in `downloadSource`/
  `confirmUploadedFile`/`initiateResumableUpload`, all of which had already fetched that
  exact file's full metadata (parents included) moments earlier for an unrelated check
  (isFolder/trashed/capabilities). `assertMetadataWithinRoot` fixed this by starting the
  ancestry walk from metadata already in hand. The tell was mocked tests needing more queued
  HTTP responses than the number of *logical* Drive operations the method performed — when
  that mismatch shows up, look for a redundant re-fetch before assuming the test's mock
  sequencing is simply wrong.
- **A security-boundary algorithm (root/ancestry containment) is much more thoroughly
  testable as a pure function taking an injected data-source callback than as a method that
  always makes real calls.** `rootContainment.ts`'s `isWithinRoot(candidateId, root,
  getParents)` let `tests/unit/googleDrive/rootContainment.test.ts` build in-memory fake
  ancestry graphs (cycles, dead ends, multi-parent branches, depth past the bound) without
  any HTTP mocking at all — the real provider supplies the actual network-backed callback
  separately. Worth reaching for this shape whenever a traversal/graph algorithm needs to be
  proven correct independent of where its data actually comes from.
- **Google's resumable-upload `Location` header, not a JSON response body, carries the
  session URI** — a detail easy to get wrong by assuming every Drive API response is JSON.
  `initiateResumableUpload()` reads `response.headers.get("Location")`, not
  `response.json()`, and treats a missing header as `upload_failed` rather than crashing on
  a JSON-parse of what might be an empty body.
- **When a script needs to build a real binary asset for a smoke test (a tiny PNG, here),
  construct it programmatically with a verifiable format rather than hand-typing a base64
  constant you can't fully verify by inspection.** `scripts/google/smokeOrchestration.ts`'s
  `generateTinySyntheticPng()` builds real PNG chunks (IHDR/IDAT/IEND) with real CRC32s via
  Node's built-in `zlib.crc32`/`zlib.deflateSync` — its validity follows from the PNG format
  itself being correctly assembled, not from trusting an opaque byte string was transcribed
  correctly.
- **A local-only OAuth setup helper (`scripts/google/authorize.ts`) still needs the exact
  same `\$`-escaping discipline as `scripts/hash-password.mjs`** when writing a token
  containing `$` into `.env.local` — reused that established convention directly rather than
  discovering the bug again the hard way for a new credential type.
- **A public provider method that fetches metadata is a real root-containment escape hatch
  if it doesn't enforce the boundary itself — "callers check containment separately" is not
  enough, because it only takes one new caller that doesn't.** Found in code review, not by
  a failing test: `getFileMetadata` had zero containment enforcement while every other
  provider method had it, and the interface's own doc comment even said so. The fix
  (`fetchRawMetadata` private + `getFileMetadata` public wrapping it with a containment
  check) simplified three other methods that had been separately calling both the old
  `getFileMetadata` and their own containment check — the fix and a simplification arrived
  together, which is a good sign the fix was structurally right, not a patch.
- **A CLI script's `fail()`-style helper that calls `process.exit()` directly is a real risk
  once the script has created any real, cleanup-needing external state (a file, a resource,
  a lock)** — every exit path bypasses cleanup unless you go looking for each one. The fix
  that actually made the guarantee verifiable: extract the step sequence into a pure
  function that takes the external dependency (here, `CoverStorageProvider`) as a parameter
  and returns a result instead of exiting, so a `try/catch`'s cleanup logic is reachable from
  every failure path and testable with a fake dependency, no real credentials needed
  (`scripts/google/smokeOrchestration.ts`, `runSmokeTest`). This is the same shape as
  `src/lib/embeddings/generation.ts` (Phase 5) — extract pure orchestration out of a CLI
  wrapper whenever the CLI's own I/O (here, `process.exit`) would otherwise make correctness
  untestable.
- **When a task description reports a bug, verify the actual file before touching it — a
  reported "empty test file" was, on inspection, a real 71-line file with 9 passing tests
  covering exactly what was asked for.** `wc -l`, `ls -la`, and running the test file
  directly took under a minute and prevented deleting or rewriting already-correct,
  already-tested code for no reason. Report the discrepancy plainly rather than silently
  "fixing" a non-problem.
- **A Workspace's own security policy can block OAuth authorization entirely, independent of
  anything this application's code does** — SSJC's Workspace currently blocks third-party
  OAuth app authorization pending admin review, which has nothing to do with the two scopes
  requested or any code in this repository. When a real integration's setup instructions
  assume an organizational account will authorize directly, budget for the real possibility
  that it can't, and document a working fallback (here: a personal account + Drive folder
  sharing) as a *fallback*, explicitly not silently redefining it as the new plan — the
  production credential decision this creates is real and belongs to whoever deploys this,
  not something to quietly resolve by omission.

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
