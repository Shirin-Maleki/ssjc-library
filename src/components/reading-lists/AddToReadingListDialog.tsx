"use client";

import { useId, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useReadingLists } from "./ReadingListsProvider";
import { formatCreatedBy, isBookInList } from "@/lib/reading-lists/format";
import type { ReadingList } from "@/lib/reading-lists/types";
import { Button } from "@/components/ui/Button";

interface AddToReadingListDialogProps {
  bookId: string;
  bookTitle: string;
  trigger: React.ReactNode;
  /** Called once, right after the dialog closes on success, with a short confirmation
   * message — the caller (`AddToListButton`) is responsible for displaying it, since
   * this dialog unmounts its own content and can't show a message after closing. */
  onAdded: (message: string) => void;
}

type Mode = "select" | "create";

/**
 * Reused from both Search Results and Book Detail (product brief §16/17) — existing
 * lists as tappable rows, with a "Create new list" step that reveals the same compact
 * form as the standalone `CreateReadingListDialog`, except it also adds the current
 * book to the list it just created.
 */
export function AddToReadingListDialog({ bookId, bookTitle, trigger, onAdded }: AddToReadingListDialogProps) {
  const { lists, ready, addBook, createListWithBook } = useReadingLists();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("select");
  const [name, setName] = useState("");
  const [createdBy, setCreatedBy] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameId = useId();
  const creatorId = useId();

  function handleOpenChange(next: boolean) {
    if (next) {
      setMode("select");
      setName("");
      setCreatedBy("");
      setError(null);
    }
    setOpen(next);
  }

  async function handleSelectList(list: ReadingList) {
    const alreadyThere = isBookInList(list, bookId);
    try {
      await addBook(list.id, bookId);
      setOpen(false);
      onAdded(alreadyThere ? `Already in "${list.name}."` : `Added to "${list.name}."`);
    } catch {
      setError("Something went wrong adding this book. Please try again.");
    }
  }

  async function handleCreateSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      setError("Give the list a name.");
      return;
    }
    setSubmitting(true);
    try {
      // One atomic server-side operation (Phase 4 correction pass) — never a
      // separate create-then-add pair, which left a real partial-success window
      // (a list could commit with no book if the second call failed).
      const created = await createListWithBook({ name, createdBy: createdBy || undefined }, bookId);
      setOpen(false);
      onAdded(`Created "${created.name}" and added.`);
    } catch {
      setError("Something went wrong creating this list. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/30" />
        <Dialog.Content className="fixed inset-x-0 bottom-0 z-50 flex max-h-[80dvh] flex-col rounded-t-xl border border-border bg-surface p-5 pt-4 sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-sm sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl sm:p-6">
          <div aria-hidden="true" className="mx-auto mb-2 h-1 w-10 rounded-full bg-border-strong sm:hidden" />
          <Dialog.Title className="text-lg font-semibold text-text-primary">Add to Reading List</Dialog.Title>
          <Dialog.Description className="mt-1 truncate text-sm text-text-secondary">{bookTitle}</Dialog.Description>

          {mode === "select" ? (
            <div className="mt-4 flex flex-col gap-4 overflow-y-auto">
              {error && (
                <p role="alert" className="text-sm text-danger">
                  {error}
                </p>
              )}
              {!ready && <p className="text-sm text-text-muted">Loading your lists…</p>}
              {ready && lists.length === 0 && (
                <p className="text-sm text-text-secondary">You don&rsquo;t have any reading lists yet.</p>
              )}
              {ready && lists.length > 0 && (
                <ul className="flex flex-col gap-1 overflow-y-auto">
                  {lists.map((list) => {
                    const alreadyThere = isBookInList(list, bookId);
                    return (
                      <li key={list.id}>
                        <button
                          type="button"
                          onClick={() => handleSelectList(list)}
                          className="flex min-h-11 w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left hover:bg-surface-subtle"
                        >
                          <span className="flex min-w-0 flex-col">
                            <span className="truncate text-sm font-medium text-text-primary">{list.name}</span>
                            <span className="text-xs text-text-muted">{formatCreatedBy(list.createdBy)}</span>
                          </span>
                          {alreadyThere && (
                            <span className="shrink-0 text-xs font-medium text-text-muted">Already added</span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              <Button type="button" variant="secondary" size="md" onClick={() => setMode("create")}>
                Create new list
              </Button>
            </div>
          ) : (
            <form className="mt-4 flex flex-col gap-4" onSubmit={handleCreateSubmit}>
              <div className="flex flex-col gap-1.5">
                <label htmlFor={nameId} className="text-sm font-medium text-text-primary">
                  List name
                </label>
                <input
                  id={nameId}
                  type="text"
                  autoFocus
                  value={name}
                  onChange={(event) => {
                    setName(event.target.value);
                    if (error) setError(null);
                  }}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? `${nameId}-error` : undefined}
                  className="h-11 rounded-md border border-border-input bg-surface px-3 text-base text-text-primary focus:outline-none"
                  placeholder="e.g. Insects, Room 4, Fall Favorites"
                />
                {error && (
                  <p id={`${nameId}-error`} role="alert" className="text-sm text-danger">
                    {error}
                  </p>
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor={creatorId} className="text-sm font-medium text-text-primary">
                  Created by <span className="font-normal text-text-muted">(optional)</span>
                </label>
                <input
                  id={creatorId}
                  type="text"
                  value={createdBy}
                  onChange={(event) => setCreatedBy(event.target.value)}
                  className="h-11 rounded-md border border-border-input bg-surface px-3 text-base text-text-primary focus:outline-none"
                  placeholder="e.g. Ms. Ellis"
                />
                <p className="text-xs text-text-muted">If left blank, this will show as Anonymous.</p>
              </div>
              <div className="flex items-center justify-between gap-3 pt-2">
                <Button type="button" variant="ghost" size="md" onClick={() => setMode("select")}>
                  Back
                </Button>
                <Button type="submit" variant="primary" size="md" disabled={submitting}>
                  {submitting ? "Creating…" : "Create & add"}
                </Button>
              </div>
            </form>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
