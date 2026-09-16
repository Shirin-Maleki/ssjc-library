import { index, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { duplicateDetectedByEnum, duplicateRelationshipTypeEnum, duplicateStatusEnum } from "./enums";
import { books } from "./books";

/** Candidate duplicate relationships between two book (edition) rows
 * (docs/DATA_MODEL.md §7) — never an automatic merge; a human resolves each candidate
 * explicitly into one of the approved outcomes (`relationship_type`). No duplicate
 * detector runs in Phase 4; this is schema support only. */
export const bookDuplicates = pgTable(
  "book_duplicates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookIdA: uuid("book_id_a")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    bookIdB: uuid("book_id_b")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    relationshipType: duplicateRelationshipTypeEnum("relationship_type").notNull().default("unresolved"),
    similarityScore: numeric("similarity_score", { precision: 3, scale: 2 }),
    detectedBy: duplicateDetectedByEnum("detected_by").notNull(),
    status: duplicateStatusEnum("status").notNull().default("pending"),
    resolvedBy: text("resolved_by"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("book_duplicates_book_a_idx").on(table.bookIdA), index("book_duplicates_book_b_idx").on(table.bookIdB)]
);
