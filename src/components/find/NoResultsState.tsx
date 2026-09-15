import Link from "next/link";
import { hasActiveFilters, type Filters } from "@/lib/search/filters";
import { buildFindHref } from "@/lib/search/urlParams";

/** A query/filter combination produced nothing meaningful — distinct from
 * InitialFindState. Offers real recovery actions rather than padding the page with
 * unrelated books. */
export function NoResultsState({ query, filters }: { query: string; filters: Filters }) {
  const filtersActive = hasActiveFilters(filters);

  return (
    <div className="flex flex-col items-center gap-3 py-12 text-center">
      <p className="text-base font-medium text-text-primary">No matches in the development catalog yet.</p>
      <p className="max-w-sm text-sm text-text-secondary">
        Try a different search, or {filtersActive ? "remove some of the active filters" : "browse by category above"}.
      </p>
      {filtersActive && (
        <Link
          href={buildFindHref(query, {})}
          className="text-sm font-medium text-brand-primary underline underline-offset-4 hover:text-brand-secondary"
        >
          Clear all filters
        </Link>
      )}
    </div>
  );
}
