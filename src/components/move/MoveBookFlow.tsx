"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { CoverCapture, type SelectedCover } from "@/components/add/CoverCapture";
import { identifyBookForMoveAction, listActiveLocationsAction, getCopyLocationSummaryAction, moveCopyAction, type MoveMatchCandidate } from "@/lib/locations/actions";
import type { LibraryLocationOption } from "@/db/repositories";
import type { CopyLocationCount } from "@/lib/locations/persistence";

/**
 * The Move/Return workflow (Phase 9 addendum §3): photo → match against the
 * existing catalog → teacher confirms the book → (if needed) teacher says
 * which location the copy is coming from → teacher says where it's going →
 * exactly one physical copy moves. Mirrors `AddBookFlow.tsx`'s own
 * stage-machine shape, but is a genuinely different, much shorter flow — no
 * upload, no identification-recovery screen, no duplicate check, no
 * enrichment, no category, no save. The book already exists; this only ever
 * reads the catalog until the teacher's final destination choice.
 */

type BookRef = { id: string; title: string };

type Stage =
  | { name: "capture" }
  | { name: "matching" }
  | { name: "candidates"; candidates: MoveMatchCandidate[] }
  | { name: "no_match"; capturedTitle: string | null }
  | { name: "choose_from"; book: BookRef; buckets: CopyLocationCount[]; destinations: LibraryLocationOption[] }
  | { name: "choose_to"; book: BookRef; fromLocationId: string | null; fromLabel: string; destinations: LibraryLocationOption[] }
  | { name: "moving" }
  | { name: "success"; title: string; fromLabel: string; toLabel: string }
  | { name: "error"; message: string; retry?: () => void };

const GENERIC_ERROR_MESSAGE = "Something went wrong. Please try again.";

/** §3: "For returning a book, make Corridor 218 a convenient destination
 * shortcut if that is an active location" — conditional, never assumed. If no
 * active location has this slug (a real corridor 218 was never configured,
 * or this isn't that school's layout), the list is simply alphabetical with
 * no special-casing at all. */
function sortDestinations(locations: LibraryLocationOption[]): LibraryLocationOption[] {
  return [...locations].sort((a, b) => {
    if (a.slug === "corridor-218" && b.slug !== "corridor-218") return -1;
    if (b.slug === "corridor-218" && a.slug !== "corridor-218") return 1;
    return a.displayName.localeCompare(b.displayName);
  });
}

