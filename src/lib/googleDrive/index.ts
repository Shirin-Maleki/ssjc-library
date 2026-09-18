import "server-only";
import { GoogleDriveCoverStorageProvider } from "./googleDriveProvider";
import { isDriveConfigured } from "./config";
import type { CoverStorageProvider } from "./provider";

export type {
  CoverStorageProvider,
  DriveConnectionStatus,
  DriveErrorCategory,
  DriveFileMetadata,
  DriveListResult,
  ConfirmUploadedFileParams,
  InitiateResumableUploadParams,
  ResumableUploadSession,
} from "./provider";
export { DriveProviderError } from "./provider";
export { isDriveConfigured } from "./config";
export {
  ALLOWED_SOURCE_COVER_MIME_TYPES,
  MAX_SOURCE_COVER_SIZE_BYTES,
  isAllowedSourceCoverMimeType,
  isValidSourceCoverSize,
} from "./validation";

/**
 * The one place production code decides whether/how to construct a real Drive provider —
 * never imported by a Client Component (`import "server-only"` makes that a build error).
 * Exactly mirrors `src/lib/embeddings/index.ts`'s `getConfiguredEmbeddingProvider()`:
 * returns `undefined`, never throws, when the four Phase 6 environment variables aren't
 * all configured — "Drive not set up yet" is a normal, expected state during development,
 * not an error condition. No production code path (Find, Book Detail, Reading Lists)
 * currently calls this at all; it exists for Phase 7+ server-side actions and the
 * `google:smoke` CLI command.
 */
export function getConfiguredCoverStorageProvider(): CoverStorageProvider | undefined {
  if (!isDriveConfigured()) return undefined;
  try {
    return new GoogleDriveCoverStorageProvider();
  } catch {
    return undefined;
  }
}
