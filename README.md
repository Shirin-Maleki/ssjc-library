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

**Current phase: Phase 8 — Admin Review + Taxonomy — COMPLETE (2026-09-22).** An admin can
open a real, database-backed review queue (uncertain identity/duplicates, category decisions,
metadata conflicts, missing useful metadata), resolve a Phase 7 Review Later item without
rerunning the AI pipeline, work through a focused five-outcome duplicate comparison (same
edition / different edition / different language / false match / unresolved — never a general
merge engine), correct catalog metadata with the same presence-based provenance semantics
Quick Edit already established, and manage physical shelving categories and taxonomy
suggestions — always as an explicit human action; AI never auto-creates or auto-activates a
category. Full detail: `docs/IMPLEMENTATION_STATUS.md`, `docs/TAXONOMY.md`. One additive
migration (`drizzle/0004_...`), no new tables. Phase 7 (Add a Book, including its 2026-09-21
correction pass), Phase 6 (Google Drive connection), and Phase 5 (real search architecture)
remain complete and approved, unaffected except where Phase 8 built directly on their
infrastructure. Find a Book, Reading Lists, voice search, and the core Add a Book flow are all
unaffected. See `docs/IMPLEMENTATION_STATUS.md` for exactly what's built, `docs/DATABASE_SETUP.md`
for the database itself, `docs/SEARCH.md` for the full search architecture, and
`docs/GOOGLE_INTEGRATION.md`/`docs/GOOGLE_SETUP.md` for the Drive integration.

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
npm run search:rebuild-text  # rebuild conventional full-text search after a metadata edit/import
npm run google:authorize     # one-time local OAuth setup for Google Drive (see docs/GOOGLE_SETUP.md)
npm run google:smoke         # real, opt-in Google Drive connectivity proof — needs real OAuth config
```

No Google Sheets credentials exist yet — that integration doesn't exist yet (Phase 9). An
optional `GEMINI_API_KEY` (see [`docs/DATABASE_SETUP.md`](docs/DATABASE_SETUP.md)) activates
real semantic search retrieval/embedding generation (Phase 5) and Add-a-Book cover
vision/enrichment (Phase 7); every other feature, including conventional search, works
completely without it. An optional Google Drive OAuth setup (see
[`docs/GOOGLE_SETUP.md`](docs/GOOGLE_SETUP.md)) is required for Add a Book (source cover
storage) but nothing else depends on it. An optional `GOOGLE_BOOKS_API_KEY` improves
Add-a-Book's metadata lookup; Open Library (no key needed) is used regardless.

## How to read this repository

Start here, in order:

1. [`docs/IMPLEMENTATION_STATUS.md`](docs/IMPLEMENTATION_STATUS.md) — what phase we're in, what's done, what's next, what's blocked.
2. [`docs/AGENT_HANDOFF.md`](docs/AGENT_HANDOFF.md) — if you are a coding agent picking this project up cold, read this first.
3. [`docs/DECISIONS.md`](docs/DECISIONS.md) — every significant architectural/product decision, why it was made, and how to change it later.
4. [`docs/PRODUCT_SPEC.md`](docs/PRODUCT_SPEC.md) — the product requirements this project is building toward.
5. [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — the technical architecture: frontend, backend, database, AI, Google integrations, search, deployment.
6. [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md) — the relational schema in full detail.
7. [`docs/AI_PIPELINE.md`](docs/AI_PIPELINE.md) — the Add-a-Book AI/external-provider pipeline (Phase 7): vision, metadata lookup, reconciliation, duplicate detection, enrichment.
8. [`docs/TAXONOMY.md`](docs/TAXONOMY.md) — physical category lifecycle and the taxonomy-suggestion review workflow (Phase 8), and where the Phase 11 boundary sits.

Phase-specific detail, split out once a subject becomes operationally real (per the "don't
create placeholder docs" rule): [`docs/SECURITY.md`](docs/SECURITY.md),
[`docs/ACCESSIBILITY.md`](docs/ACCESSIBILITY.md), [`docs/BRANDING.md`](docs/BRANDING.md),
[`docs/TESTING.md`](docs/TESTING.md), [`docs/SEARCH.md`](docs/SEARCH.md),
[`docs/DATABASE_SETUP.md`](docs/DATABASE_SETUP.md),
[`docs/GOOGLE_INTEGRATION.md`](docs/GOOGLE_INTEGRATION.md) (architecture),
[`docs/GOOGLE_SETUP.md`](docs/GOOGLE_SETUP.md) (setup walkthrough),
[`docs/COSTS.md`](docs/COSTS.md).

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
