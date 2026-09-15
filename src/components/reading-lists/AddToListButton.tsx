"use client";

import { useEffect, useState } from "react";
import { AddToReadingListDialog } from "./AddToReadingListDialog";
import { cn } from "@/lib/utils/cn";

interface AddToListButtonProps {
  bookId: string;
  bookTitle: string;
  /** Search Results uses the quiet, icon-plus-label form; Book Detail uses the
   * clearer secondary-button form (product brief §16) — same component, one prop. */
  variant?: "quiet" | "button";
  className?: string;
}

const CONFIRMATION_VISIBLE_MS = 4000;

/** Owns the trigger, the dialog, and the brief post-close confirmation message —
 * kept together so every call site (`BookResultRow`, Book Detail) stays a one-line
 * usage. On a result row, this sits inside the row's own `relative`-positioned
 * content (which paints above the row's stretched Book-Detail link), so clicking it
 * never triggers navigation — verified in tests/e2e/readingLists.spec.ts. */
export function AddToListButton({ bookId, bookTitle, variant = "quiet", className }: AddToListButtonProps) {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(null), CONFIRMATION_VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [message]);

  const trigger =
    variant === "quiet" ? (
      <button
        type="button"
        aria-label={`Add "${bookTitle}" to a reading list`}
        className="relative flex min-h-11 items-center gap-1.5 rounded-md px-2 text-sm text-text-secondary hover:bg-surface-subtle hover:text-text-primary"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M4 2.5h8v11l-4-2.5-4 2.5v-11Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
          <path d="M6.5 6h3M8 4.5v3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
        Add to list
      </button>
    ) : (
      <button
        type="button"
        aria-label="Add to Reading List"
        className="relative inline-flex h-11 items-center gap-1.5 rounded-md border border-border bg-surface px-4 text-sm font-medium text-text-primary hover:bg-surface-subtle"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M4 2.5h8v11l-4-2.5-4 2.5v-11Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
          <path d="M6.5 6h3M8 4.5v3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
        Add to Reading List
      </button>
    );

  return (
    <span className={cn("relative inline-flex", className)}>
      <AddToReadingListDialog bookId={bookId} bookTitle={bookTitle} trigger={trigger} onAdded={setMessage} />
      <span aria-live="polite" role="status" className="sr-only">
        {message}
      </span>
      {message && (
        <span
          aria-hidden="true"
          className="absolute left-1/2 top-full z-10 mt-1 -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-surface px-2.5 py-1 text-xs text-text-primary shadow-sm"
        >
          {message}
        </span>
      )}
    </span>
  );
}
