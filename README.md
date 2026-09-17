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

**Current phase: Phase 5 — Real search architecture (in progress).** Phase 4 (real database) is
complete and approved. Find a Book now runs a real, bounded, database-backed hybrid search
pipeline — structured SQL filters, Postgres full-text + trigram fuzzy matching, and optional
pgvector semantic retrieval, combined by a transparent scorer on top of the unchanged
deterministic Phase 2–4 ranking engine — instead of loading the whole catalog into Node and
filtering it in memory. Reading Lists (genuinely shared Postgres persistence, Phase 4) and voice
search (Phase 3) are unaffected. Staff/admin authentication (Phase 1) still gates everything.
**No real `GEMINI_API_KEY` exists in this environment** — semantic retrieval is fully built and
tested with a deterministic fake provider, but real semantic-quality validation has not been
performed; conventional search works completely without any key. See
`docs/IMPLEMENTATION_STATUS.md` for exactly what's built and what remains, `docs/DATABASE_SETUP.md`
for the database itself, and `docs/SEARCH.md` for the full search architecture.

## Local setup

```
npm install
npm run auth:hash-password -- "choose-a-staff-password"   # copy the printed hash
npm run auth:hash-password -- "choose-a-different-admin-password"
```

Create `.env.local` (never committed) from `.env.example`, pasting in the two hashes above, a
random `SESSION_SECRET` (`openssl rand -base64 32`), and a Postgres connection string (see
[`docs/DATABASE_SETUP.md`](docs/DATABASE_SETUP.md) — a disposable local Postgres instance works
fine for development). Then:

```
npm run db:reset          # migrate + seed the database DATABASE_URL points at
npm run dev                # http://localhost:3000
npm run build               # production build
npm run typecheck
npm run lint
npm run test                # unit tests (Vitest), no database needed
npm run test:integration    # real-database repository tests (needs TEST_DATABASE_URL)
npm run test:e2e             # end-to-end tests (Playwright, builds its own fixture server + database)
npm run evaluate:search      # search relevance evaluation report (needs TEST_DATABASE_URL)
npm run embeddings:generate  # backfill semantic embeddings — no-ops cleanly without GEMINI_API_KEY
```

No Google Drive/Sheets credentials are needed for anything above — that integration doesn't
exist yet (Phases 6, 9). An optional `GEMINI_API_KEY` (see
[`docs/DATABASE_SETUP.md`](docs/DATABASE_SETUP.md)) activates real semantic search retrieval and
embedding generation; every other feature, including conventional search, works completely
without it.

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
[`docs/TESTING.md`](docs/TESTING.md), [`docs/SEARCH.md`](docs/SEARCH.md),
[`docs/DATABASE_SETUP.md`](docs/DATABASE_SETUP.md).

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
