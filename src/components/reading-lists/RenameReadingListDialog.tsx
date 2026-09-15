"use client";

import { useId, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useReadingLists } from "./ReadingListsProvider";
import { Button } from "@/components/ui/Button";

interface RenameReadingListDialogProps {
  listId: string;
  currentName: string;
  trigger: React.ReactNode;
}

/** Renames only the list's name — creator, books, and created date are untouched
 * (product brief §21); the repository itself only ever updates `name`/`updatedAt`. */
export function RenameReadingListDialog({ listId, currentName, trigger }: RenameReadingListDialogProps) {
  const { renameList } = useReadingLists();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(currentName);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameId = useId();

  function handleOpenChange(next: boolean) {
    if (next) {
      setName(currentName);
      setError(null);
    }
    setOpen(next);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      setError("Give the list a name.");
      return;
    }
    setSubmitting(true);
    try {
      await renameList(listId, name);
      setOpen(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/30" />
        <Dialog.Content className="fixed inset-x-0 bottom-0 z-50 flex flex-col rounded-t-xl border border-border bg-surface p-5 pt-4 sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-sm sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl sm:p-6">
          <div aria-hidden="true" className="mx-auto mb-2 h-1 w-10 rounded-full bg-border-strong sm:hidden" />
          <Dialog.Title className="text-lg font-semibold text-text-primary">Rename list</Dialog.Title>

          <form className="mt-4 flex flex-col gap-4" onSubmit={handleSubmit}>
            <div className="flex flex-col gap-1.5">
              <label htmlFor={nameId} className="text-sm font-medium text-text-primary">
                List name
              </label>
              <input
                id={nameId}
                type="text"
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  if (error) setError(null);
                }}
                autoFocus
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? `${nameId}-error` : undefined}
                className="h-11 rounded-md border border-border-input bg-surface px-3 text-base text-text-primary focus:outline-none"
              />
              {error && (
                <p id={`${nameId}-error`} role="alert" className="text-sm text-danger">
                  {error}
                </p>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <Dialog.Close asChild>
                <Button type="button" variant="ghost" size="md">
                  Cancel
                </Button>
              </Dialog.Close>
              <Button type="submit" variant="primary" size="md" disabled={submitting}>
                {submitting ? "Saving…" : "Save"}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
