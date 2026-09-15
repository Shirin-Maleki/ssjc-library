"use client";

import { useState } from "react";
import type { SearchResult } from "@/lib/search/searchBooks";
import { Button } from "@/components/ui/Button";
import { BookResultRow } from "./BookResultRow";

const INITIAL_VISIBLE = 5;
const SHOW_MORE_BATCH = 10;

export function ResultsList({ results, findUrl }: { results: SearchResult[]; findUrl: string }) {
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE);
  const visible = results.slice(0, visibleCount);
  const remaining = results.length - visible.length;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-text-secondary" aria-live="polite">
        {results.length === 1 ? "1 match" : `${results.length} matches`}
      </p>
      <ul className="flex flex-col">
        {visible.map((result) => (
          <BookResultRow key={result.book.id} result={result} findUrl={findUrl} />
        ))}
      </ul>
      {remaining > 0 && (
        <div className="flex justify-center pt-2">
          <Button variant="secondary" onClick={() => setVisibleCount((c) => c + SHOW_MORE_BATCH)}>
            Show more ({remaining} more)
          </Button>
        </div>
      )}
    </div>
  );
}
