"use client";

import Link from "next/link";
import { useReadingLists } from "./ReadingListsProvider";
import { CreateReadingListDialog } from "./CreateReadingListDialog";
import { formatBookCount, formatCreatedBy, formatListDate } from "@/lib/reading-lists/format";
import { Button } from "@/components/ui/Button";

/** The real `/lists` destination (product brief §12) — a calm editorial list, not a
 * dashboard. `ready` gates every render so a real list never flashes an empty state
 * before the initial localStorage read completes (§11). */
export function ReadingListsOverview() {
  const { lists, ready } = useReadingLists();

  return (
    <div className="flex flex-1 flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold text-text-primary sm:text-3xl">Reading Lists</h1>
          <p className="max-w-md text-sm text-text-secondary">
            Shared lists any staff member can build — for a classroom, a topic, a season, or a week.
          </p>
        </div>
        {ready && lists.length > 0 && (
          <CreateReadingListDialog trigger={<Button variant="primary" size="md">New list</Button>} />
        )}
      </div>

      <p className="border-b border-border pb-4 text-xs text-text-muted">
        Reading Lists are designed for staff to share. In this prototype, lists are saved only in this browser.
      </p>

      {!ready && <p className="py-8 text-sm text-text-muted">Loading your reading lists…</p>}

      {ready && lists.length === 0 && (
        <div className="flex flex-col items-start gap-3 py-10">
          <p className="text-base font-medium text-text-primary">No reading lists yet</p>
          <p className="max-w-sm text-sm text-text-secondary">Create a list for a classroom, topic, season, or week.</p>
          <CreateReadingListDialog
            trigger={
              <Button variant="primary" size="md">
                Create a Reading List
              </Button>
            }
          />
        </div>
      )}

      {ready && lists.length > 0 && (
        <ul className="flex flex-col divide-y divide-border border-t border-border">
          {lists.map((list) => (
            <li key={list.id}>
              <Link
                href={`/lists/${list.id}`}
                className="flex min-h-11 flex-col gap-1 py-4 hover:bg-surface-subtle sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-base font-medium text-text-primary">{list.name}</span>
                  <span className="text-sm text-text-secondary">{formatCreatedBy(list.createdBy)}</span>
                </div>
                <div className="flex shrink-0 items-center gap-3 text-sm text-text-muted">
                  <span>{formatBookCount(list.items.length)}</span>
                  <span aria-hidden="true">·</span>
                  <time dateTime={list.createdAt}>{formatListDate(list.createdAt)}</time>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
