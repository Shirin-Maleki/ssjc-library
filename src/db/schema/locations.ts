import { boolean, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { libraryLocationTypeEnum } from "./enums";

/**
 * Physical-copy locations (Phase 9 addendum — physical copy locations + move/
 * return workflow) — where a physical `book_copy` (see `ingestion.ts`) currently
 * sits: a corridor, a classroom, or some other named space. Deliberately its own
 * table with a stable `id`/`slug`, never free-form text on `book_copies` directly
 * (a classroom renamed from "Blue Room" to "Ladybird Room" must not silently
 * orphan every copy already recorded there) and never a column on the
 * bibliographic `books` table (location belongs to the physical copy, not the
 * edition — a book can have copies in several places at once).
 *
 * Mirrors `physical_categories`' own established shape/conventions (`slug` as the
 * stable identifier, `label`-equivalent `display_name`, `is_active` gating future
 * assignment without deleting history) — see `categories.ts`'s own doc comment.
 */
export const libraryLocations = pgTable("library_locations", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  displayName: text("display_name").notNull(),
  locationType: libraryLocationTypeEnum("location_type").notNull().default("other"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
