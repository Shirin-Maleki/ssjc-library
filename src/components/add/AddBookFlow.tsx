"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { CoverCapture, RotatablePreview, nextRotation, type SelectedCover, type RotationDegrees } from "./CoverCapture";
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
  markDifferentBookAction,
  abandonIntakeAction,
} from "@/lib/intake/actions";
import type { TeacherEdits } from "@/lib/intake/draft";

interface AddBookFlowProps {
  activeCategories: { slug: string; label: string }[];
}

type Stage =
  | { name: "capture" }
  | { name: "processing"; processingStage: ProcessingStage; uploadProgressPercent?: number }
  // Real-cover correction pass §5 — shown instead of silently continuing when
  // identification either fails outright or succeeds with no usable title. Never
  // exposes provider/technical language; offers retry, rotate, a fresh photo, or an
  // explicit choice to continue with a manual (Quick Edit) fallback.
  | { name: "identify_recovery"; itemId: string; previewUrl: string }
  | { name: "duplicate"; isExactMatch: boolean; candidate: DuplicateCandidateViewData; capturedTitle: string }
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
  // The teacher's current manual analysis-rotation choice (real-cover correction
  // pass §6) — starts at whatever they chose on the capture-preview screen, and can
  // be adjusted further from the identify-recovery screen without re-uploading.
  const [rotationDegrees, setRotationDegrees] = useState<RotationDegrees>(0);
  // One shared in-flight guard (§5C of the correction pass) — Confirm/Add book,
  // Review Later, and Add another copy are never simultaneously actionable (only
  // one is ever rendered at a time, on the confirm or duplicate stage), so a single
  // flag correctly prevents a double submission of whichever is currently shown.
  const [isSubmitting, setIsSubmitting] = useState(false);
  // A save-time failure shows INLINE on the same confirm/duplicate screen (§5B) —
  // never a separate terminal stage — so the already-uploaded source photo, the
  // resumable draft, and any in-progress Quick Edit corrections are never lost or
  // re-required for a retry.
  const [actionError, setActionError] = useState<string | null>(null);

  function reset() {
    // Best-effort housekeeping (§6) — if a real ingestion item already exists (the
    // upload succeeded but the teacher is abandoning before it completed or was
    // deferred to review), mark it so it doesn't sit "running"/"processing" forever
    // looking like a stuck job. Never awaited — Start Over always resets instantly.
    if (ingestionItemId && stage.name !== "success" && stage.name !== "saved_for_review") {
      void abandonIntakeAction(ingestionItemId);
    }
    setStage({ name: "capture" });
    setCover(null);
    setIngestionItemId(null);
    setCategorySlug(null);
    setRotationDegrees(0);
    setIsSubmitting(false);
    setActionError(null);
  }

  async function handleCoverConfirmed(selected: SelectedCover) {
    setCover(selected);
    setRotationDegrees(selected.rotationDegrees);
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
    await runIdentify(newIngestionItemId, selected.previewUrl, selected.rotationDegrees);
  }

  // Each stage below is independently retryable and resumes AT that stage — a
  // later step's failure never re-runs an earlier, already-completed (and
  // possibly real-API-costing) one (§5D of the correction pass).
  //
  // Real-cover correction pass §5: this used to ignore identifyCoverAction's
  // result entirely and always continue to metadata lookup, even when vision
  // failed outright or found no usable title — producing an almost-empty
  // confirmation screen with no clear explanation. Now: a hard failure OR "ran but
  // found nothing usable" both show an explicit recovery choice instead of
  // silently continuing. Only a genuinely usable identification proceeds
  // automatically.
  async function runIdentify(itemId: string, previewUrl: string, manualRotationDegrees: RotationDegrees) {
    setStage({ name: "processing", processingStage: "identifying" });
    setRotationDegrees(manualRotationDegrees);
    const result = await identifyCoverAction(itemId, manualRotationDegrees);
    if (!result.ok || !result.hasUsableIdentification) {
      setStage({ name: "identify_recovery", itemId, previewUrl });
      return;
    }
    await runLookup(itemId, previewUrl);
  }

  // The three recovery choices offered on the identify_recovery screen (§5).
  function handleRetryIdentify(itemId: string, previewUrl: string) {
    void runIdentify(itemId, previewUrl, rotationDegrees);
  }

  function handleRotateAndRetry(itemId: string, previewUrl: string) {
    void runIdentify(itemId, previewUrl, nextRotation(rotationDegrees));
  }

  function handleContinueWithManualFallback(itemId: string, previewUrl: string) {
    void runLookup(itemId, previewUrl);
  }

  async function runLookup(itemId: string, previewUrl: string) {
    setStage({ name: "processing", processingStage: "looking_up" });
    const lookupResult = await lookupMetadataAction(itemId);
    if (!lookupResult.ok) {
      setStage({ name: "error", message: lookupResult.message, retry: () => runLookup(itemId, previewUrl) });
      return;
    }
    await runDuplicateCheck(itemId, previewUrl);
  }

  async function runDuplicateCheck(itemId: string, previewUrl: string) {
    setStage({ name: "processing", processingStage: "checking_duplicates" });
    const duplicateResult = await checkDuplicatesAction(itemId);
    if (!duplicateResult.ok) {
      setStage({ name: "error", message: duplicateResult.message, retry: () => runDuplicateCheck(itemId, previewUrl) });
      return;
    }
    if (duplicateResult.candidates.length > 0 && duplicateResult.outcome !== "no_match") {
      const candidate = duplicateResult.candidates[0];
      setActionError(null);
      setStage({
        name: "duplicate",
        isExactMatch: duplicateResult.outcome === "exact_copy_same_edition",
        candidate: {
          bookId: candidate.bookId,
          title: candidate.title,
          authors: candidate.authors,
          languageCode: candidate.languageCode,
          publisher: candidate.publisher,
          displayCoverUrl: candidate.displayCoverUrl,
        },
        // The real identified/reconciled title (§4) — never the raw uploaded
        // filename, which is meaningless to a teacher (e.g. "IMG_1234.HEIC").
        capturedTitle: duplicateResult.capturedTitle ?? "this book",
      });
      return;
    }
    await runEnrichAndConfirm(itemId, previewUrl);
  }

  async function runEnrichAndConfirm(itemId: string, previewUrl: string) {
    setStage({ name: "processing", processingStage: "enriching" });
    const enrichResult = await enrichAndSuggestCategoryAction(itemId);
    if (!enrichResult.ok) {
      setStage({ name: "error", message: enrichResult.message, retry: () => runEnrichAndConfirm(itemId, previewUrl) });
      return;
    }
    const summary = enrichResult.summary;
    setCategorySlug(summary.categorySlug);
    setActionError(null);
    setStage({
      name: "confirm",
      data: {
        coverPreviewUrl: previewUrl,
        title: summary.title || "Untitled",
        authors: summary.authors,
        languageCode: summary.languageCode,
        description: summary.description,
        categorySlug: summary.categorySlug,
        categoryLabel: summary.categoryLabel,
      },
    });
  }

  async function handleSameBook(bookId: string) {
    if (!ingestionItemId || isSubmitting) return;
    setIsSubmitting(true);
    setActionError(null);
    const result = await addAnotherCopyAction({ ingestionItemId, bookId });
    setIsSubmitting(false);
    if (!result.ok) {
      setActionError(result.message);
      return;
    }
    setStage({ name: "success", title: result.title, categoryLabel: result.categoryLabel, isAnotherCopy: true });
  }

  async function handleDifferentBook() {
    if (!ingestionItemId || !cover || isSubmitting) return;
    setIsSubmitting(true);
    setActionError(null);
    // The teacher already reviewed the duplicate comparison and explicitly said
    // this is a different book — preserve all existing identification/
    // reconciliation work. Never re-call Gemini vision or metadata lookup, which
    // already ran once and whose evidence hasn't changed (§4 of the correction
    // pass). Recording the decision is a real audit convenience but never a gate
    // on proceeding — failure here is swallowed.
    await markDifferentBookAction(ingestionItemId).catch(() => {});
    setIsSubmitting(false);
    await runEnrichAndConfirm(ingestionItemId, cover.previewUrl);
  }

  async function handleConfirmSave(edits: TeacherEdits) {
    if (!ingestionItemId || isSubmitting) return;
    setIsSubmitting(true);
    setActionError(null);
    // categorySlug may still be null here (no category was AI-suggested, e.g. when
    // no vision/enrichment provider is configured) — passed through as-is rather
    // than silently no-op'ing, so the server's own minimum-data check
    // (assertMinimumData, §32) can return a real, visible error unless the
    // teacher's Quick Edit selection (edits.physicalCategorySlug) supplies one.
    const result = await confirmSaveAction({ ingestionItemId, categorySlug: categorySlug ?? "", edits });
    setIsSubmitting(false);
    if (!result.ok) {
      // Stay on the confirm screen — the source photo and draft are untouched
      // server-side, so a retry needs neither a re-upload nor re-entering Quick
      // Edit corrections (§5B of the correction pass).
      setActionError(result.message);
      return;
    }
    setStage({ name: "success", title: result.title, categoryLabel: result.categoryLabel, isAnotherCopy: false });
  }

  async function handleReviewLater(reason: string) {
    if (!ingestionItemId || isSubmitting) return;
    setIsSubmitting(true);
    setActionError(null);
    const result = await reviewLaterAction({ ingestionItemId, reason });
    setIsSubmitting(false);
    if (!result.ok) {
      // Never claim success on a failed save (§5A) — the intake/draft/source photo
      // are all preserved either way, so the teacher can just try again.
      setActionError(result.message);
      return;
    }
    setStage({ name: "saved_for_review" });
  }

  switch (stage.name) {
    case "capture":
      return <CoverCapture onConfirm={handleCoverConfirmed} />;

    case "processing":
      return <ProcessingStatus stage={stage.processingStage} uploadProgressPercent={stage.uploadProgressPercent} />;

    case "identify_recovery":
      return (
        <div className="flex flex-col items-center gap-5 py-8 text-center">
          <div>
            <p className="text-lg font-semibold text-text-primary">We couldn&rsquo;t read this cover clearly.</p>
            <p className="mt-1 max-w-sm text-sm text-text-secondary">
              If the photo below looks sideways, tap Rotate. Otherwise, try again or choose a different photo.
            </p>
          </div>
          <RotatablePreview
            previewUrl={stage.previewUrl}
            alt="Uploaded book cover preview"
            rotationDegrees={rotationDegrees}
            onRotate={() => handleRotateAndRetry(stage.itemId, stage.previewUrl)}
          />
          <div className="flex flex-col items-center gap-3 sm:flex-row">
            <Button variant="primary" onClick={() => handleRetryIdentify(stage.itemId, stage.previewUrl)}>
              Try again with this photo
            </Button>
            <button type="button" onClick={reset} className="text-sm font-medium text-text-muted underline underline-offset-4">
              Choose a different photo
            </button>
          </div>
          <button
            type="button"
            onClick={() => handleContinueWithManualFallback(stage.itemId, stage.previewUrl)}
            className="text-sm font-medium text-brand-primary underline underline-offset-4"
          >
            Continue and enter the details myself
          </button>
        </div>
      );

    case "duplicate":
      return (
        <div className="flex flex-col gap-4">
          {actionError && (
            <p role="alert" className="text-sm text-danger">
              {actionError}
            </p>
          )}
          <DuplicateCheck
            isExactMatch={stage.isExactMatch}
            coverPreviewUrl={cover?.previewUrl ?? ""}
            capturedTitle={stage.capturedTitle}
            candidate={stage.candidate}
            onSameBook={() => handleSameBook(stage.candidate.bookId)}
            onDifferentBook={handleDifferentBook}
            onReviewLater={() => handleReviewLater("Teacher indicated a possible catalog match needing review.")}
            submitting={isSubmitting}
          />
        </div>
      );

    case "confirm":
      return (
        <div className="flex flex-col gap-4">
          {actionError && (
            <p role="alert" className="text-sm text-danger">
              {actionError}
            </p>
          )}
          <ConfirmBook
            data={stage.data}
            activeCategories={activeCategories}
            onConfirm={handleConfirmSave}
            onReviewLater={() => handleReviewLater("Teacher chose to review this book later.")}
            submitting={isSubmitting}
          />
        </div>
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
