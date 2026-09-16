import { boolean, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Database-managed physical shelving categories (docs/DATA_MODEL.md §12; Phase 4 brief
 * §15) — replaces `src/lib/catalog/categories.ts`'s hard-coded array as the canonical
 * source. `slug` is the stable, URL-facing identifier already used throughout the app
 * (`/find?category=animals-nature`) — kept distinct from the
 * real UUID `id` so existing links/tests referencing category slugs keep working
 * unchanged; `id` is what `books.physical_category_id` actually references.
 *
 * The seeded rows are the same 8 provisional development categories Phase 2 used —
 * explicitly labeled as development taxonomy, not the school's confirmed shelving
 * system, exactly as before (see the seed script and `docs/DATA_MODEL.md`).
 */
export const physicalCategories = pgTable("physical_categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  label: text("label").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
