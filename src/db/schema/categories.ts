import { boolean, pgTable, smallint, text, timestamp, uuid } from "drizzle-orm/pg-core";

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
 *
 * `description`/`displayOrder` added for Phase 8 admin category management
 * (docs/DATA_MODEL.md) — deliberately minimal, additive columns only.
 * `description` is optional admin-facing shelving guidance (e.g. "Board books and
 * picture books about the natural world"), never required, never shown to a
 * teacher as bibliographic fact. `displayOrder` is a plain sort hint for the admin
 * category list, defaulting to 0 (no stated order) — neither column changes `id`
 * or `slug` identity, and a label rename never touches either.
 */
export const physicalCategories = pgTable("physical_categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  label: text("label").notNull(),
  description: text("description"),
  displayOrder: smallint("display_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
