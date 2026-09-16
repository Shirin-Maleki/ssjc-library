"use client";

import Link from "next/link";
import type { FacetOption } from "@/lib/search/facets";
import type { Filters } from "@/lib/search/filters";
import { buildFindHref } from "@/lib/search/urlParams";
import { cn } from "@/lib/utils/cn";

interface CategoryQuickPillsProps {
  query: string;
  filters: Filters;
  /** Precomputed server-side (Phase 4 brief §31) — this component never imports the
   * catalog or computes facets itself. */
  categories: FacetOption[];
}

/**
 * Quick, one-click category access directly on the page — the brief calls out
 * Category as one of the "frequently useful" filters worth surfacing ahead of the
 * full Filters dialog, and explicitly allows "restrained category/theme shortcuts"
 * on the browse state. Plain links (not buttons + router.push), so each toggle is a
 * real, shareable URL and works without JavaScript.
 */
export function CategoryQuickPills({ query, filters, categories }: CategoryQuickPillsProps) {
  const selected = filters.categories ?? [];

  return (
    <div
      className="scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0"
      role="group"
      aria-label="Quick category filters"
    >
      {categories.map((category) => {
        const isSelected = selected.includes(category.value);
        const nextCategories = isSelected
          ? selected.filter((c) => c !== category.value)
          : [...selected, category.value];
        const href = buildFindHref(query, { ...filters, categories: nextCategories });

        return (
          <Link
            key={category.value}
            href={href}
            aria-pressed={isSelected}
            className={cn(
              "inline-flex min-h-11 shrink-0 items-center rounded-full border px-3.5 text-sm transition-colors",
              isSelected
                ? "border-accent bg-accent/20 text-text-primary"
                : "border-border bg-surface text-text-secondary hover:bg-surface-subtle"
            )}
          >
            {category.label}
          </Link>
        );
      })}
    </div>
  );
}
