import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { reviewFlagStatusEnum, reviewFlagTypeEnum, taxonomySuggestionStatusEnum } from "./enums";
import { books } from "./books";

/** Open concerns requiring admin attention (docs/DATA_MODEL.md §8). The Admin Review
 * UI itself is not built in Phase 4 — this is persistence only. */
export const reviewFlags = pgTable(
  "review_flags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookId: uuid("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    flagType: reviewFlagTypeEnum("flag_type").notNull(),
    status: reviewFlagStatusEnum("status").notNull().default("open"),
    detail: text("detail"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedBy: text("resolved_by"),
    resolutionNote: text("resolution_note"),
  },
  (table) => [index("review_flags_book_idx").on(table.bookId), index("review_flags_status_idx").on(table.status)]
);

/** AI/admin-surfaced proposals for new/merged categories (docs/DATA_MODEL.md §8/§12) —
 * `supportingBookIds` is a plain array column (the separate evidence join table from
 * the first draft was removed as over-modeled for this low-volume admin feature). No
 * AI taxonomy analysis runs in Phase 4; this is persistence only. */
export const taxonomySuggestions = pgTable("taxonomy_suggestions", {
  id: uuid("id").primaryKey().defaultRandom(),
  suggestedName: text("suggested_name").notNull(),
  reason: text("reason").notNull(),
  supportingBookIds: uuid("supporting_book_ids")
    .array()
    .notNull()
    .default(sql`'{}'::uuid[]`),
  status: taxonomySuggestionStatusEnum("status").notNull().default("pending"),
  decisionNote: text("decision_note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  reviewedBy: text("reviewed_by"),
});
