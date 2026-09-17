import { sql } from "drizzle-orm";
import { index, pgTable, primaryKey, smallint, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { contributorRoleEnum } from "./enums";
import { books } from "./books";

/** Normalized people — authors, illustrators, photographers, translators
 * (docs/DATA_MODEL.md §12). Never store a comma-separated contributor string as
 * canonical data; `BookRepository` projects these back into the UI-friendly
 * `authors: string[]` / `illustrators: string[]` arrays the existing Find/search code
 * already expects. */
export const contributors = pgTable(
  "contributors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("contributors_normalized_name_idx").on(table.normalizedName),
    // Phase 5 — trigram fuzzy matching (searchRepository.ts) compares a query
    // directly against contributor names for typo tolerance (e.g. "Eric Carl" for
    // "Eric Carle"); found missing during EXPLAIN ANALYZE testing at ~2,500-row
    // scale alongside the equivalent `books.title` index — see docs/SEARCH.md §3.
    index("contributors_name_trgm_idx").using("gin", sql`${table.name} gin_trgm_ops`),
  ]
);

/** Book ↔ contributor, with role. `sortOrder` preserves the existing multi-author
 * display order (`book.authors.join(", ")`) — the same person can legitimately hold
 * more than one role on the same book (e.g. author *and* illustrator), so role is
 * part of the composite key rather than a plain (book, contributor) pair. */
export const bookContributors = pgTable(
  "book_contributors",
  {
    bookId: uuid("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    contributorId: uuid("contributor_id")
      .notNull()
      .references(() => contributors.id, { onDelete: "cascade" }),
    role: contributorRoleEnum("role").notNull(),
    sortOrder: smallint("sort_order").notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.bookId, table.contributorId, table.role] }),
    index("book_contributors_contributor_idx").on(table.contributorId),
  ]
);
