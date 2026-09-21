import type { PhysicalCategoryOption } from "@/db/repositories/categoryRepository";
import type { EnrichmentSuggestion } from "@/lib/ai";

/**
 * The real enforcement behind "Gemini may NOT invent a category" (Phase 7, §28 of
 * the phase brief) — application code, never trust in the model alone. Gemini is
 * *told* the exact active category list in its prompt
 * (`src/lib/ai/geminiProvider.ts`), but a determined or confused model could still
 * return a slug outside that list (or a slug that was active when the prompt was
 * built but has since changed) — this function is the actual boundary that decides
 * whether a suggested category is ever surfaced to a teacher or persisted.
 */
export interface ValidatedCategorySuggestion {
  slug: string;
  label: string;
  confidence: "high" | "medium" | "low" | null;
  reason: string | null;
}

/** Returns `undefined` — never a fabricated fallback category — when Gemini
 * suggested no category, or suggested one that isn't (or is no longer) in the real
 * active list (§28: "If no category can reasonably be confirmed, Review Later is
 * preferable to inventing one"). */
export function validateCategorySuggestion(
  suggestion: Pick<EnrichmentSuggestion, "physicalCategorySlug" | "categoryConfidence" | "categoryReason">,
  activeCategories: PhysicalCategoryOption[]
): ValidatedCategorySuggestion | undefined {
  if (!suggestion.physicalCategorySlug) return undefined;
  const match = activeCategories.find((category) => category.slug === suggestion.physicalCategorySlug);
  if (!match) return undefined;
  return {
    slug: match.slug,
    label: match.label,
    confidence: suggestion.categoryConfidence,
    reason: suggestion.categoryReason,
  };
}
