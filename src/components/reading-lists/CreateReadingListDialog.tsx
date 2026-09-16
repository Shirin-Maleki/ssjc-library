"use client";

import { useId, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useRouter } from "next/navigation";
import { useReadingLists } from "./ReadingListsProvider";
import { Button } from "@/components/ui/Button";

interface CreateReadingListDialogProps {
  trigger: React.ReactNode;
}

/**
 * A small, two-field form (product brief §15) — reused by nothing else; the Add-to-
 * list flow (`AddToReadingListDialog`) has its own compact create step, since it also
 * has to add the just-created list's first book, which this standalone flow never
 * does. Duplicated markup here is small and each flow's follow-up action genuinely
 * differs, so a shared abstraction would buy little.
 */
export function CreateReadingListDialog({ trigger }: CreateReadingListDialogProps) {
  const router = useRouter();
  const { createList } = useReadingLists();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [createdBy, setCreatedBy] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameId = useId();
  const creatorId = useId();

  function handleOpenChange(next: boolean) {
    if (next) {
      setName("");
      setCreatedBy("");
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
      const created = await createList({ name, createdBy: createdBy || undefined });
      setOpen(false);
      router.push(`/lists/${created.id}`);
    } catch {
      // Never a raw error/stack trace (Phase 4 brief §35) — one calm sentence.
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
        <Dialog.Content className="fixed inset-x-0 bottom-0 z-50 flex flex-col rounded-t-xl border border-border bg-surface p-5 pt-4 sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-sm sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl sm:p-6">
          <div aria-hidden="true" className="mx-auto mb-2 h-1 w-10 rounded-full bg-border-strong sm:hidden" />
          <Dialog.Title className="text-lg font-semibold text-text-primary">New reading list</Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-text-secondary">
            Give it a name — you can rename it later.
          </Dialog.Description>

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

            <div className="flex items-center justify-end gap-3 pt-2">
              <Dialog.Close asChild>
                <Button type="button" variant="ghost" size="md">
                  Cancel
                </Button>
              </Dialog.Close>
              <Button type="submit" variant="primary" size="md" disabled={submitting}>
                {submitting ? "Creating…" : "Create list"}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
