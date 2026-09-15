# Implementation Status

Last updated: 2026-09-14 (end of Phase 2). This document is continuity insurance — it should
always let another coding agent open this repository cold and know exactly where things
stand. Keep it current at the end of every phase.

## Current phase

**Phase 2 — Mock Library + Find a Book: complete, awaiting review.** A real, fully
deterministic search/browse/filter experience now exists against a 48-book development
fixture catalog. Phase 3 has not started and must not start until Phase 2 is explicitly
approved.

## Full phase plan (for reference — do not execute ahead of approval)

| Phase | Name | Status |
|---|---|---|
| 0 | Repository inspection + architecture | Complete (approved) |
| 1 | Foundation + design system + access | Complete (approved), branding applied 2026-09-14 |
| 2 | Mock library + Find a Book | **Complete — awaiting review** |
| 3 | Voice + reading lists + guide | Not started |
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

## In-progress work

None.

## Blocked work

None. Phase 3 (voice input, reading lists, library guide) can begin without any external
credential.

## Deferred work

Everything in Phases 3–13, by design. Notably still not built: any AI/LLM involvement in
search (Phase 2 is deterministic by explicit design), voice input, a real database, and the
school's final physical taxonomy (Phase 2's 8 categories are explicitly provisional
development data — see `docs/PRODUCT_SPEC.md` and `src/lib/catalog/categories.ts`).

## Pending user inputs

**Resolved 2026-09-14:** the school logo file arrived (`public/brand/logo.png`, real artwork,
wired into `LogoMark`) — see `docs/BRANDING.md` for a measured (not eyeballed) color
discrepancy between the logo's actual pixels and the documented official palette, flagged as
a genuine open question (which should be the "true" reference) rather than resolved by
assumption. Branding is now fully real end to end — nothing placeholder remains.

None of these block Phase 3:

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

None open. Four search-ranking bugs and one diacritics bug were found and fixed during this
phase (see `docs/SEARCH.md`, `docs/TESTING.md`) — all covered by regression tests now.

## Environment variables

Unchanged from Phase 1 (`STAFF_PASSWORD_HASH`, `ADMIN_PASSWORD_HASH`, `SESSION_SECRET`,
optional `SESSION_COOKIE_SECURE`) — Phase 2 needed no new environment variables, since the
entire mock catalog and search engine run in-process with no external service.

## Migrations

None yet — no database exists until Phase 4. When it arrives, `books` in
`src/lib/catalog/fixtures.ts` is the seam that gets replaced by a real query — the shape was
deliberately kept close to the eventual schema (`docs/DATA_MODEL.md`) for exactly this reason.

## External services

Unchanged — nothing connected. Phase 2 needed no mocks, since nothing in its scope talks to
an external service (search runs entirely against the in-process fixture array).

## Git status

Local repository, no remote, nothing pushed. New commit(s) this phase add the Phase 2
catalog, search engine, Find/Book Detail UI, tests, and documentation on top of the Phase 0/1
history. Working tree clean at the end of this phase.

## Next recommended task

Await review of this Phase 2 report. Once approved, **Phase 3 — Voice + Reading Lists +
Guide**: browser speech-recognition search input with typed fallback and explicit no-recording
privacy guidance, shared accountless reading lists (create/rename/delete/add/remove), and the
Library Guide content screen.

Do not begin Phase 3 without explicit approval.
