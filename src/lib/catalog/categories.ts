/**
 * PROVISIONAL development physical taxonomy — NOT the school's final shelving system.
 * Phase 0/8 will design the real, admin-managed physical_categories table; this exists
 * only to validate the Find UX (one category per book, visually distinct from tags).
 * See docs/PRODUCT_SPEC.md for why the legacy taxonomy's subject/genre/format mixing
 * is deliberately not reproduced here.
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

const byId = new Map(PHYSICAL_CATEGORIES.map((c) => [c.id, c]));

export function getCategoryLabel(id: string): string {
  return byId.get(id)?.label ?? id;
}
