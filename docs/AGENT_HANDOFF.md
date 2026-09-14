# Agent Handoff

If you are a coding agent (or a future instance of yourself) picking this project up without
prior context, read in this order:

1. `README.md` — project overview and orientation.
2. `docs/IMPLEMENTATION_STATUS.md` — exact current state, what's done, what's next.
3. This file.
4. `docs/DECISIONS.md` — every significant decision and why, so you don't relitigate settled
   choices or accidentally contradict them.
5. `docs/PRODUCT_SPEC.md` and `docs/ARCHITECTURE.md` / `docs/DATA_MODEL.md` as needed for the
   task at hand.

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

Phase 0 (architecture) and Phase 1 (foundation, design system, staff/admin auth) are both
complete. A real Next.js app runs, with Welcome/Home/placeholder screens and full
shared-password authentication — no database, Google, or AI integration yet. See
`docs/IMPLEMENTATION_STATUS.md` for the authoritative, continuously updated detail — this
file only orients you to the process, not the current state, since state changes every phase
and duplicating it here would drift.

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

Postgres via Supabase as canonical database; **Drizzle** (not Kysely, not an ORM like Prisma)
for schema, migrations, and data access — revised from an initial Kysely choice during Phase
0 review, before any code existed, specifically because a TypeScript-schema-as-source-of-
truth tool suits a project built by AI coding agents and maintained by a designer better than
a purer-but-more-manual query-builder-only approach. Next.js Server Actions/Route Handlers
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
