"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/Button";

interface CatalogErrorFallbackProps {
  /** Next.js passes the thrown error here (with an optional `digest` for server-side
   * log correlation) — deliberately never rendered: a raw SQL/connection/driver error
   * must never reach a teacher's screen (Phase 4 correction pass). Logged to the
   * console only so a real failure is still discoverable during development/support. */
  error: Error & { digest?: string };
  /** Next.js's own recovery affordance — re-renders the segment, retrying whatever
   * server-side data fetch just failed. */
  reset: () => void;
}

/**
 * The calm, generic failure state for a catalog page whose server-side data fetch
 * (a real Postgres query, as of Phase 4) throws — distinct from a legitimate "no
 * results" state, which is never an error. Reused by `find/error.tsx` and
 * `books/[id]/error.tsx` so both catalog pages fail the same way; Reading Lists has
 * its own equivalent handled separately (`ReadingListsProvider`'s `loadError`, a
 * client-side fetch failure rather than a server-render error boundary).
 */
export function CatalogErrorFallback({ error, reset }: CatalogErrorFallbackProps) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex flex-1 flex-col items-start justify-center gap-4 py-16">
      <h1 className="text-2xl font-semibold text-text-primary">
        Library information couldn&rsquo;t be loaded right now
      </h1>
      <p className="max-w-md text-text-secondary">Please try again.</p>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
