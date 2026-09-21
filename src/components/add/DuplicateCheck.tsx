"use client";

import { Button } from "@/components/ui/Button";
import { ISO_639_1_LANGUAGE_NAMES, type LanguageCode } from "@/lib/catalog/languages";

export interface DuplicateCandidateViewData {
  bookId: string;
  title: string;
  authors: string[];
  languageCode: string;
  publisher: string | null;
  /** A real, previously-verified display cover for the existing catalog book
   * (Phase 7 correction pass §2) — absent for most real books today (nothing
   * populates it yet outside Add-a-Book's own confirmed-identity saves), in
   * which case the typographic placeholder box below is shown instead. */
  displayCoverUrl: string | null;
}

interface DuplicateCheckProps {
  isExactMatch: boolean;
  coverPreviewUrl: string;
  capturedTitle: string;
  candidate: DuplicateCandidateViewData;
  onSameBook: () => void;
  onDifferentBook: () => void;
  onReviewLater: () => void;
  submitting: boolean;
}

/**
 * Two related states sharing one component (§18/§19 of the phase brief): a
 * confident exact-edition match ("This book is already in the library") and a
 * merely-similar ambiguous match ("Is this the same book?"). Never exposes a
 * confidence decimal, never silently chooses — a teacher always decides.
 */
export function DuplicateCheck({
  isExactMatch,
  coverPreviewUrl,
  capturedTitle,
  candidate,
  onSameBook,
  onDifferentBook,
  onReviewLater,
  submitting,
}: DuplicateCheckProps) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold text-text-primary">
          {isExactMatch ? "This book is already in the library." : "Is this the same book?"}
        </h2>
        {isExactMatch && <p className="mt-1 text-text-secondary">Add another copy?</p>}
      </div>

      <div className="flex items-start gap-4">
        <div className="flex flex-col items-center gap-1">
          <img src={coverPreviewUrl} alt="" className="h-32 w-24 rounded-md border border-border object-cover" />
          <p className="text-xs text-text-muted">Just photographed</p>
        </div>
        <div className="flex flex-col items-center gap-1">
          {candidate.displayCoverUrl ? (
            <img src={candidate.displayCoverUrl} alt="" className="h-32 w-24 rounded-md border border-border object-cover" />
          ) : (
            <div className="flex h-32 w-24 items-center justify-center rounded-md border border-border bg-surface-subtle p-2 text-center text-[10px] leading-tight text-text-muted">
              {candidate.title}
            </div>
          )}
          <p className="text-xs text-text-muted">In the library</p>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-surface-subtle p-4 text-sm">
        <p className="font-medium text-text-primary">{candidate.title}</p>
        {candidate.authors.length > 0 && <p className="text-text-secondary">{candidate.authors.join(", ")}</p>}
        <p className="text-text-muted">{ISO_639_1_LANGUAGE_NAMES[candidate.languageCode as LanguageCode] ?? candidate.languageCode}</p>
        {candidate.publisher && <p className="text-text-muted">{candidate.publisher}</p>}
        {!isExactMatch && <p className="mt-2 text-text-muted">You photographed: &ldquo;{capturedTitle}&rdquo;</p>}
      </div>

      <div className="flex flex-col gap-3">
        <Button variant="primary" size="lg" disabled={submitting} onClick={onSameBook}>
          {isExactMatch ? (submitting ? "Adding…" : "Add another copy") : "Same book — add another copy"}
        </Button>
        {!isExactMatch && (
          <Button variant="secondary" size="lg" disabled={submitting} onClick={onDifferentBook}>
            Different book
          </Button>
        )}
        <button
          type="button"
          onClick={onReviewLater}
          disabled={submitting}
          className="text-sm font-medium text-text-muted underline underline-offset-4 hover:text-text-primary"
        >
          Review later
        </button>
      </div>
    </div>
  );
}
