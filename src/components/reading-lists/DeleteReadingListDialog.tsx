"use client";

import { useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useRouter } from "next/navigation";
import { useReadingLists } from "./ReadingListsProvider";
import { Button } from "@/components/ui/Button";

interface DeleteReadingListDialogProps {
  listId: string;
  listName: string;
  trigger: React.ReactNode;
}

/** A destructive action needs an explicit confirmation (product brief §22) — focus
 * defaults to Cancel, the non-destructive option, via `onOpenAutoFocus`. */
export function DeleteReadingListDialog({ listId, listName, trigger }: DeleteReadingListDialogProps) {
  const router = useRouter();
  const { deleteList } = useReadingLists();
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);

  async function handleDelete() {
    setDeleting(true);
    try {
      await deleteList(listId);
      setOpen(false);
      router.push("/lists");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/30" />
        <Dialog.Content
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            cancelRef.current?.focus();
          }}
          className="fixed inset-x-0 bottom-0 z-50 flex flex-col rounded-t-xl border border-border bg-surface p-5 pt-4 sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-sm sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl sm:p-6"
        >
          <div aria-hidden="true" className="mx-auto mb-2 h-1 w-10 rounded-full bg-border-strong sm:hidden" />
          <Dialog.Title className="text-lg font-semibold text-text-primary">Delete &quot;{listName}&quot;?</Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-text-secondary">
            This removes the Reading List, not the books from the library.
          </Dialog.Description>

          <div className="mt-5 flex items-center justify-end gap-3">
            <Dialog.Close asChild>
              <Button ref={cancelRef} type="button" variant="secondary" size="md">
                Cancel
              </Button>
            </Dialog.Close>
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className="inline-flex h-11 items-center justify-center rounded-md bg-danger px-5 text-sm font-medium text-text-on-brand transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {deleting ? "Deleting…" : "Delete list"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
