/**
 * The seam between application code and Google Drive (Phase 6, `docs/GOOGLE_INTEGRATION.md`)
 * — nothing outside this file and its concrete implementation (`googleDriveProvider.ts`)
 * knows Drive's REST shapes, OAuth mechanics, or resumable-upload protocol. This mirrors
 * `src/lib/embeddings/provider.ts`'s exact split (interface + error type here, one concrete
 * class in its own file, one server-only factory in `index.ts`) — a pattern already
 * established and proven in this codebase, reused deliberately rather than invented anew.
 *
 * This provider exists to store SOURCE/ORIGINAL cover photographs — never a general-purpose
 * cloud-storage abstraction. See `docs/GOOGLE_INTEGRATION.md` for why Drive is not the
 * catalog's canonical database and never serves images directly to Find/Book Detail.
 */

/**
 * Every Drive/OAuth failure this provider can produce, normalized to one of these
 * categories — teacher-facing code (none exists yet; Phase 7+) can translate a category
 * into a calm message without ever seeing a raw Google response body or HTTP status.
 */
export type DriveErrorCategory =
  | "configuration_missing"
  | "authorization_required"
  | "authorization_revoked_or_invalid"
  | "permission_denied"
  | "root_folder_missing"
  | "file_not_found"
  | "outside_configured_root"
  | "invalid_file"
  | "rate_limited"
  | "transient_provider_failure"
  | "upload_failed"
  | "download_failed"
  | "unexpected_provider_failure";

/**
 * The one error type every provider method throws. A single class with a `category`
 * discriminant (rather than thirteen subclasses, unlike `embeddings/provider.ts`'s three)
 * — thirteen distinct classes would be more ceremony than clarity at this size; a
 * `category` field is just as narrowable (`error.category === "rate_limited"`) and keeps
 * the error-mapping table (`googleDriveProvider.ts`'s `mapDriveHttpError`) in one place.
 *
 * `message` must never contain a secret (token, client secret, authorization code) or a
 * raw Google response body — see that file's own comment and
 * `tests/unit/googleDrive/googleDriveProvider.test.ts` / `oauthClient.test.ts`'s
 * secret-safety assertions.
 */
export class DriveProviderError extends Error {
  constructor(readonly category: DriveErrorCategory, message: string, readonly cause?: unknown) {
    super(message);
    this.name = "DriveProviderError";
  }
}

/**
 * Normalized Drive file/folder metadata — only what Phase 6+ genuinely needs (§13 of the
 * phase brief), never Google's full raw file resource. `id` is the durable identity; a
 * rename changes `name`, never `id`. `size`/`md5Checksum`/`driveId` are `null`/`undefined`
 * when Google doesn't supply them (folders have no size or checksum; a My Drive file has
 * no `driveId`) — never fabricated.
 */
export interface DriveFileMetadata {
  id: string;
  name: string;
  mimeType: string;
  size: number | null;
  createdTime: string;
  modifiedTime: string;
  parents: string[];
  isFolder: boolean;
  trashed: boolean;
  /** Present only when this file lives in a Shared Drive. */
  driveId?: string;
  /** Present only when Google supplies one (binary files; not every file type). */
  md5Checksum?: string;
  capabilities: {
    canDownload: boolean;
    canAddChildren: boolean;
    canTrash: boolean;
  };
}

export interface DriveListResult {
  files: DriveFileMetadata[];
  /** Present when more results exist beyond this page — pass back to `listChildren`. */
  nextPageToken?: string;
}

/** Result of `verifyConnection()` — safe to log/print/return from a CLI command; never
 * contains a token or other secret. */
export interface DriveConnectionStatus {
  connected: boolean;
  rootFolderId: string;
  rootFolderName: string;
  rootIsFolder: boolean;
  rootTrashed: boolean;
  rootIsSharedDrive: boolean;
  sharedDriveId?: string;
  /** Whether the authorized account can create children under the root — a prerequisite
   * for `initiateResumableUpload` ever succeeding there. */
  canCreateChildren: boolean;
  checkedAt: string;
}

export interface InitiateResumableUploadParams {
  parentFolderId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

/**
 * `sessionUri` is Google's resumable-upload session URL — sensitive ephemeral capability
 * data (§19/§28 of the phase brief). Never log it, persist it beyond the immediate upload,
 * put it in analytics, or include it in an error message. It is the ONE Google credential
 * ever allowed to cross the server/browser boundary in the future Phase 7 upload flow —
 * everything else (OAuth tokens, client secret) never leaves the server.
 */
export interface ResumableUploadSession {
  sessionUri: string;
  parentFolderId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

export interface ConfirmUploadedFileParams {
  fileId: string;
  expectedParentFolderId: string;
  expectedFilename: string;
  expectedMimeType: string;
  expectedSizeBytes: number;
}

/**
 * The narrow boundary all Drive access goes through — see `docs/GOOGLE_INTEGRATION.md`
 * for the full architecture. Every method is scoped to the configured
 * `GOOGLE_DRIVE_ROOT_FOLDER_ID` or a proven descendant; nothing here can reach an
 * arbitrary Drive ID merely because the authorized account happens to have access to it.
 */
export interface CoverStorageProvider {
  /** Confirms the OAuth credential, the configured root, and basic write capability —
   * the one call a CLI/smoke test needs to answer "is this infrastructure healthy?" */
  verifyConnection(): Promise<DriveConnectionStatus>;

  /** Non-recursive, bounded, paginated listing of a folder's immediate non-trashed
   * children. `folderId` must be the configured root or a proven descendant. */
  listChildren(folderId: string, options?: { pageSize?: number; pageToken?: string }): Promise<DriveListResult>;

  /** Fetches one file/folder's normalized metadata by its durable Drive ID. Enforces root
   * containment itself (2026-09-20 correction pass) — `fileId` must resolve to the
   * configured root or a real descendant of it, or this throws `outside_configured_root`.
   * This is the one place `CoverStorageProvider` reads a Drive file's metadata; it is never
   * an escape hatch for an ID outside the configured boundary, no matter what the
   * authorized OAuth account can otherwise access. */
  getFileMetadata(fileId: string): Promise<DriveFileMetadata>;

  /** Downloads a file's raw bytes. `fileId` must resolve within the configured root, must
   * not be a folder, must not be trashed, and the account must have download capability. */
  downloadSource(fileId: string): Promise<{ bytes: Buffer; metadata: DriveFileMetadata }>;

  /** Begins a Drive resumable upload session for a new file under a verified parent
   * folder. Returns the session URI for the browser (Phase 7) to upload bytes directly to
   * — this method never transfers the image bytes itself (§20 of the phase brief). */
  initiateResumableUpload(params: InitiateResumableUploadParams): Promise<ResumableUploadSession>;

  /** Re-fetches the resulting file from Drive (never trusts browser-supplied metadata) and
   * verifies it matches every expected field before the caller may treat the upload as
   * genuinely complete. */
  confirmUploadedFile(params: ConfirmUploadedFileParams): Promise<DriveFileMetadata>;

  /** Test/smoke-test-only cleanup — trashes (never permanently deletes) exactly the given
   * file ID. Callers (the smoke test) must independently verify the ID is their own
   * disposable test asset, within the configured root, before calling this — this method
   * itself only enforces root containment, not "is this actually a smoke-test file." */
  trashFile(fileId: string): Promise<void>;
}
