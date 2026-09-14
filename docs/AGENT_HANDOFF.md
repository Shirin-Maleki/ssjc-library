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

Phase 0 (architecture and planning) is complete. No application code exists. Nothing has been
scaffolded, no dependencies installed, no external service connected. See
`docs/IMPLEMENTATION_STATUS.md` for the authoritative, continuously updated detail — this
file only orients you to the process, not the current state, since state changes every phase
and duplicating it here would drift.

## Key architectural decisions already made (see `docs/DECISIONS.md` for full reasoning)

Postgres via Supabase as canonical database; Kysely (not an ORM) for data access; Next.js
Server Actions/Route Handlers with no separate backend service; Google Drive as the
original-image source of truth with Google Sheets as a one-way generated projection; pgvector
inside the same Postgres database for semantic search (no separate vector DB); a unified
`book_field_status` table for provenance + confidence; a `book_duplicates` relationship table
distinguishing exact-copy/different-edition/different-language/false-match; and a shared
ingestion pipeline used by both single Add-a-Book and bulk import. AI provider, embedding
model, and exact Google auth mechanism remain genuinely open pending real credentials and the
requester's input — don't lock these in silently.
