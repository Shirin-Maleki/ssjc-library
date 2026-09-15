import { books } from "@/lib/catalog/fixtures";
import { hasActiveFilters } from "@/lib/search/filters";
import { searchBooks } from "@/lib/search/searchBooks";
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
 * (docs/SEARCH.md), so this page never needs client-side global state to know what to
 * render. SearchInput/FilterDialog/CategoryQuickPills are the only client components,
 * responsible only for navigating to a new URL, never for holding the "current
 * results" themselves.
 */
export default async function FindPage({ searchParams }: FindPageProps) {
  const resolvedParams = await searchParams;
  const { query, filters } = parseSearchParams(resolvedParams);
  const hasIntent = query.trim().length > 0 || hasActiveFilters(filters);
  const results = hasIntent ? searchBooks({ books, query, filters }) : [];
  const findUrl = buildFindHref(query, filters);

  return (
    <div className="flex flex-1 flex-col gap-6">
      <h1 className="sr-only">Find a Book</h1>

      <SearchInput initialQuery={query} filters={filters} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <CategoryQuickPills query={query} filters={filters} />
        <FilterDialog query={query} filters={filters} />
      </div>

      <ActiveFilters query={query} filters={filters} />

      {!hasIntent && <InitialFindState />}
      {hasIntent && results.length === 0 && <NoResultsState query={query} filters={filters} />}
      {hasIntent && results.length > 0 && (
        <div className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-text-muted">Top matches</h2>
          <ResultsList results={results} findUrl={findUrl} />
        </div>
      )}

      <p className="border-t border-border pt-4 text-xs text-text-muted">
        This is a development catalog for testing search and browsing — not the school&rsquo;s confirmed inventory yet.
      </p>
    </div>
  );
}
