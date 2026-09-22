import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { reviewFlagStatusEnum, reviewFlagTypeEnum, taxonomySuggestionStatusEnum } from "./enums";
import { books } from "./books";
import { physicalCategories } from "./categories";

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
  /**
   * The category this suggestion resolved into (Phase 8) — set when an admin
   * approves the suggestion (a brand-new category, created by that same admin
   * action) or merges it into an existing one; left null for `pending`, `rejected`,
   * or `postponed`. A small nullable FK rather than relying on `decisionNote` prose
   * to carry this relational fact, per the same "don't stuff important relational
   * state only into text" principle `pendingBookId` above follows. Never implies the
   * category itself was AI-created — the admin action that sets this is always the
   * one that also creates/chooses the category; AI only ever proposed the concept.
   */
  resolvedCategoryId: uuid("resolved_category_id").references(() => physicalCategories.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  reviewedBy: text("reviewed_by"),
});
