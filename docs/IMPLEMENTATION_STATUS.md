# Implementation Status

Last updated: 2026-09-13 (end of Phase 1). This document is continuity insurance — it should
always let another coding agent open this repository cold and know exactly where things
stand. Keep it current at the end of every phase.

## Current phase

**Phase 1 — Foundation + Design System + Access: complete, awaiting review.** A real
application exists and runs. Phase 2 has not started and must not start until Phase 1 is
explicitly approved.

## Full phase plan (for reference — do not execute ahead of approval)

| Phase | Name | Status |
|---|---|---|
| 0 | Repository inspection + architecture | Complete (approved) |
| 1 | Foundation + design system + access | **Complete — awaiting review** |
| 2 | Mock library + Find a Book | Not started |
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

## Completed work (Phase 1)

- Next.js 16 (App Router) + React 19 + TypeScript (strict) + Tailwind v4 scaffold, generated
  via `create-next-app` then customized — not hand-rolled from scratch, to start from a
  correct, current baseline.
- Poppins loaded via `next/font/google`, weights 400/500/600/700 only, applied through one
  CSS variable — no component sets its own font.
- A centralized semantic design-token system (`src/app/globals.css`) — every color, radius,
  and font reference goes through a named token, never a raw value in a component. Palette is
  a deliberately neutral placeholder (see `docs/BRANDING.md`), and every text/border pairing
  actually in use was checked against real WCAG contrast math, not eyeballed (see
  `docs/ACCESSIBILITY.md`) — this caught and fixed two real failing pairs.
- Full shared-password staff/admin authentication: bcrypt verification, signed HTTP-only
  session cookies (`jose`), sliding expiry, admin elevation with its own shorter window that
  silently downgrades rather than logging out, logout, and an in-memory login-attempt
  throttle (explicitly a Phase 1 interim stand-in for the Postgres-backed table designed in
  Phase 0 — see `docs/SECURITY.md`).
- Server-side route protection via `src/proxy.ts` (Next.js 16 renamed the `middleware`
  convention to `proxy` — migrated via the official codemod) plus a Server Component guard,
  not client-side hiding.
- Welcome screen (Tap to Enter → staff password), Home screen with the two dominant Find/Add
  actions and visually subordinate secondary navigation, and polished "coming in a later
  phase" placeholders for Find, Add, Reading Lists, Library Guide, Teacher Catalog, and the
  Admin dashboard — no fake functionality anywhere.
- 19 unit tests (Vitest) + 38 E2E tests (Playwright, run against **both real Chromium and
  real WebKit** — WebKit standing in for iPhone Safari) — all passing. Two real bugs were
  found and fixed by this testing, not just theoretical coverage: a WebKit-specific session
  cookie bug (`docs/SECURITY.md`, `docs/TESTING.md`) and a missing semantic heading on the
  two primary Home actions.
- Real screenshots (not just code review) captured and visually inspected at a mobile
  (390×844) and desktop (1440×900) viewport for every major screen — caught and fixed an
  unresolved-empty-space layout issue on Home.
- Typecheck, lint, and production build all pass cleanly.

## In-progress work

None.

## Blocked work

None. Phase 2 (mock library + Find a Book UI) can begin without any external credential.

## Deferred work

Everything in Phases 2–13, by design.

## Pending user inputs

Unchanged from Phase 0 — none block Phase 2:

- Final application name, school logo, color palette.
- Google Drive folder URL(s), Google Sheet.
- Which AI provider(s) you hold API/billing access to.
- Supabase project credentials.

## Known bugs

None open. Two were found and fixed during this phase (see Testing above) — neither remains.

## Environment variables

| Name | Purpose | Required? |
|---|---|---|
| `STAFF_PASSWORD_HASH` | bcrypt hash of the shared staff password | Yes |
| `ADMIN_PASSWORD_HASH` | bcrypt hash of the shared admin password/PIN | Yes |
| `SESSION_SECRET` | Signs session cookies | Yes |
| `SESSION_COOKIE_SECURE` | Override the cookie's `Secure` flag (`true`/`false`) | No — only for a deliberate plain-HTTP context; never set on a real deployment |

Generate the two hashes with `npm run auth:hash-password -- "your password"`. None of these
are committed anywhere; see `.env.example`.

## Migrations

None yet — no database exists until Phase 4.

## External services

Unchanged from Phase 0 — nothing connected. Phase 1 needed no mocks, since nothing in its
scope talks to an external service at all (auth is entirely self-contained).

## Git status

Local repository, no remote, nothing pushed. Commits so far: Phase 0 architecture (2 commits,
initial + review revision), Phase 1 scaffold and implementation (committed in this phase,
including the WebKit cookie fix, accessibility contrast fixes, and the `proxy.ts` migration).
Working tree clean at the end of this phase.

## Next recommended task

Await review of this Phase 1 report. Once approved, **Phase 2 — Mock Library + Find a Book**:
realistic mock catalog data, natural-language text search UI (logic can be deterministic/mock
at this stage), autocomplete, browse/filters, Top 5 ranked results, book detail, and the
loading/empty/no-result states — validating the teacher search experience before any real
database or AI is connected.

Do not begin Phase 2 without explicit approval.
