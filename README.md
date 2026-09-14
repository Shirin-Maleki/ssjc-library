# Scandinavian School of Jersey City — Library App

*(Working name — not final. See [`docs/PRODUCT_SPEC.md`](docs/PRODUCT_SPEC.md) for naming status.)*

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

**Current phase: Phase 1 — Foundation, Design System & Access (complete, awaiting review).**
A real Next.js application now exists: the Welcome/staff-login screen, the Home screen with
its two dominant actions, polished placeholders for every not-yet-built destination, and an
Admin unlock framework — all using mock-free, database-free, credential-free logic (there's
nothing to mock yet at this phase; only shared-password auth is implemented, and it needs no
external service). See `docs/IMPLEMENTATION_STATUS.md` for exactly what's built.

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
[`docs/TESTING.md`](docs/TESTING.md).

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

Pending. The school logo and color palette have not yet been provided. The application is
architected with a centralized branding/token system (see `docs/ARCHITECTURE.md`) so real
assets can be dropped in later without redesigning anything. Do not treat any color or
identity element that appears in early UI as final — it will be a neutral placeholder,
clearly marked as such.
