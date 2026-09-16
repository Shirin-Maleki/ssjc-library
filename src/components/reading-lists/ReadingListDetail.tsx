"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useReadingLists } from "./ReadingListsProvider";
import { RenameReadingListDialog } from "./RenameReadingListDialog";
import { DeleteReadingListDialog } from "./DeleteReadingListDialog";
import { formatBookCount, formatCreatedBy, formatListDate } from "@/lib/reading-lists/format";
import type { Book } from "@/lib/catalog/types";
import { formatAgeRange } from "@/lib/catalog/age";
import { BookCover } from "@/components/find/BookCover";
import { CategoryBadge } from "@/components/find/CategoryBadge";
import { Button } from "@/components/ui/Button";

interface ReadingListDetailProps {
  listId: string;
  /** The full catalog and category list, fetched server-side by the page wrapper
   * (`src/app/(staff)/lists/[id]/page.tsx`) via the same repositories Find uses — this
   * component still can't reach Postgres itself (it's a Client Component, needed for
   * the Rename/Delete dialogs and live list state), so its book/category data arrives
   * as plain serializable props instead (Phase 4 brief §31/§34). */
  catalog: Book[];
  categories: { slug: string; label: string }[];
}

/** The real `/lists/[id]` destination (product brief §18). Reading Lists themselves
 * are Postgres-backed as of Phase 4 (docs/DECISIONS.md) — `ready`/`getById` come from
 * `ReadingListsProvider`, which now talks to the database via an authenticated Server
 * Action, not `localStorage`. */
export function ReadingListDetail({ listId, catalog, categories }: ReadingListDetailProps) {
  const { ready, getById, removeBook } = useReadingLists();
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!statusMessage) return;
    const timer = window.setTimeout(() => setStatusMessage(null), 4000);
    return () => window.clearTimeout(timer);
  }, [statusMessage]);

  if (!ready) {
    return <p className="py-10 text-sm text-text-muted">Loading…</p>;
  }

  const list = getById(listId);

  if (!list) {
    return (
      <div className="flex flex-1 flex-col items-start justify-center gap-4 py-16">
        <h1 className="text-2xl font-semibold text-text-primary">List not found</h1>
        <p className="max-w-md text-text-secondary">
          This reading list doesn&rsquo;t exist — it may have been deleted, or the link is wrong.
        </p>
        <Link href="/lists" className="text-sm font-medium text-brand-primary underline underline-offset-4">
          Back to Reading Lists
        </Link>
      </div>
    );
  }

  const backHref = `/lists/${list.id}`;
  const catalogById = new Map(catalog.map((book) => [book.id, book]));
  const categoryLabelBySlug = new Map(categories.map((c) => [c.slug, c.label]));
  const books = list.items
    .map((item) => catalogById.get(item.bookId))
    .filter((book): book is Book => Boolean(book));

  async function handleRemove(book: Book) {
    try {
      await removeBook(list!.id, book.id);
      setStatusMessage(`Removed "${book.title}."`);
    } catch {
      setStatusMessage(`Something went wrong removing "${book.title}." Please try again.`);
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      <Link
        href="/lists"
        className="-ml-2 inline-flex min-h-11 w-fit items-center gap-1.5 px-2 text-sm font-medium text-text-secondary hover:text-text-primary"
      >
        <span aria-hidden="true">←</span> Back to Reading Lists
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold text-text-primary sm:text-3xl">{list.name}</h1>
          <p className="text-sm text-text-secondary">
            {formatCreatedBy(list.createdBy)} · {formatBookCount(list.items.length)} · created{" "}
            <time dateTime={list.createdAt}>{formatListDate(list.createdAt)}</time>
          </p>
        </div>
        <div className="flex items-center gap-1">
          <RenameReadingListDialog
            listId={list.id}
            currentName={list.name}
            trigger={
              <Button variant="secondary" size="md">
                Rename
              </Button>
            }
          />
          <DeleteReadingListDialog
            listId={list.id}
            listName={list.name}
            trigger={
              <button
                type="button"
                className="flex h-11 items-center rounded-md px-4 text-sm font-medium text-danger hover:bg-danger-bg"
              >
                Delete
              </button>
            }
          />
        </div>
      </div>

      <div aria-live="polite" role="status" className="sr-only">
        {statusMessage}
      </div>

      {books.length === 0 ? (
        <div className="flex flex-col items-start gap-3 py-10">
          <p className="text-base font-medium text-text-primary">This list is empty</p>
          <p className="max-w-sm text-sm text-text-secondary">Find a book and choose Add to list.</p>
          <Link href="/find" className="text-sm font-medium text-brand-primary underline underline-offset-4">
            Find a Book
          </Link>
        </div>
      ) : (
        <ul className="flex flex-col divide-y divide-border border-t border-border" aria-label={`Books in ${list.name}`}>
          {books.map((book) => (
            <li key={book.id} className="flex gap-4 py-4">
              <BookCover book={book} size="sm" />
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <div>
                  <h3 className="text-base font-semibold leading-snug text-text-primary">
                    <Link href={`/books/${book.id}?from=${encodeURIComponent(backHref)}`} className="hover:underline">
                      {book.title}
                    </Link>
                  </h3>
                  <p className="text-sm text-text-secondary">{book.authors.join(", ")}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <CategoryBadge categoryLabel={categoryLabelBySlug.get(book.physicalCategory) ?? book.physicalCategory} />
                  <span className="text-xs text-text-muted">{formatAgeRange(book.ageMinMonths, book.ageMaxMonths)}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleRemove(book)}
                aria-label={`Remove "${book.title}" from ${list.name}`}
                className="flex h-11 shrink-0 items-center gap-1.5 self-start rounded-md px-2 text-sm text-text-secondary hover:bg-surface-subtle hover:text-danger"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
