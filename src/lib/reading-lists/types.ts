/**
 * Phase 3 Reading Lists domain shape — deliberately close to the already-approved
 * future schema (`docs/DATA_MODEL.md` §9: `reading_lists` / `reading_list_items`) so
 * the Phase 4 real-database transition is a repository swap, not a redesign. Only
 * stable book IDs are stored here, never a copy of catalog fields — the fixture
 * catalog (Phase 5+: the real database) remains the sole source of truth for title/
 * author/cover metadata, per the product brief's "reading lists reference books, they
 * don't duplicate them" intent.
 */

export interface ReadingListItem {
  bookId: string;
  /** ISO 8601 timestamp. */
  addedAt: string;
}

export interface ReadingList {
  id: string;
  name: string;
  /** Free text, optional — no accounts exist (docs/DECISIONS.md, "no individual
   * teacher/admin accounts"). Blank/absent is displayed as "Anonymous"
   * (see `lib/reading-lists/format.ts`), never stored as the literal string. */
  createdBy?: string;
  /** ISO 8601 timestamps. */
  createdAt: string;
  updatedAt: string;
  items: ReadingListItem[];
}

export interface CreateReadingListInput {
  name: string;
  createdBy?: string;
}
