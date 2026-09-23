import { DriveProviderError } from "@/lib/googleDrive/provider";

/**
 * Phase 9's own, deliberately SEPARATE root-folder configuration from Phase 6's
 * `GOOGLE_DRIVE_ROOT_FOLDER_ID` (`src/lib/googleDrive/config.ts`) — never the same
 * env var, never sharing a value in this environment. The real photographed
 * collection ("Scandi library books") was found, by direct inspection against the
 * live Drive account, to be the PARENT of the interactive Add-a-Book flow's own
 * configured root ("Corridor books" — the folder teacher uploads land in): the
 * real structure is `Scandi library books` → `Corridor books` → {photographer
 * subfolders} → image files. Widening `GOOGLE_DRIVE_ROOT_FOLDER_ID` itself to the
 * broader folder would have been a strictly-widening, technically-safe change (see
 * `GoogleDriveCoverStorageProvider`'s root-containment check), but it would still
 * quietly expand the security boundary every *other* Drive operation (teacher
 * uploads, source-cover proxying) is checked against, for a need that is entirely
 * the bulk importer's own. A second, explicit, separately-configured root keeps
 * the interactive flow's boundary exactly as narrow as it already was.
 */
export interface BulkImportDriveConfig {
  rootFolderId: string;
}

const REQUIRED_VAR = "GOOGLE_DRIVE_BULK_IMPORT_ROOT_FOLDER_ID";

/** Throws `DriveProviderError("configuration_missing", …)` — naming only the
 * variable name, never a value or a hint about what a real value looks like,
 * exactly matching `googleDrive/config.ts`'s `loadDriveConfig()` convention. */
export function loadBulkImportDriveConfig(): BulkImportDriveConfig {
  const rootFolderId = process.env[REQUIRED_VAR]?.trim();
  if (!rootFolderId) {
    throw new DriveProviderError(
      "configuration_missing",
      `Missing required environment variable: ${REQUIRED_VAR}. This is the bulk importer's own source folder root, deliberately separate from GOOGLE_DRIVE_ROOT_FOLDER_ID — see docs/BULK_IMPORT.md.`
    );
  }
  return { rootFolderId };
}

export function isBulkImportDriveConfigured(): boolean {
  return Boolean(process.env[REQUIRED_VAR]?.trim());
}
