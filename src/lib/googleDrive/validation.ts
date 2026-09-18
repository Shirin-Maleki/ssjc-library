import { DriveProviderError } from "./provider";

/**
 * Source-cover storage validation (Phase 6, `docs/GOOGLE_INTEGRATION.md`). This governs
 * what Drive will *store* as an original/source cover photograph — a separate concern from
 * what a later AI/image-processing provider can *decode* (§23 of the phase brief). Do not
 * assume every format listed here is universally supported downstream; that is a future
 * phase's decision, documented separately when it's made.
 */
export const ALLOWED_SOURCE_COVER_MIME_TYPES: ReadonlySet<string> = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

export function isAllowedSourceCoverMimeType(mimeType: string): boolean {
  return ALLOWED_SOURCE_COVER_MIME_TYPES.has(mimeType);
}

/**
 * 25 MiB — intentionally much larger than a normal compressed phone photo, but bounded
 * against an absurd upload. A documented, single source of truth; not teacher-facing
 * validation UI (that's Phase 7's concern, if it chooses to surface this before upload).
 */
export const MAX_SOURCE_COVER_SIZE_BYTES = 25 * 1024 * 1024;

export function isValidSourceCoverSize(sizeBytes: number): boolean {
  return Number.isFinite(sizeBytes) && sizeBytes > 0 && sizeBytes <= MAX_SOURCE_COVER_SIZE_BYTES;
}

/**
 * Prevents a path-like or control-character-laden name from ever reaching Drive's
 * `files.create` metadata (Drive itself doesn't interpret `/` as a path separator inside a
 * filename, but a name containing one is confusing/unsafe to display and to reconstruct a
 * local path from later). Strips path separators, null bytes, and other control characters;
 * collapses runs of whitespace; trims. Never renames an *existing* photo — this only applies
 * to filenames this application itself is about to create (§22 of the phase brief).
 *
 * Throws `DriveProviderError("invalid_file", …)` if nothing usable survives normalization
 * (e.g. a name that was entirely path separators/control characters), rather than silently
 * falling back to a synthetic name that would hide a genuinely bad caller input.
 */
export function normalizeUploadFilename(filename: string): string {
  const stripped = filename
    .replace(/[/\\]/g, "-")
    .replace(/[\x00-\x1f\x7f]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (stripped.length === 0) {
    throw new DriveProviderError("invalid_file", "Filename is empty after normalization.");
  }
  return stripped;
}
