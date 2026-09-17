import { createSearchService } from "@/db/repositories";
import { hasActiveFilters } from "@/lib/search/filters";
import { buildFindHref, parseSearchParams } from "@/lib/search/urlParams";
import { ActiveFilters } from "@/components/find/ActiveFilters";
import { CategoryQuickPills } from "@/components/find/CategoryQuickPills";
import { FilterDialog } from "@/components/find/FilterDialog";
import { InitialFindState } from "@/components/find/InitialFindState";
import { NoResultsState } from "@/components/find/NoResultsState";
import { ResultsList } from "@/components/find/ResultsList";
import { SearchInput } from "@/components/find/SearchInput";

interface FindPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * A Server Component reading `searchParams` directly — search state lives in the URL
 * (docs/SEARCH.md). As of Phase 5, this page calls `SearchService` — a real, bounded
 * database query pipeline (hard filters, full-text/fuzzy/optional-semantic retrieval,
 * hybrid scoring, pagination, facets) — instead of loading the whole catalog and
 * filtering/ranking it in memory (the Phase 4 interim architecture). SearchInput/
 * FilterDialog/CategoryQuickPills receive only the small, bounded data they actually
 * need as plain serializable props — no browser-side database access, and (Phase 5)
 * no full catalog shipped to the browser for autocomplete either.
 */
export default async function FindPage({ searchParams }: FindPageProps) {
  const resolvedParams = await searchParams;
  const { query, filters, limit } = parseSearchParams(resolvedParams);
  const hasIntent = query.trim().length > 0 || hasActiveFilters(filters);

  // The truly-empty initial state (no query, no filters) must not fetch/project any
  // candidate books at all — only the Filters dialog's facet data is needed before
  // a teacher has expressed any intent (docs/SEARCH.md §1).
  const searchService = await createSearchService();
  const page = hasIntent
    ? await searchService.search({ query, filters, limit })
    : { results: [], totalQualifying: 0, hasMore: false, facets: await searchService.getFacets() };

  const categoryLabelBySlug = Object.fromEntries(page.facets.categories.map((c) => [c.value, c.label]));
  const findUrl = buildFindHref(query, filters);

  return (
    <div className="flex flex-1 flex-col gap-6 sm:gap-8">
      <h1 className="sr-only">Find a Book</h1>

      {/* Search controls as one visually distinct group, set apart from the results
          below by the gap-6/8 on the outer column — an editorial-feeling separation
          rather than a uniform, settings-panel-like stack of equal gaps. */}
      <div className="flex flex-col gap-3 sm:gap-4">
        <SearchInput initialQuery={query} filters={filters} />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <CategoryQuickPills query={query} filters={filters} categories={page.facets.categories} />
          <FilterDialog query={query} filters={filters} facets={page.facets} />
        </div>

        <ActiveFilters query={query} filters={filters} categoryLabelBySlug={categoryLabelBySlug} />
      </div>

      {!hasIntent && <InitialFindState />}
      {hasIntent && page.results.length === 0 && <NoResultsState query={query} filters={filters} />}
      {hasIntent && page.results.length > 0 && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <span aria-hidden="true" className="h-3 w-1 rounded-full bg-accent" />
            <h2 className="text-sm font-semibold uppercase tracking-wide text-text-muted">Top matches</h2>
          </div>
          <ResultsList
            results={page.results}
            totalQualifying={page.totalQualifying}
            hasMore={page.hasMore}
            query={query}
            filters={filters}
            limit={limit}
            findUrl={findUrl}
            categoryLabelBySlug={categoryLabelBySlug}
          />
        </div>
      )}

      <p className="border-t border-border pt-4 text-xs text-text-muted">
        This is a development catalog for testing search and browsing — not the school&rsquo;s confirmed inventory yet.
      </p>
    </div>
  );
}
