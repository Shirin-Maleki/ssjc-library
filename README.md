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

**Current phase: Phase 9 — Google Sheets + Bulk Import Infrastructure, including its physical-
copy-locations addendum — implemented and real-validated (2026-09-23).** A real, persistent
Google Sheet ("SSJC Library Catalog") now syncs from canonical PostgreSQL (`npm run
sheets:sync`), and a standalone bulk-import CLI/worker (`npm run import:*`) turns Drive
photographs into real catalog books by reusing Phase 7's intake pipeline end to end — never a
second implementation of it. Both were validated against real external services: real Drive
enumeration found 1,618 real images in the actual SSJC collection; a real bounded 3-image run
completed automatically (real Drive/Gemini/Open Library calls) into 3 real active catalog books,
one confirmed findable through Find's own real search; a real Sheets create/sync/reuse round
trip completed against the live Google account. **The full ~1,500-image collection was NOT
processed** — only this small, bounded validation sample.

**Addendum (same day):** physical copy location is now tracked separately from a book's shelving
category — a new `library_locations` table, a teacher-facing "Move a Book" workflow (`/move`)
that photographs a cover, matches it against the catalog, and moves exactly one physical copy
after explicit confirmation, an optional `--location` on the bulk importer, and a Location
column in the Sheet. Real-validated against the live Sheets API and at real phone width. See
`docs/DATA_MODEL.md` §12b and `docs/ARCHITECTURE.md` §8b.

Full detail: `docs/IMPLEMENTATION_STATUS.md`, `docs/BULK_IMPORT.md`, `docs/DECISIONS.md`. Three
additive/corrective migrations (`drizzle/0006_...` through `0008_...`), one new table
(`library_locations`). Phase 8 (Admin Review + Taxonomy), Phase 7 (Add a Book), Phase 6 (Google
Drive connection), and Phase 5 (real search architecture) remain complete and approved,
unaffected except where Phase 9 built directly on their infrastructure. Find a Book, Reading
Lists, voice search, and the core Add a Book flow are all unaffected. See
`docs/IMPLEMENTATION_STATUS.md` for exactly what's built, `docs/DATABASE_SETUP.md` for the
database itself, `docs/SEARCH.md` for the full search architecture, and
`docs/GOOGLE_INTEGRATION.md`/`docs/GOOGLE_SETUP.md` for the Drive/Sheets integration.

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
npm run sheets:sync          # sync the canonical catalog to the real Google Sheet (Phase 9)
npm run import:list          # read-only bulk-import source enumeration (Phase 9)
npm run import:create-job    # bounded bulk-import job creation — see docs/BULK_IMPORT.md
npm run import:run           # process a bulk-import job's pending items
```

Google Sheets reuses the same OAuth credential as Drive (Phase 9, `docs/GOOGLE_SETUP.md`) — no
separate Sheets credential to configure, only enabling the Sheets API itself once in Google
Cloud Console. An optional `GEMINI_API_KEY` (see [`docs/DATABASE_SETUP.md`](docs/DATABASE_SETUP.md)) activates
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
8. [`docs/TAXONOMY.md`](docs/TAXONOMY.md) — physical category lifecycle and the taxonomy-suggestion review workflow (Phase 8), and where taxonomy finalization sits in the revised roadmap (Phase 10).
9. [`docs/BULK_IMPORT.md`](docs/BULK_IMPORT.md) — the bulk-import CLI/worker architecture and Phase 10 operating procedure (Phase 9).

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

This project is built in planned phases (Phase 0 through Phase 11, per the roadmap revised at
Phase 9 — the original plan's remaining Phases 9–13 were consolidated into two; see
`docs/IMPLEMENTATION_STATUS.md`'s "revised roadmap" note), executed one at a time with no
automatic continuation. Each phase ends with testing, documentation updates, and a detailed
implementation report, then stops for explicit approval before the next phase begins. The full
phase plan is recorded in [`docs/IMPLEMENTATION_STATUS.md`](docs/IMPLEMENTATION_STATUS.md).

## Branding status

App name, color palette, typography, and the real logo are all in place, provided by the
school 2026-09-14/15 — see `docs/BRANDING.md` for the full mapping, the logo integration, and
the accessibility verification behind every choice. Nothing in the brand system remains a
placeholder.
