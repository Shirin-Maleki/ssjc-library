import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/** Normalized publisher names (docs/DATA_MODEL.md §12) — kept as a real table rather
 * than a free-text column specifically so autocomplete/filter data stays de-duplicated
 * as the catalog grows; collapsing this back to a string was explicitly ruled out. */
export const publishers = pgTable("publishers", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  normalizedName: text("normalized_name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
