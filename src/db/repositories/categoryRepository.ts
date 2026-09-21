import { eq } from "drizzle-orm";
import type { Database } from "../client";
import { physicalCategories } from "../schema";

export interface PhysicalCategoryOption {
  slug: string;
  label: string;
}

/**
 * The database-managed physical category list (Phase 4 brief §15) — replaces
 * `src/lib/catalog/categories.ts`'s hard-coded array as the production source.
 * `slug` is the stable value used throughout the app's URLs/props
 * (`/find?category=animals-nature`); `label` is the only thing that ever needed a
 * lookup, so this is intentionally the whole surface — no separate "get one label"
 * method, callers build their own `Map<slug, label>` from this list.
 */
export class DrizzleCategoryRepository {
  constructor(private readonly db: Database) {}

  async listCategories(): Promise<PhysicalCategoryOption[]> {
    const rows = await this.db.select({ slug: physicalCategories.slug, label: physicalCategories.label }).from(physicalCategories);
    return rows;
  }

  /**
   * Active-only categories (Phase 7, §28 of the phase brief) — the exact, current
   * set Gemini's category suggestion (`src/lib/intake/categorySuggestion.ts`) and a
   * teacher's Quick Edit category selector may choose from. Never a stale/hard-coded
   * list: an inactive/retired category must never be offered by the live intake
   * path, even though `listCategories()` above still returns it for callers that
   * legitimately need every category regardless of status (e.g. a book already
   * assigned one that was later deactivated).
   */
  async listActiveCategories(): Promise<PhysicalCategoryOption[]> {
    const rows = await this.db
      .select({ slug: physicalCategories.slug, label: physicalCategories.label })
      .from(physicalCategories)
      .where(eq(physicalCategories.isActive, true));
    return rows;
  }
}
