"use client";

import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils/cn";

/** Mirrors `src/lib/googleDrive/validation.ts`'s server-side contract — duplicated
 * as plain string/number constants (not imported) because that module lives under
 * `src/lib/googleDrive/`, a server-oriented package, and this is deliberately
 * client-side, pre-upload validation for immediate teacher feedback; the server
 * still independently re-validates every one of these before ever initiating a
 * Drive upload (`initiateUploadAction`), so this is a UX convenience, never the
 * actual security boundary. */
const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);
const MAX_SIZE_BYTES = 25 * 1024 * 1024;

export interface SelectedCover {
  file: File;
  previewUrl: string;
}

interface CoverCaptureProps {
  onConfirm: (cover: SelectedCover) => void;
}

function formatFileSize(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
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
    setSelected({ file, previewUrl: URL.createObjectURL(file) });
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
            <img
              src={selected.previewUrl}
              alt="Selected book cover preview"
              className={cn("h-40 w-28 shrink-0 rounded-md border border-border object-cover sm:h-48 sm:w-32")}
            />
            <div className="flex flex-col gap-1 pt-1">
              <p className="text-sm font-medium text-text-primary">Photo selected</p>
              <p className="text-xs text-text-muted">
                {selected.file.name} · {formatFileSize(selected.file.size)}
              </p>
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
