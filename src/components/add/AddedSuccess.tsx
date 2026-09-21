import Link from "next/link";
import { Button } from "@/components/ui/Button";

interface AddedSuccessProps {
  title: string;
  categoryLabel: string;
  isAnotherCopy: boolean;
  onAddAnother: () => void;
}

/**
 * The final workflow state (§39 of the phase brief) — the physical book in the
 * teacher's hand is the actual last step, not a metadata detail screen. Always ends
 * with a real shelving instruction using the book's actual category label.
 */
export function AddedSuccess({ title, categoryLabel, isAnotherCopy, onAddAnother }: AddedSuccessProps) {
  return (
    <div className="flex flex-col items-center gap-6 py-10 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-accent/15 text-2xl" aria-hidden="true">
        ✓
      </div>
      <div>
        <p className="text-lg font-semibold text-text-primary">{isAnotherCopy ? "Another copy was added." : "Added to SSJC Library"}</p>
        <p className="mt-1 text-xl font-semibold text-text-primary">{title}</p>
      </div>
      <div className="rounded-lg border border-border bg-surface-subtle px-6 py-4">
        <p className="text-xs uppercase tracking-wide text-text-muted">Shelve alphabetically by title in</p>
        <p className="text-lg font-semibold text-brand-primary">{categoryLabel}</p>
      </div>
      <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
        <Button variant="secondary" size="lg" onClick={onAddAnother}>
          Add another book
        </Button>
        <Link href="/home" className="inline-flex h-12 items-center justify-center rounded-md px-6 text-base font-medium text-text-secondary hover:text-text-primary">
          Done
        </Link>
      </div>
    </div>
  );
}
