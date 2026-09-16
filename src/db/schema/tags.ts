import { index, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tagFamilyEnum } from "./enums";
import { books } from "./books";

/** Normalized, typed digital tags (docs/DATA_MODEL.md §12/§14) — the "unlimited digital
 * tags" half of the physical-simplicity/digital-richness principle. `normalizedName` is
 * unique so the same topic never accumulates near-duplicate rows ("animals" vs.
 * "Animals" vs. "animal"). `family` is a small, stable classification (topic/theme/
 * social-emotional/curriculum/concept/visual-subject/seasonal/featured) — a real enum,
 * unlike the open-ended tag names themselves. */
export const tags = pgTable(
  "tags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull().unique(),
    family: tagFamilyEnum("family"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("tags_family_idx").on(table.family)]
);

export const bookTags = pgTable(
  "book_tags",
  {
    bookId: uuid("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.bookId, table.tagId] }), index("book_tags_tag_idx").on(table.tagId)]
);
