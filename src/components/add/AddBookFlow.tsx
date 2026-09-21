"use client";

import { useState } from "react";
import { CoverCapture, type SelectedCover } from "./CoverCapture";
import { ProcessingStatus, type ProcessingStage } from "./ProcessingStatus";
import { ConfirmBook, type ConfirmBookViewData } from "./ConfirmBook";
import { DuplicateCheck, type DuplicateCandidateViewData } from "./DuplicateCheck";
import { AddedSuccess } from "./AddedSuccess";
import { uploadCover, UploadToSessionError } from "./uploadToSession";
import {
  identifyCoverAction,
  lookupMetadataAction,
  checkDuplicatesAction,
  enrichAndSuggestCategoryAction,
  confirmSaveAction,
  addAnotherCopyAction,
  reviewLaterAction,
} from "@/lib/intake/actions";
import type { TeacherEdits } from "@/lib/intake/draft";

interface AddBookFlowProps {
  activeCategories: { slug: string; label: string }[];
}

type Stage =
  | { name: "capture" }
  | { name: "processing"; processingStage: ProcessingStage; uploadProgressPercent?: number }
  | { name: "duplicate"; isExactMatch: boolean; candidate: DuplicateCandidateViewData }
  | { name: "confirm"; data: ConfirmBookViewData }
  | { name: "success"; title: string; categoryLabel: string; isAnotherCopy: boolean }
  | { name: "saved_for_review" }
  | { name: "error"; message: string; retry?: () => void };

const GENERIC_ERROR_MESSAGE = "Something went wrong. Please try again.";

