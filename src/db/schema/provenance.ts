import { boolean, index, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { confidenceLevelEnum, provenanceSourceTypeEnum } from "./enums";
import { books } from "./books";

/**
 * Per-field provenance/confidence, with full history (docs/DATA_MODEL.md §6). Each new
 * determination is a NEW row (append-only) rather than an overwrite — a partial unique
 * index guarantees exactly one `is_current` row per `(book_id, field_key)` for fast
 * lookups, while every prior determination stays queryable.
 *
 * `field_key` is deliberately plain `text`, validated only by a centralized
 * application-level registry (`src/lib/metadata/field-registry.ts`, Phase 7+) — NOT a
 * database enum, since the tracked-field vocabulary is expected to grow as the product
 * does (Phase 4 brief §26/§19). `source_type` (the *kind* of evidence) is a real enum,
 * since that classification is small and stable.
 */
export const bookFieldProvenance = pgTable(
  "book_field_provenance",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookId: uuid("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    fieldKey: text("field_key").notNull(),
    sourceType: provenanceSourceTypeEnum("source_type").notNull(),
    sourceLabel: text("source_label"),
    confidence: numeric("confidence", { precision: 3, scale: 2 }),
    confidenceLevel: confidenceLevelEnum("confidence_level"),
    notes: text("notes"),
    isCurrent: boolean("is_current").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("book_field_provenance_current_unique")
      .on(table.bookId, table.fieldKey)
      .where(sql`${table.isCurrent} = true`),
    index("book_field_provenance_book_idx").on(table.bookId),
  ]
);
