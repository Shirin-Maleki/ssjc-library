import { pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { books } from "./books";

/**
 * Shared, accountless reading lists (docs/DATA_MODEL.md §9) — the Phase 4 canonical
 * store, replacing Phase 3's `localStorage`-only persistence (see
 * docs/DECISIONS.md, "Reading Lists: from localStorage to Postgres"). There are no
 * individual staff accounts; `created_by` stays free text, displayed as "Anonymous"
 * when blank — never a foreign key to a user table that doesn't exist.
 */
export const readingLists = pgTable("reading_lists", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** List ↔ book. The composite primary key `(list_id, book_id)` is what makes adding
 * the same book to the same list twice idempotent at the database level — an insert
 * with `onConflictDoNothing()` is a no-op, never a duplicate row. */
export const readingListItems = pgTable(
  "reading_list_items",
  {
    listId: uuid("list_id")
      .notNull()
      .references(() => readingLists.id, { onDelete: "cascade" }),
    bookId: uuid("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
    note: text("note"),
  },
  (table) => [primaryKey({ columns: [table.listId, table.bookId] })]
);
