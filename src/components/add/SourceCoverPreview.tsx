"use client";

import { cn } from "@/lib/utils/cn";

export type RotationDegrees = 0 | 90 | 180 | 270;

export function nextRotation(current: RotationDegrees): RotationDegrees {
  return ((current + 90) % 360) as RotationDegrees;
}

/**
 * The one shared way to render the teacher's just-photographed SOURCE cover photo
 * anywhere in the intake flow (AI-first catalog draft correction §9) — a real
 * teacher reported that a photo they had manually rotated correctly during
 * capture/identification reverted to looking sideways again on the confirmation
 * screen, because each screen (capture preview, duplicate comparison,
 * confirmation) rendered its own independent, unrotated `<img>` from the same
 * `previewUrl` rather than sharing one rotation-aware component. Every screen that
 * shows the SOURCE photo (never a metadata-provider display cover — that is a
 * completely separate asset and must never receive this transform) should use
 * this component with the teacher's persisted `analysisRotationDegrees`.
 *
 * Rotation here is a pure CSS `transform`, always relative to what the browser's
 * own EXIF-aware `<img>` rendering already shows upright — never a mutation of the
 * original file, and never touching the real Drive source bytes.
 */
export function SourceCoverPreview({
  previewUrl,
  alt,
  rotationDegrees,
  className,
}: {
  previewUrl: string;
  alt: string;
  rotationDegrees: RotationDegrees;
  className?: string;
}) {
  return (
    <img
      src={previewUrl}
      alt={alt}
      style={{ transform: `rotate(${rotationDegrees}deg)` }}
      className={cn("max-h-full max-w-full object-contain", className)}
    />
  );
}
