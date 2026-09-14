# Implementation Status

Last updated: 2026-09-13 (Phase 0, after first architecture review round). This document is
continuity insurance — it should always let another coding agent open this repository cold
and know exactly where things stand. Keep it current at the end of every phase and review
round.

## Current phase

**Phase 0 — Repository Inspection + Architecture: revised after first review round, still
awaiting approval to close.** No application code exists. Phase 1 has not started and must
not start until Phase 0 is explicitly approved.

## Full phase plan (for reference — do not execute ahead of approval)

| Phase | Name | Status |
|---|---|---|
| 0 | Repository inspection + architecture | **In review — revision 2 delivered, awaiting approval** |
| 1 | Foundation + design system + access | Not started |
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

Each phase executes only after explicit approval of the previous one's report. Never
executed automatically or combined without approval.

## Completed work (Phase 0, both rounds)

**Round 1:** full architecture proposal, 25-table schema, 16-entry decision log, local git
repo initialized.

**Round 2 (this revision), addressing 10 review points:**
1. Split `books` into `books` (bibliographic/edition) + new `book_copies` (physical
   instances) — supports per-copy location without a checkout system or individual labels.
2. Locked age representation as whole integer months, with a documented, tested display-
   conversion function and explicit unknown/open-ended handling.
3. Redesigned metadata provenance (`book_field_status` → `book_field_provenance`): field
   vocabulary is now an app-level Zod registry, not a database enum; the table preserves
   full evidence history (append + supersede) rather than only the latest value; source
   classification expanded to external/AI-inferred/human-corrected/human-verified.
4. Corrected the bulk-import execution model: a standalone Node.js worker script
   (`scripts/import/run.ts`), never a Vercel Server Action/API request — the first draft had
   left this ambiguous, and a long-running serverless request would not actually have worked.
5. Made original-capture vs. display-cover an explicit, named distinction with a defined,
   configurable fallback order (our own derived photo first, external thumbnail fallback,
   Drive proxy last resort).
6. Rewrote search architecture as five explicit layers with defined graceful degradation —
   exact/normalized matching, structured filters, and Postgres text/trigram search all work
   with zero AI dependency; semantic retrieval only ever adds to that.
7. Fully specified the shared-password session mechanism: cookie flags, expiration, admin
   elevation, logout, CSRF/same-origin handling, login-attempt throttling.
8. Performed a full table-by-table complexity review (25 → 23 tables): removed `languages`,
   `work_groups`, and `taxonomy_suggestion_evidence` as over-modeled for current needs; kept
   everything else with a stated justification.
9. Compared Kysely against Drizzle specifically against this project's priorities (agent-
   modifiability, rapid iteration, single-source-of-truth schema) and **switched the
   recommendation to Drizzle**, before any code exists.
10. Updated `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`, `docs/DECISIONS.md`, this file, and
    `docs/AGENT_HANDOFF.md` to reflect all of the above.

## In-progress work

None.

## Blocked work

None. Phase 1 (project scaffold, using mock data throughout) can begin without any external
credential or asset, once Phase 0 is approved.

## Deferred work

Everything in Phases 1–13. Also explicitly deferred within the data model itself: work-group
linking (`work_groups`) until a real same-work/different-language case exists in the
collection.

## Pending user inputs

None of these block Phase 1–3. Listed here so they're tracked, not forgotten:

- Final application name (placeholder in centralized config).
- School logo file and color palette.
- Google Drive folder URL(s) — existing ~1,500-photo folder, and the new-upload target.
- Google Sheet (or confirmation the app should create one).
- Which AI provider(s) you hold API/billing access to — needed before Phase 5 and Phase 7.
- Supabase project credentials — needed before Phase 4.

## Known bugs

None — no application code exists yet.

## Environment variables

None required yet. Anticipated (informational only): `STAFF_PASSWORD_HASH`,
`ADMIN_PASSWORD_HASH`, `SESSION_SECRET`, `DATABASE_URL`, `MOCK_AI`, `MOCK_GOOGLE` — introduced
starting Phase 1.

## Migrations

None created yet. First migrations land in Phase 4, generated by `drizzle-kit` from the
schema in `docs/DATA_MODEL.md` (23 tables).

## External services

| Service | Status |
|---|---|
| Supabase / Postgres | Not connected — planned Phase 4 |
| Google Drive | Not connected — planned Phase 6 |
| Google Sheets | Not connected — planned Phase 9 |
| AI provider (vision/LLM) | Not connected — planned Phase 7 (mocked before then) |
| Embeddings provider | Not connected — planned Phase 5 (mocked before then) |
| Google Books / Open Library | Not connected — planned Phase 7 |

Everything above runs against mocks (`MOCK_AI=true`, `MOCK_GOOGLE=true`) for Phases 1–3.

## Git status

- Local repository, no remote, nothing pushed. One commit so far (Phase 0 round 1); this
  revision's documentation changes are staged for a second commit once you confirm you'd
  like it committed (or will be included in whatever commit you next request).
- No application code, no dependencies, no build artifacts.

## Next recommended task

Await your review of this revised Phase 0 architecture. Once approved, **Phase 1 —
Foundation + Design System + Access** proceeds exactly as previously scoped: Next.js/
TypeScript/Tailwind/Drizzle scaffold, Poppins, centralized brand-token system with neutral
placeholders, Welcome screen + staff password + secure session (per the now-fully-specified
mechanism in `docs/ARCHITECTURE.md` §14), Home screen, admin-unlock framework — all with mock
data, no real external services connected.

Do not begin Phase 1 without explicit approval.
