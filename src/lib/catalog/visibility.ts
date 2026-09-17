/**
 * Catalog visibility (Phase 5, `docs/DATA_MODEL.md` §2 `review_status`) — teacher
 * Find, autocomplete, facets, and embedding generation/backfill all scope to this one
 * status; `pending_review` and `archived` books exist in the database but are never
 * surfaced there. `BookRepository.getBookById()` (Book Detail) deliberately does
 * NOT apply this — an already-known link (e.g. from a Reading List added before a
 * book was archived) must keep resolving, per the approved Phase 4/5 invariant that
 * Reading Lists are never behaviorally changed.
 */
export const TEACHER_VISIBLE_REVIEW_STATUS = "active" as const;
