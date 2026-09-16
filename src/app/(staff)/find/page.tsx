import { bookRepository, categoryRepository } from "@/db/repositories";
import { buildFacets } from "@/lib/search/facets";
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
 * (docs/SEARCH.md). As of Phase 4, the catalog itself comes from
 * `bookRepository.listBooks()` (Postgres), not `fixtures.ts` — this is the interim
 * `Postgres → Book[] → existing searchBooks()` architecture the Phase 4 brief
 * explicitly accepts for this catalog size (docs/DECISIONS.md); Phase 5 moves
 * filtering/ranking into the database itself without changing this page's shape.
 * SearchInput/FilterDialog/CategoryQuickPills are the only client components, and now
 * receive the catalog/facets/category labels as plain serializable props rather than
 * importing the catalog themselves (Phase 4 brief §31) — no browser-side database
 * access anywhere.
 */
export default async function FindPage({ searchParams }: FindPageProps) {
  const resolvedParams = await searchParams;
  const { query, filters } = parseSearchParams(resolvedParams);
  const hasIntent = query.trim().length > 0 || hasActiveFilters(filters);

  const [books, categories] = await Promise.all([bookRepository.listBooks(), categoryRepository.listCategories()]);
  const categoryLabelBySlug = Object.fromEntries(categories.map((c) => [c.slug, c.label]));
  const facets = buildFacets(books, categories);

  const results = hasIntent
    ? searchBooks({ books, query, filters, categoryLabelBySlug: new Map(Object.entries(categoryLabelBySlug)) })
    : [];
  const findUrl = buildFindHref(query, filters);

  return (
    <div className="flex flex-1 flex-col gap-6 sm:gap-8">
      <h1 className="sr-only">Find a Book</h1>

      {/* Search controls as one visually distinct group, set apart from the results
          below by the gap-6/8 on the outer column — an editorial-feeling separation
          rather than a uniform, settings-panel-like stack of equal gaps. */}
      <div className="flex flex-col gap-3 sm:gap-4">
        <SearchInput initialQuery={query} filters={filters} books={books} categoryLabelBySlug={categoryLabelBySlug} />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <CategoryQuickPills query={query} filters={filters} categories={facets.categories} />
          <FilterDialog query={query} filters={filters} facets={facets} />
        </div>

        <ActiveFilters query={query} filters={filters} categoryLabelBySlug={categoryLabelBySlug} />
      </div>

      {!hasIntent && <InitialFindState />}
      {hasIntent && results.length === 0 && <NoResultsState query={query} filters={filters} />}
      {hasIntent && results.length > 0 && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <span aria-hidden="true" className="h-3 w-1 rounded-full bg-accent" />
            <h2 className="text-sm font-semibold uppercase tracking-wide text-text-muted">Top matches</h2>
          </div>
          <ResultsList results={results} findUrl={findUrl} categoryLabelBySlug={categoryLabelBySlug} />
        </div>
      )}

      <p className="border-t border-border pt-4 text-xs text-text-muted">
        This is a development catalog for testing search and browsing — not the school&rsquo;s confirmed inventory yet.
      </p>
    </div>
  );
}