export function MoveBookFlow() {
  const [stage, setStage] = useState<Stage>({ name: "capture" });

  function reset() {
    setStage({ name: "capture" });
  }

  async function handleCoverConfirmed(selected: SelectedCover) {
    setStage({ name: "matching" });
    const formData = new FormData();
    formData.set("photo", selected.file);
    formData.set("rotationDegrees", String(selected.rotationDegrees));

    const result = await identifyBookForMoveAction(formData);
    if (!result.ok) {
      setStage({ name: "error", message: result.message || GENERIC_ERROR_MESSAGE, retry: () => handleCoverConfirmed(selected) });
      return;
    }
    if (result.candidates.length === 0) {
      setStage({ name: "no_match", capturedTitle: result.capturedTitle });
      return;
    }
    setStage({ name: "candidates", candidates: result.candidates });
  }

  async function handleConfirmBook(book: BookRef) {
    setStage({ name: "matching" });
    let buckets: CopyLocationCount[];
    let destinations: LibraryLocationOption[];
    try {
      [buckets, destinations] = await Promise.all([getCopyLocationSummaryAction(book.id), listActiveLocationsAction()]);
    } catch {
      setStage({ name: "error", message: GENERIC_ERROR_MESSAGE, retry: () => handleConfirmBook(book) });
      return;
    }

    if (buckets.length === 0) {
      setStage({ name: "error", message: "No physical copy could be found on file for this book." });
      return;
    }
    if (buckets.length === 1) {
      const only = buckets[0];
      setStage({ name: "choose_to", book, fromLocationId: only.locationId, fromLabel: only.label, destinations: sortDestinations(destinations).filter((d) => d.id !== only.locationId) });
      return;
    }
    setStage({ name: "choose_from", book, buckets, destinations });
  }

  function handleChooseFrom(book: BookRef, destinations: LibraryLocationOption[], bucket: CopyLocationCount) {
    setStage({ name: "choose_to", book, fromLocationId: bucket.locationId, fromLabel: bucket.label, destinations: sortDestinations(destinations).filter((d) => d.id !== bucket.locationId) });
  }

  async function handleChooseTo(book: BookRef, fromLocationId: string | null, destination: LibraryLocationOption) {
    setStage({ name: "moving" });
    const result = await moveCopyAction({ bookId: book.id, fromLocationId, toLocationId: destination.id });
    if (!result.ok) {
      setStage({ name: "error", message: result.message, retry: () => handleChooseTo(book, fromLocationId, destination) });
      return;
    }
    setStage({ name: "success", title: book.title, fromLabel: result.fromLabel, toLabel: result.toLabel });
  }

  switch (stage.name) {
    case "capture":
      return (
        <CoverCapture
          onConfirm={handleCoverConfirmed}
          heading="Move a Book"
          subheading="Photograph the cover of the book you're moving or returning."
          helpText="Photograph the book cover only. Avoid including people or children."
          ctaLabel="Take or choose a photo"
        />
      );

    case "matching":
    case "moving":
      return (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <p className="text-text-secondary">{stage.name === "matching" ? "Looking this book up…" : "Moving…"}</p>
        </div>
      );

    case "candidates":
      return (
        <div className="flex flex-col gap-5">
          <h1 className="text-lg font-semibold text-text-primary">{stage.candidates.length === 1 ? "Is this it?" : "Which book is this?"}</h1>
          <ul className="flex flex-col gap-3">
            {stage.candidates.map((candidate) => (
              <li key={candidate.bookId} className="flex items-center gap-4 rounded-lg border border-border bg-surface p-3">
                {candidate.displayCoverUrl ? (
                  <img src={candidate.displayCoverUrl} alt="" className="h-20 w-16 shrink-0 rounded-md border border-border object-cover" />
                ) : (
                  <div className="flex h-20 w-16 shrink-0 items-center justify-center rounded-md border border-border bg-surface-subtle p-1 text-center text-[9px] leading-tight text-text-muted">
                    {candidate.title}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-text-primary">{candidate.title}</p>
                  {candidate.authors.length > 0 && <p className="truncate text-sm text-text-secondary">{candidate.authors.join(", ")}</p>}
                </div>
                <Button size="md" onClick={() => handleConfirmBook({ id: candidate.bookId, title: candidate.title })}>
                  Yes, this is it
                </Button>
              </li>
            ))}
          </ul>
          <button type="button" onClick={reset} className="self-start text-sm font-medium text-text-muted underline underline-offset-4 hover:text-text-primary">
            None of these — try a different photo
          </button>
        </div>
      );

    case "no_match":
      return (
        <div className="flex flex-col items-center gap-4 py-12 text-center">
          <p className="text-lg font-semibold text-text-primary">We couldn&rsquo;t match this photo to a book in the catalog.</p>
          {stage.capturedTitle && <p className="max-w-sm text-text-secondary">We read this cover as &ldquo;{stage.capturedTitle}&rdquo;, but nothing close enough was found.</p>}
          <Button variant="primary" onClick={reset}>
            Try a different photo
          </Button>
        </div>
      );

    case "choose_from":
      return (
        <div className="flex flex-col gap-5">
          <div>
            <h1 className="text-lg font-semibold text-text-primary">Where did you take this copy from?</h1>
            <p className="mt-1 text-text-secondary">{stage.book.title}</p>
          </div>
          <ul className="flex flex-col gap-2">
            {stage.buckets.map((bucket) => (
              <li key={bucket.locationId ?? "unrecorded"}>
                <button
                  type="button"
                  onClick={() => handleChooseFrom(stage.book, stage.destinations, bucket)}
                  className="flex w-full items-center justify-between rounded-lg border border-border bg-surface p-4 text-left transition-colors hover:border-border-strong"
                >
                  <span className="font-medium text-text-primary">{bucket.label}</span>
                  <span className="text-sm text-text-muted">
                    {bucket.count} cop{bucket.count === 1 ? "y" : "ies"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <button type="button" onClick={reset} className="self-start text-sm font-medium text-text-muted underline underline-offset-4 hover:text-text-primary">
            Start over
          </button>
        </div>
      );

    case "choose_to":
      return (
        <div className="flex flex-col gap-5">
          <div>
            <h1 className="text-lg font-semibold text-text-primary">Where is it now?</h1>
            <p className="mt-1 text-text-secondary">
              {stage.book.title} — taking from {stage.fromLabel}
            </p>
          </div>
          {stage.destinations.length === 0 ? (
            <p className="text-text-secondary">No other active locations are configured yet. Ask an admin to add one.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {stage.destinations.map((destination) => (
                <li key={destination.id}>
                  <button
                    type="button"
                    onClick={() => handleChooseTo(stage.book, stage.fromLocationId, destination)}
                    className="w-full rounded-lg border border-border bg-surface p-4 text-left font-medium text-text-primary transition-colors hover:border-border-strong"
                  >
                    {destination.displayName}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button type="button" onClick={reset} className="self-start text-sm font-medium text-text-muted underline underline-offset-4 hover:text-text-primary">
            Start over
          </button>
        </div>
      );

    case "success":
      return (
        <div className="flex flex-col items-center gap-4 py-16 text-center">
          <p className="text-lg font-semibold text-text-primary">Moved</p>
          <p className="max-w-sm text-text-secondary">
            {stage.title} — {stage.fromLabel} → {stage.toLabel}
          </p>
          <Button variant="primary" onClick={reset}>
            Move another book
          </Button>
        </div>
      );

    case "error":
      return (
        <div className="flex flex-col items-center gap-4 py-16 text-center">
          <p className="text-text-primary">{stage.message}</p>
          <div className="flex gap-3">
            {stage.retry && (
              <button type="button" onClick={stage.retry} className="text-sm font-medium text-brand-primary underline underline-offset-4">
                Try again
              </button>
            )}
            <button type="button" onClick={reset} className="text-sm font-medium text-text-muted underline underline-offset-4">
              Start over
            </button>
          </div>
        </div>
      );
  }
}
