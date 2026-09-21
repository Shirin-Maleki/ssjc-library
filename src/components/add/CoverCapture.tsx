"use client";

import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";

/** Mirrors `src/lib/googleDrive/validation.ts`'s server-side contract — duplicated
 * as plain string/number constants (not imported) because that module lives under
 * `src/lib/googleDrive/`, a server-oriented package, and this is deliberately
 * client-side, pre-upload validation for immediate teacher feedback; the server
 * still independently re-validates every one of these before ever accepting a
 * Drive upload (`/api/intake/cover`), so this is a UX convenience, never the
 * actual security boundary. */
const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);
const MAX_SIZE_BYTES = 25 * 1024 * 1024;

export type RotationDegrees = 0 | 90 | 180 | 270;

export interface SelectedCover {
  file: File;
  previewUrl: string;
  /** The teacher's chosen correction on top of whatever the browser preview already
   * shows (real-cover correction pass §6) — 0 unless they tapped Rotate. Applied to
   * the AI analysis derivative only; the original file/Drive upload is unaffected. */
  rotationDegrees: RotationDegrees;
}

export function nextRotation(current: RotationDegrees): RotationDegrees {
  return ((current + 90) % 360) as RotationDegrees;
}

interface CoverCaptureProps {
  onConfirm: (cover: SelectedCover) => void;
}

function formatFileSize(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

/**
 * A small, deliberately simple rotate affordance (real-cover correction pass §6) —
 * not a photo editor. A square preview box means any 90-degree increment fits
 * without clipping (the rotated image's bounding box never exceeds a square it was
 * already contained within), so no separate portrait/landscape box logic is needed.
 * Shared between the initial cover-selection preview and the post-identification
 * recovery UI (`AddBookFlow`'s "we couldn't read this cover clearly" state), since
 * both need the same "let the teacher fix an obviously sideways photo" affordance.
 */
export function RotatablePreview({
  previewUrl,
  alt,
  rotationDegrees,
  onRotate,
}: {
  previewUrl: string;
  alt: string;
  rotationDegrees: RotationDegrees;
  onRotate: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex h-40 w-40 items-center justify-center overflow-hidden rounded-md border border-border bg-surface-subtle sm:h-48 sm:w-48">
        <img
          src={previewUrl}
          alt={alt}
          style={{ transform: `rotate(${rotationDegrees}deg)` }}
          className="max-h-full max-w-full object-contain"
        />
      </div>
      <button
        type="button"
        onClick={onRotate}
        className="inline-flex items-center gap-1 text-sm font-medium text-brand-primary underline underline-offset-4 hover:text-brand-secondary"
      >
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4" aria-hidden="true">
          <path d="M10 4a6 6 0 1 0 5.917 5H14.9a5 5 0 1 1-1.348-4.243L11 7h5V2l-2.028 2.028A5.98 5.98 0 0 0 10 4Z" />
        </svg>
        Rotate 90°
      </button>
    </div>
  );
}

/**
 * The Phase 7 intake's first screen (§10 of the phase brief) — a standard,
 * accessible file input with mobile camera-oriented `accept`/`capture` attributes,
 * not a custom camera implementation. Selecting a file never uploads it
 * immediately; the teacher must take an explicit "Use this cover" action first.
 */
export function CoverCapture({ onConfirm }: CoverCaptureProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<SelectedCover | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ""; // allow re-selecting the exact same file later (e.g. after "Change photo")
    if (!file) return;

    if (!ALLOWED_MIME_TYPES.has(file.type)) {
      setError("That file type isn't supported. Please choose a JPEG, PNG, WebP, HEIC, or HEIF photo.");
      return;
    }
    if (file.size === 0) {
      setError("That file appears to be empty. Please choose a different photo.");
      return;
    }
    if (file.size > MAX_SIZE_BYTES) {
      setError(`That photo is too large (max ${Math.floor(MAX_SIZE_BYTES / (1024 * 1024))} MB).`);
      return;
    }

    setError(null);
    if (selected) URL.revokeObjectURL(selected.previewUrl);
    // A freshly selected file always starts at 0 — any rotation choice belongs to
    // the specific photo the teacher is looking at, never carried over from a
    // previous selection.
    setSelected({ file, previewUrl: URL.createObjectURL(file), rotationDegrees: 0 });
  }

  function handleRotate() {
    setSelected((prev) => (prev ? { ...prev, rotationDegrees: nextRotation(prev.rotationDegrees) } : prev));
  }

  function handleChangePhoto() {
    if (selected) URL.revokeObjectURL(selected.previewUrl);
    setSelected(null);
    setError(null);
    inputRef.current?.click();
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold text-text-primary">Add a Book</h1>
        <p className="mt-1 text-text-secondary">Photograph the front cover to get started.</p>
      </div>

      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
        capture="environment"
        className="sr-only"
        onChange={handleFileChange}
      />

      {!selected && (
        <div className="flex flex-col items-center gap-4 rounded-lg border border-dashed border-border-strong bg-surface-subtle px-6 py-12 text-center">
          <label
            htmlFor={inputId}
            className="inline-flex h-12 cursor-pointer items-center justify-center gap-2 rounded-md bg-brand-primary px-6 text-base font-medium text-text-on-brand transition-colors hover:bg-brand-secondary"
          >
            Take or choose a photo
          </label>
          <p className="max-w-xs text-sm text-text-muted">Photograph the book cover only. Avoid including people or children.</p>
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      {selected && (
        <div className="flex flex-col gap-4">
          <div className="flex items-start gap-4">
            <RotatablePreview
              previewUrl={selected.previewUrl}
              alt="Selected book cover preview"
              rotationDegrees={selected.rotationDegrees}
              onRotate={handleRotate}
            />
            <div className="flex flex-col gap-1 pt-1">
              <p className="text-sm font-medium text-text-primary">Photo selected</p>
              <p className="text-xs text-text-muted">
                {selected.file.name} · {formatFileSize(selected.file.size)}
              </p>
              {selected.rotationDegrees !== 0 && (
                <p className="text-xs text-text-muted">If the photo looks sideways above, tap Rotate until it looks upright.</p>
              )}
              <button
                type="button"
                onClick={handleChangePhoto}
                className="mt-2 self-start text-sm font-medium text-brand-primary underline underline-offset-4 hover:text-brand-secondary"
              >
                Change photo
              </button>
            </div>
          </div>
          <Button variant="primary" size="lg" onClick={() => onConfirm(selected)} className="w-full sm:w-auto">
            Use this cover
          </Button>
        </div>
      )}
    </div>
  );
}
