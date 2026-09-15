# SSJC Library

The staff library application for the Scandinavian School of Jersey City. App name, color
palette, and typography confirmed 2026-09-14 — see [`docs/BRANDING.md`](docs/BRANDING.md).

A staff-facing web application that becomes the practical operating system for the school's
physical children's-book library: finding books, discovering books by teaching need,
adding newly acquired/donated books, maintaining rich digital metadata while keeping physical
shelving simple, and evolving the library's taxonomy over time.

This is also a professional UX/product-design portfolio project, developed under a strict
**phase-gated process**: one phase at a time, tested and documented, with an explicit
implementation report and a stop-and-wait checkpoint after every phase. Nothing here was
built in a rush — check [`docs/IMPLEMENTATION_STATUS.md`](docs/IMPLEMENTATION_STATUS.md) for
exactly what exists right now versus what is planned.

## Project status

**Current phase: Phase 3 — Voice + Reading Lists + Guide (complete, awaiting review).** On top
of Phase 2's deterministic Find a Book experience: voice search (progressive enhancement over
the browser's Web Speech API, reusing the exact same search pipeline typed queries use),
shared local Reading Lists (create/rename/delete/add/remove, saved in this browser only until
Phase 4's real database), and a real Library Guide. Staff/admin authentication (Phase 1) still
gates everything. Still no database, Google, or AI integration. See
`docs/IMPLEMENTATION_STATUS.md` for exactly what's built and `docs/SEARCH.md` for how the
search engine works.

## Local setup

```
npm install
npm run auth:hash-password -- "choose-a-staff-password"   # copy the printed hash
npm run auth:hash-password -- "choose-a-different-admin-password"
```

Create `.env.local` (never committed) from `.env.example`, pasting in the two hashes above and
a random `SESSION_SECRET` (`openssl rand -base64 32`). Then:

```
npm run dev          # http://localhost:3000
npm run build         # production build
npm run typecheck
npm run lint
npm run test          # unit tests (Vitest)
npm run test:e2e      # end-to-end tests (Playwright, builds its own fixture server)
```

No database, Google, or AI credentials are needed for anything above — Phase 1 doesn't
connect to any external service.

## How to read this repository

Start here, in order:

1. [`docs/IMPLEMENTATION_STATUS.md`](docs/IMPLEMENTATION_STATUS.md) — what phase we're in, what's done, what's next, what's blocked.
2. [`docs/AGENT_HANDOFF.md`](docs/AGENT_HANDOFF.md) — if you are a coding agent picking this project up cold, read this first.
3. [`docs/DECISIONS.md`](docs/DECISIONS.md) — every significant architectural/product decision, why it was made, and how to change it later.
4. [`docs/PRODUCT_SPEC.md`](docs/PRODUCT_SPEC.md) — the product requirements this project is building toward.
5. [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — the technical architecture: frontend, backend, database, AI, Google integrations, search, deployment.
6. [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md) — the relational schema in full detail.

Phase-specific detail, split out once a subject becomes operationally real (per the "don't
create placeholder docs" rule): [`docs/SECURITY.md`](docs/SECURITY.md),
[`docs/ACCESSIBILITY.md`](docs/ACCESSIBILITY.md), [`docs/BRANDING.md`](docs/BRANDING.md),
[`docs/TESTING.md`](docs/TESTING.md), [`docs/SEARCH.md`](docs/SEARCH.md).

## Non-negotiable product principles (short version)

- **Teachers are the users, not children.** No child accounts, no gamification, no child-facing screens.
- **Physical simplicity, digital richness.** Every book has exactly one primary physical
  category (for shelving); it may carry many digital tags (for search/discovery).
- **The app never hallucinates the catalog.** Recommendations only ever reference books this
  library actually owns.
- **AI suggests, humans decide.** AI never silently creates categories, merges records, or
  overwrites verified metadata.
- **Fast intake.** Adding a book should take a teacher roughly 30–60 seconds of attention.
- **Reversibility.** Important decisions are configurable and documented, not hard-coded
  assumptions scattered through the codebase.

Full detail in [`docs/PRODUCT_SPEC.md`](docs/PRODUCT_SPEC.md).

## Development process

This project is built in 14 planned phases (Phase 0 through Phase 13), executed one at a
time with no automatic continuation. Each phase ends with testing, documentation updates,
and a detailed implementation report, then stops for explicit approval before the next phase
begins. The full phase plan is recorded in [`docs/IMPLEMENTATION_STATUS.md`](docs/IMPLEMENTATION_STATUS.md).

## Branding status

App name, color palette, typography, and the real logo are all in place, provided by the
school 2026-09-14/15 — see `docs/BRANDING.md` for the full mapping, the logo integration, and
the accessibility verification behind every choice. Nothing in the brand system remains a
placeholder.
