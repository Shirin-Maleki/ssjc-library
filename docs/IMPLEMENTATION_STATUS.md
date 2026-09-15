# Implementation Status

Last updated: 2026-09-15 (end of Phase 3). This document is continuity insurance — it should
always let another coding agent open this repository cold and know exactly where things
stand. Keep it current at the end of every phase.

## Current phase

**Phase 3 — Voice + Reading Lists + Guide: complete, awaiting review.** Voice search
(progressive enhancement over the browser's Web Speech API, reusing Find's exact deterministic
search pipeline), shared local Reading Lists (create/rename/delete/add/remove, localStorage-
backed behind a repository interface), and a real Library Guide are all built. Phase 4 has
not started and must not start until Phase 3 is explicitly approved.

## Full phase plan (for reference — do not execute ahead of approval)

| Phase | Name | Status |
|---|---|---|
| 0 | Repository inspection + architecture | Complete (approved) |
| 1 | Foundation + design system + access | Complete (approved), branding applied 2026-09-14 |
| 2 | Mock library + Find a Book | Complete (approved), visual/mobile revision 2026-09-14 |
| 3 | Voice + reading lists + guide | **Complete — awaiting review** |
| 4 | Real database | Not started |
| 5 | Real search architecture | Not started |
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

## In-progress work

None.

## Blocked work

None. Phase 4 (the real database) can begin without any external credential blocking it, but
per the approved roadmap it should wait for explicit approval of this Phase 3 report first.

## Deferred work

Everything in Phases 4–13, by design. Notably still not built: any AI/LLM involvement in
search (still fully deterministic), a real database (Reading Lists are local-only until then),
Google/Sheets/Drive integration, and the school's final physical taxonomy (still the 8
provisional development categories — see `docs/PRODUCT_SPEC.md` and
`src/lib/catalog/categories.ts`).

## Pending user inputs

**Resolved 2026-09-14:** the school logo file arrived (`public/brand/logo.png`, real artwork,
wired into `LogoMark`) — see `docs/BRANDING.md` for a measured (not eyeballed) color
discrepancy between the logo's actual pixels and the documented official palette, flagged as
a genuine open question (which should be the "true" reference) rather than resolved by
assumption. Branding is now fully real end to end — nothing placeholder remains.

None of these block Phase 4:

- **Google Drive folder — link received 2026-09-14** (three sub-folders of scanned book
  covers). Not yet inspected: the Google Drive connector isn't authorized in-session yet, and
  per the approved roadmap this isn't needed until Phase 6 regardless. The actual link is
  intentionally not recorded in this repo (Phase 0 treats private Drive identifiers like
  credentials) — it's tracked outside the repo for when Phase 6 begins.
- Google Sheet for the teacher catalog projection (Phase 9).
- Which AI provider(s) you hold API/billing access to.
- Supabase project credentials.
- Eventually: feedback on whether the 8 provisional physical categories used for Phase 2
  testing feel like a reasonable direction, once Phase 11's real taxonomy research begins —
  not needed now.

## Known bugs

None open. This phase found and fixed three real bugs during its own testing — none search-
related, all in the new Reading Lists/voice UI — full writeups in `docs/TESTING.md`:
1. A native HTML `required` attribute on the Create/Rename/Add-to-list name fields silently
   blocked the custom, more-accessible JS validation message from ever running.
2. The Add-to-list dialog auto-skipped straight to its "create new list" form whenever no
   lists existed yet, silently bypassing the documented "select an existing list" view (which
   already correctly handled the empty case) — an unintended shortcut, not a deliberate one.
3. `react-hooks/set-state-in-effect` (a newer, stricter lint rule) caught a real anti-pattern
   in `ReadingListsProvider`'s initial load effect — calling a local `useCallback`-wrapped
   function that itself calls `setState`, from inside an effect. Fixed by inlining the
   repository call and handling its resolution directly, per `docs/AGENT_HANDOFF.md`.

## Environment variables

Unchanged from Phase 1 (`STAFF_PASSWORD_HASH`, `ADMIN_PASSWORD_HASH`, `SESSION_SECRET`,
optional `SESSION_COOKIE_SECURE`) — Phase 3 needed no new environment variables. Voice search
uses only the browser's own Web Speech API (no server-side key); Reading Lists use only
`localStorage`.

## Migrations

None yet — no database exists until Phase 4. When it arrives, `books` in
`src/lib/catalog/fixtures.ts` is the seam that gets replaced by a real query, and
`LocalStorageReadingListRepository` is the seam that gets replaced by a real
`ReadingListRepository` implementation — both shapes were deliberately kept close to the
eventual schema (`docs/DATA_MODEL.md`) for exactly this reason.

## External services

Unchanged — nothing connected. Voice search talks only to the browser's own built-in speech
recognition (no network call this app makes or controls); Reading Lists talk only to
`localStorage`. Phase 3 needed no mocks.

## Git status

Repository is linked to `github.com/Shirin-Maleki/ssjc-library` (`origin`, `main`). New
commit(s) this phase add voice search, Reading Lists, and the Library Guide on top of the
Phase 0–2 history (including the Phase 2 visual/mobile revision). See the phase report for
exact commit SHA(s) and push status.

## Next recommended task

Await review of this Phase 3 report. Once approved, **Phase 4 — the real database**: Supabase/
Postgres via Drizzle, replacing `src/lib/catalog/fixtures.ts` and
`LocalStorageReadingListRepository` with real queries behind the same interfaces, per
`docs/DATA_MODEL.md` and `docs/DECISIONS.md`.

Do not begin Phase 4 without explicit approval.
