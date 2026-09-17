"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { SearchResultRow } from "@/lib/search/searchService";
import type { Filters } from "@/lib/search/filters";
import { buildFindHref, RESULT_LIMIT_STEP } from "@/lib/search/urlParams";
import { Button } from "@/components/ui/Button";
import { BookResultRow } from "./BookResultRow";

interface ResultsListProps {
  results: SearchResultRow[];
  /** How many results satisfy the current search in total (Phase 5: the server's
   * count over its bounded candidate set, never the whole catalog — see
   * `docs/SEARCH.md` §7) — used only for the "N matches" line, never to size a
   * client-side array the server didn't actually send. */
  totalQualifying: number;
  /** Whether a larger `limit` would surface more real results — the server's own
   * answer, not a client-side "are there more items left in the array I already
   * have" check (Phase 5 correction: the previous version sliced an already-fully-
   * fetched array; this version re-searches with a bigger bound). */
  hasMore: boolean;
  query: string;
  filters: Filters;
  limit: number;
  findUrl: string;
  categoryLabelBySlug: Record<string, string>;
}

export function ResultsList({ results, totalQualifying, hasMore, query, filters, limit, findUrl, categoryLabelBySlug }: ResultsListProps) {
  const router = useRouter();
  const [loadingMore, setLoadingMore] = useState(false);

  function handleShowMore() {
    setLoadingMore(true);
    router.push(buildFindHref(query, filters, limit + RESULT_LIMIT_STEP));
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-text-secondary" aria-live="polite">
        {totalQualifying === 1 ? "1 match" : `${totalQualifying} matches`}
      </p>
      <ul className="flex flex-col">
        {results.map((result) => (
          <BookResultRow
            key={result.book.id}
            result={result}
            findUrl={findUrl}
            categoryLabel={categoryLabelBySlug[result.book.physicalCategory] ?? result.book.physicalCategory}
          />
        ))}
      </ul>
      {hasMore && (
        <div className="flex justify-center pt-2">
          <Button variant="secondary" onClick={handleShowMore} disabled={loadingMore}>
            {loadingMore ? "Loading…" : `Show more (${totalQualifying - results.length} more)`}
          </Button>
        </div>
      )}
    </div>
  );
}
