import { index, pgTable, primaryKey, text, uuid } from "drizzle-orm/pg-core";
import { books } from "./books";

/** Additional languages for multilingual editions (docs/DATA_MODEL.md §3) —
 * `books.language_code` remains the primary/display value; a bilingual book also gets
 * a row here per additional language so it matches a filter on either one. No
 * `languages` reference table exists (deliberately removed in the Phase 0 review) —
 * both this column and `books.language_code` are validated at the application layer
 * against `src/lib/constants/languages.ts`, a centralized ISO 639-1 registry. */
export const bookLanguages = pgTable(
  "book_languages",
  {
    bookId: uuid("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    languageCode: text("language_code").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.bookId, table.languageCode] }),
    index("book_languages_language_idx").on(table.languageCode),
  ]
);