export function AddBookFlow({ activeCategories }: AddBookFlowProps) {
  const [stage, setStage] = useState<Stage>({ name: "capture" });
  const [cover, setCover] = useState<SelectedCover | null>(null);
  const [ingestionItemId, setIngestionItemId] = useState<string | null>(null);
  const [categorySlug, setCategorySlug] = useState<string | null>(null);

  function reset() {
    setStage({ name: "capture" });
    setCover(null);
    setIngestionItemId(null);
    setCategorySlug(null);
  }

  async function handleCoverConfirmed(selected: SelectedCover) {
    setCover(selected);
    await runUpload(selected);
  }

  async function runUpload(selected: SelectedCover) {
    setStage({ name: "processing", processingStage: "uploading" });

    let newIngestionItemId: string;
    try {
      const uploaded = await uploadCover(selected.file, (event) => {
        const percent = Math.round((event.loadedBytes / event.totalBytes) * 100);
        setStage({ name: "processing", processingStage: "uploading", uploadProgressPercent: percent });
      });
      newIngestionItemId = uploaded.ingestionItemId;
    } catch (error) {
      const message = error instanceof UploadToSessionError ? error.message : GENERIC_ERROR_MESSAGE;
      setStage({ name: "error", message, retry: () => runUpload(selected) });
      return;
    }

    setIngestionItemId(newIngestionItemId);
    await runIdentifyThroughEnrich(newIngestionItemId, selected.previewUrl);
  }

  async function runIdentifyThroughEnrich(itemId: string, previewUrl: string, treatAsDifferentBook = false) {
    setStage({ name: "processing", processingStage: "identifying" });
    const identifyResult = await identifyCoverAction(itemId);
    // A vision failure still allows a partial/manual path — proceed with whatever
    // evidence exists (possibly none) rather than blocking the whole intake.

    setStage({ name: "processing", processingStage: "looking_up" });
    const lookupResult = await lookupMetadataAction(itemId);
    if (!lookupResult.ok) {
      setStage({ name: "error", message: lookupResult.message, retry: () => runIdentifyThroughEnrich(itemId, previewUrl, treatAsDifferentBook) });
      return;
    }

    if (!treatAsDifferentBook) {
      setStage({ name: "processing", processingStage: "checking_duplicates" });
      const duplicateResult = await checkDuplicatesAction(itemId);
      if (!duplicateResult.ok) {
        setStage({ name: "error", message: duplicateResult.message, retry: () => runIdentifyThroughEnrich(itemId, previewUrl) });
        return;
      }
      if (duplicateResult.candidates.length > 0 && duplicateResult.outcome !== "no_match") {
        const candidate = duplicateResult.candidates[0];
        setStage({
          name: "duplicate",
          isExactMatch: duplicateResult.outcome === "exact_copy_same_edition",
          candidate: {
            bookId: candidate.bookId,
            title: candidate.title,
            authors: candidate.authors,
            languageCode: candidate.languageCode,
            publisher: candidate.publisher,
          },
        });
        return;
      }
    }

    setStage({ name: "processing", processingStage: "enriching" });
    const enrichResult = await enrichAndSuggestCategoryAction(itemId);
    const summary = enrichResult.ok ? enrichResult.summary : { description: null, tags: [], categorySlug: null, categoryLabel: null };

    setCategorySlug(summary.categorySlug);
    setStage({
      name: "confirm",
      data: {
        coverPreviewUrl: previewUrl,
        title: (identifyResult.ok && identifyResult.visibleTitle) || "Untitled",
        authors: (identifyResult.ok && identifyResult.visibleAuthors) || [],
        languageCode: null,
        description: summary.description,
        categorySlug: summary.categorySlug,
        categoryLabel: summary.categoryLabel,
      },
    });
  }

  async function handleSameBook(bookId: string) {
    if (!ingestionItemId) return;
    setStage({ name: "processing", processingStage: "saving" });
    const result = await addAnotherCopyAction({ ingestionItemId, bookId });
    if (!result.ok) {
      setStage({ name: "error", message: result.message, retry: () => handleSameBook(bookId) });
      return;
    }
    setStage({ name: "success", title: result.title, categoryLabel: result.categoryLabel, isAnotherCopy: true });
  }

  async function handleDifferentBook() {
    if (!ingestionItemId || !cover) return;
    await runIdentifyThroughEnrich(ingestionItemId, cover.previewUrl, true);
  }

  async function handleConfirmSave(edits: TeacherEdits) {
    if (!ingestionItemId) return;
    setStage((current) => (current.name === "confirm" ? { ...current } : current));
    // categorySlug may still be null here (no category was AI-suggested, e.g. when
    // no vision/enrichment provider is configured) — passed through as-is rather
    // than silently no-op'ing, so the server's own minimum-data check
    // (assertMinimumData, §32) can return a real, visible error unless the
    // teacher's Quick Edit selection (edits.physicalCategorySlug) supplies one.
    const result = await confirmSaveAction({ ingestionItemId, categorySlug: categorySlug ?? "", edits });
    if (!result.ok) {
      setStage({ name: "error", message: result.message });
      return;
    }
    setStage({ name: "success", title: result.title, categoryLabel: result.categoryLabel, isAnotherCopy: false });
  }

  async function handleReviewLater(reason: string) {
    if (!ingestionItemId) return;
    await reviewLaterAction({ ingestionItemId, reason });
    setStage({ name: "saved_for_review" });
  }

  switch (stage.name) {
    case "capture":
      return <CoverCapture onConfirm={handleCoverConfirmed} />;

    case "processing":
      return <ProcessingStatus stage={stage.processingStage} uploadProgressPercent={stage.uploadProgressPercent} />;

    case "duplicate":
      return (
        <DuplicateCheck
          isExactMatch={stage.isExactMatch}
          coverPreviewUrl={cover?.previewUrl ?? ""}
          capturedTitle={cover?.file.name ?? ""}
          candidate={stage.candidate}
          onSameBook={() => handleSameBook(stage.candidate.bookId)}
          onDifferentBook={handleDifferentBook}
          onReviewLater={() => handleReviewLater("Teacher indicated a possible catalog match needing review.")}
          submitting={false}
        />
      );

    case "confirm":
      return (
        <ConfirmBook
          data={stage.data}
          activeCategories={activeCategories}
          onConfirm={handleConfirmSave}
          onReviewLater={() => handleReviewLater("Teacher chose to review this book later.")}
          submitting={false}
        />
      );

    case "success":
      return (
        <AddedSuccess title={stage.title} categoryLabel={stage.categoryLabel} isAnotherCopy={stage.isAnotherCopy} onAddAnother={reset} />
      );

    case "saved_for_review":
      return (
        <div className="flex flex-col items-center gap-4 py-16 text-center">
          <p className="text-lg font-semibold text-text-primary">Saved for later</p>
          <p className="max-w-sm text-text-secondary">
            This book&rsquo;s photo and details are saved. You can pick this up again later — nothing needs to be re-photographed.
          </p>
          <button type="button" onClick={reset} className="text-sm font-medium text-brand-primary underline underline-offset-4">
            Add another book
          </button>
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
