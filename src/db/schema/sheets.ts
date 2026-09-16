import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sheetSyncStatusEnum } from "./enums";
import { books } from "./books";

/** Per-book Google Sheets sync state (docs/DATA_MODEL.md §11) — one row per book that
 * has ever been projected into the teacher-facing sheet. No Google Sheets integration
 * runs in Phase 4; this is persistence only, so nothing writes here yet. */
export const bookSheetSync = pgTable("book_sheet_sync", {
  id: uuid("id").primaryKey().defaultRandom(),
  bookId: uuid("book_id")
    .notNull()
    .unique()
    .references(() => books.id, { onDelete: "cascade" }),
  sheetRowNumber: integer("sheet_row_number"),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  lastSyncedContentHash: text("last_synced_content_hash"),
  syncStatus: sheetSyncStatusEnum("sync_status").notNull().default("pending"),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
