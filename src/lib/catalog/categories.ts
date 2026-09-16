/**
 * PROVISIONAL development physical taxonomy — NOT the school's final shelving system.
 *
 * As of Phase 4, this array is **seed source material only** (`src/db/seed.ts`) — the
 * canonical, production source of category data is the database-managed
 * `physical_categories` table (`src/db/repositories/categoryRepository.ts`), per
 * docs/DATA_MODEL.md §15 and the Phase 4 brief §15. No production application code
 * should import this constant; if you're reaching for `getCategoryLabel`, you want a
 * `categoryLabelBySlug` map built from `categoryRepository.listCategories()` instead
 * (see `src/app/(staff)/find/page.tsx` for the pattern).
 *
 * Phase 0/8 will design the real, admin-managed taxonomy-editing UI; this list exists
 * only to seed the Find UX's development data. See docs/PRODUCT_SPEC.md for why the
 * legacy taxonomy's subject/genre/format mixing is deliberately not reproduced here.
 */
export interface PhysicalCategory {
  id: string;
  label: string;
}

export const PHYSICAL_CATEGORIES: PhysicalCategory[] = [
  { id: "animals-nature", label: "Animals & Nature" },
  { id: "people-community", label: "People & Community" },
  { id: "feelings-relationships", label: "Feelings & Relationships" },
  { id: "stem-discovery", label: "STEM & Discovery" },
  { id: "arts-creativity", label: "Arts & Creativity" },
  { id: "world-cultures", label: "World & Cultures" },
  { id: "everyday-life-play", label: "Everyday Life & Play" },
  { id: "stories-imagination", label: "Stories & Imagination" },
];
