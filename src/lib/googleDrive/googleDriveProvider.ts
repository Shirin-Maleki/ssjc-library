import {
  DriveProviderError,
  type CoverStorageProvider,
  type DriveConnectionStatus,
  type DriveErrorCategory,
  type DriveFileMetadata,
  type DriveListResult,
  type ConfirmUploadedFileParams,
  type InitiateResumableUploadParams,
  type ResumableUploadSession,
} from "./provider";
import { loadDriveConfig } from "./config";
import { getAccessToken } from "./oauthClient";
import { fetchWithRetry } from "./retry";
import { isWithinRoot } from "./rootContainment";
import { isAllowedSourceCoverMimeType, isValidSourceCoverSize, normalizeUploadFilename, MAX_SOURCE_COVER_SIZE_BYTES } from "./validation";

/**
 * The concrete Google Drive implementation of `CoverStorageProvider` (Phase 6, §12 of the
 * phase brief). Every Drive REST call, OAuth header, and root-containment check lives here
 * — nothing outside this file speaks Drive's wire format. Deliberately NOT
 * `import "server-only"` for the same reason as `oauthClient.ts` (this class must be
 * directly constructible in mocked unit tests); the real production guard is
 * `src/lib/googleDrive/index.ts`.
 *
 * FOLDER_MIME_TYPE / API_BASE / UPLOAD_API_BASE are Drive API v3 constants, not
 * configuration — see `docs/GOOGLE_INTEGRATION.md` for the full request shapes.
 */

const API_BASE = "https://www.googleapis.com/drive/v3";
const UPLOAD_API_BASE = "https://www.googleapis.com/upload/drive/v3";
const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";

const METADATA_FIELDS =
  "id,name,mimeType,size,createdTime,modifiedTime,parents,trashed,driveId,md5Checksum,capabilities(canDownload,canAddChildren,canTrash)";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

interface RawDriveFileResource {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  createdTime: string;
  modifiedTime: string;
  parents?: string[];
  trashed?: boolean;
  driveId?: string;
  md5Checksum?: string;
  capabilities?: { canDownload?: boolean; canAddChildren?: boolean; canTrash?: boolean };
}

function normalizeMetadata(raw: RawDriveFileResource): DriveFileMetadata {
  return {
    id: raw.id,
    name: raw.name,
    mimeType: raw.mimeType,
    size: raw.size != null ? Number(raw.size) : null,
    createdTime: raw.createdTime,
    modifiedTime: raw.modifiedTime,
    parents: raw.parents ?? [],
    isFolder: raw.mimeType === FOLDER_MIME_TYPE,
    trashed: raw.trashed ?? false,
    driveId: raw.driveId,
    md5Checksum: raw.md5Checksum,
    capabilities: {
      canDownload: raw.capabilities?.canDownload ?? false,
      canAddChildren: raw.capabilities?.canAddChildren ?? false,
      canTrash: raw.capabilities?.canTrash ?? false,
    },
  };
}

/** Escapes a value for interpolation into a Drive `q` query-string literal (single-quote
 * delimited) — Drive IDs are alphanumeric/`-`/`_` in practice, but this never trusts that. */
function escapeDriveQueryValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/**
 * Maps a failed Drive HTTP response to a category. Drains the body (so the connection can
 * be reused) but never includes it in the thrown message — a Drive error body can echo
 * request details that don't belong in a normalized, teacher-safe error, and per §26 of the
 * phase brief must never reach a thrown message at all. `fallbackCategory` lets a specific
 * operation (upload, download) prefer its own category over the generic
 * `unexpected_provider_failure` for a status code with no more specific mapping.
 */
async function mapDriveHttpError(
  response: Response,
  context: string,
  fallbackCategory: DriveErrorCategory = "unexpected_provider_failure"
): Promise<DriveProviderError> {
  try {
    await response.text();
  } catch {
    // Draining failure is irrelevant to error classification.
  }
  switch (response.status) {
    case 401:
      return new DriveProviderError("authorization_required", `Google rejected the request as unauthorized (${context}).`);
    case 403:
      return new DriveProviderError(
        "permission_denied",
        `The authorized Drive account lacks permission for this operation (${context}).`
      );
    case 404:
      return new DriveProviderError("file_not_found", `Google reported the requested file/folder does not exist (${context}).`);
    case 429:
      return new DriveProviderError("rate_limited", `Google rate-limited this request (${context}).`);
    case 500:
    case 502:
    case 503:
    case 504:
      return new DriveProviderError(
        "transient_provider_failure",
        `Google's Drive API returned a transient error (HTTP ${response.status}, ${context}).`
      );
    default:
      return new DriveProviderError(fallbackCategory, `Google's Drive API returned HTTP ${response.status} (${context}).`);
  }
}

export class GoogleDriveCoverStorageProvider implements CoverStorageProvider {
  private readonly rootFolderId: string;

  constructor() {
    this.rootFolderId = loadDriveConfig().rootFolderId;
  }

  private async authorizedFetch(url: string, init: RequestInit = {}): Promise<Response> {
    const accessToken = await getAccessToken();
    return fetchWithRetry(url, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${accessToken}` },
    });
  }

  /**
   * The raw, UNSCOPED Drive metadata fetch — private on purpose. This is the only place
   * that calls Drive's `files.get` without any root-containment check, and it exists
   * specifically for the two internal callers that legitimately need metadata *before* (or
   * independent of) establishing containment: `verifyConnection()` (fetching the configured
   * root's own metadata — checking that root for containment *against itself* would be a
   * circular, pointless check, not a real security gate) and the public `getFileMetadata()`
   * below (which performs the real fetch here, then checks containment before returning
   * anything to the caller). Nothing else in this class — and nothing outside it, since this
   * is private — may use this to read metadata for an arbitrary Drive ID without a
   * containment check somewhere in the call path.
   */
  private async fetchRawMetadata(fileId: string): Promise<DriveFileMetadata> {
    const url = `${API_BASE}/files/${encodeURIComponent(fileId)}?fields=${encodeURIComponent(METADATA_FIELDS)}&supportsAllDrives=true`;
    const response = await this.authorizedFetch(url);
    if (!response.ok) throw await mapDriveHttpError(response, `getFileMetadata(${fileId})`);
    const raw = (await response.json()) as RawDriveFileResource;
    return normalizeMetadata(raw);
  }

  /**
   * The PUBLIC metadata lookup — the only one `CoverStorageProvider` exposes. Fetches via
   * `fetchRawMetadata`, then enforces root containment before ever returning the result:
   * an arbitrary Drive ID the OAuth account can technically access, but which isn't the
   * configured root or a real descendant of it, is rejected with `outside_configured_root`
   * rather than silently handed back. This is a real security fix (2026-09-20 correction
   * pass) — the previous version of this method had no containment check at all, making it
   * a genuine escape hatch for arbitrary Drive metadata access despite every *other*
   * provider method enforcing the boundary. See `docs/GOOGLE_INTEGRATION.md`,
   * "Root-folder security boundary."
   */
  async getFileMetadata(fileId: string): Promise<DriveFileMetadata> {
    const metadata = await this.fetchRawMetadata(fileId);
    await this.assertMetadataWithinRoot(metadata);
    return metadata;
  }

  /** Returns `fileId`'s immediate parent IDs for the root-containment walk, or `null` when
   * the ID doesn't exist or isn't accessible (a dead end for that branch, not an error —
   * see `rootContainment.ts`). A genuine transient/server failure still throws: containment
   * is a security boundary, so an ambiguous "can't tell" result fails closed by propagating
   * the error rather than silently treating it as "not contained" or "contained." */
  private async getParentsForContainment(fileId: string): Promise<string[] | null> {
    const url = `${API_BASE}/files/${encodeURIComponent(fileId)}?fields=parents&supportsAllDrives=true`;
    const response = await this.authorizedFetch(url);
    if (response.status === 404 || response.status === 403) return null;
    if (!response.ok) throw await mapDriveHttpError(response, `getParentsForContainment(${fileId})`);
    const body = (await response.json()) as { parents?: string[] };
    return body.parents ?? [];
  }

  private async assertWithinRoot(candidateId: string): Promise<void> {
    const contained = await isWithinRoot(candidateId, this.rootFolderId, (id) => this.getParentsForContainment(id));
    if (!contained) {
      throw new DriveProviderError(
        "outside_configured_root",
        "The requested folder/file is not within the configured Drive root."
      );
    }
  }

  /**
   * Same containment check as `assertWithinRoot`, but starting from a `DriveFileMetadata`
   * already in hand (from a `getFileMetadata` call the caller made anyway for other
   * reasons) — avoids a redundant re-fetch of the same file's own parents purely to begin
   * a walk that already has them. Only the ancestors beyond the file's immediate parents
   * need their own fetch, exactly as `assertWithinRoot` would eventually need for any
   * candidate that isn't itself a direct child of the root.
   */
  private async assertMetadataWithinRoot(metadata: DriveFileMetadata): Promise<void> {
    if (metadata.id === this.rootFolderId || metadata.parents.includes(this.rootFolderId)) return;
    for (const parentId of metadata.parents) {
      if (await isWithinRoot(parentId, this.rootFolderId, (id) => this.getParentsForContainment(id))) return;
    }
    throw new DriveProviderError(
      "outside_configured_root",
      "The requested folder/file is not within the configured Drive root."
    );
  }

  async verifyConnection(): Promise<DriveConnectionStatus> {
    let metadata: DriveFileMetadata;
    try {
      // The raw fetch, not the public `getFileMetadata` — this call IS how the root's own
      // validity gets established, so checking the root's containment against itself here
      // would be circular (and, since `assertMetadataWithinRoot` already short-circuits
      // `metadata.id === this.rootFolderId`, functionally a no-op) rather than a real gate.
      metadata = await this.fetchRawMetadata(this.rootFolderId);
    } catch (error) {
      if (error instanceof DriveProviderError && error.category === "file_not_found") {
        throw new DriveProviderError(
          "root_folder_missing",
          "The configured GOOGLE_DRIVE_ROOT_FOLDER_ID does not exist or is not accessible to the authorized account."
        );
      }
      throw error;
    }

    if (metadata.trashed) {
      throw new DriveProviderError("root_folder_missing", "The configured root folder is trashed.");
    }
    if (!metadata.isFolder) {
      throw new DriveProviderError("root_folder_missing", "The configured GOOGLE_DRIVE_ROOT_FOLDER_ID does not refer to a Drive folder.");
    }

    return {
      connected: true,
      rootFolderId: metadata.id,
      rootFolderName: metadata.name,
      rootIsFolder: metadata.isFolder,
      rootTrashed: metadata.trashed,
      rootIsSharedDrive: Boolean(metadata.driveId),
      sharedDriveId: metadata.driveId,
      canCreateChildren: metadata.capabilities.canAddChildren,
      checkedAt: new Date().toISOString(),
    };
  }

  async listChildren(folderId: string, options: { pageSize?: number; pageToken?: string } = {}): Promise<DriveListResult> {
    await this.assertWithinRoot(folderId);

    const pageSize = Math.min(Math.max(1, options.pageSize ?? DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
    const params = new URLSearchParams({
      q: `'${escapeDriveQueryValue(folderId)}' in parents and trashed = false`,
      fields: `nextPageToken, files(${METADATA_FIELDS})`,
      pageSize: String(pageSize),
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
    });
    if (options.pageToken) params.set("pageToken", options.pageToken);

    const url = `${API_BASE}/files?${params.toString()}`;
    const response = await this.authorizedFetch(url);
    if (!response.ok) throw await mapDriveHttpError(response, `listChildren(${folderId})`);

    const body = (await response.json()) as { files?: RawDriveFileResource[]; nextPageToken?: string };
    return {
      files: (body.files ?? []).map(normalizeMetadata),
      nextPageToken: body.nextPageToken,
    };
  }

  async downloadSource(fileId: string): Promise<{ bytes: Buffer; metadata: DriveFileMetadata }> {
    // The public getFileMetadata already enforces root containment — no separate call needed.
    const metadata = await this.getFileMetadata(fileId);
    if (metadata.isFolder) throw new DriveProviderError("invalid_file", "Cannot download a folder as a source file.");
    if (metadata.trashed) throw new DriveProviderError("file_not_found", "The requested file is trashed.");
    if (!metadata.capabilities.canDownload) {
      throw new DriveProviderError("permission_denied", "The authorized Drive account cannot download this file.");
    }

    const url = `${API_BASE}/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`;
    const response = await this.authorizedFetch(url);
    if (!response.ok) throw await mapDriveHttpError(response, `downloadSource(${fileId})`, "download_failed");

    const arrayBuffer = await response.arrayBuffer();
    return { bytes: Buffer.from(arrayBuffer), metadata };
  }

  async initiateResumableUpload(params: InitiateResumableUploadParams): Promise<ResumableUploadSession> {
    if (!isAllowedSourceCoverMimeType(params.mimeType)) {
      throw new DriveProviderError("invalid_file", `Unsupported source-cover MIME type: ${params.mimeType}.`);
    }
    if (!isValidSourceCoverSize(params.sizeBytes)) {
      throw new DriveProviderError(
        "invalid_file",
        `Declared file size (${params.sizeBytes} bytes) is invalid or exceeds the ${MAX_SOURCE_COVER_SIZE_BYTES}-byte limit.`
      );
    }
    const filename = normalizeUploadFilename(params.filename);

    // The public getFileMetadata already enforces root containment — no separate call needed.
    const parent = await this.getFileMetadata(params.parentFolderId);
    if (!parent.isFolder) throw new DriveProviderError("invalid_file", "The target parent is not a Drive folder.");
    if (parent.trashed) throw new DriveProviderError("invalid_file", "The target parent folder is trashed.");
    if (!parent.capabilities.canAddChildren) {
      throw new DriveProviderError("permission_denied", "The authorized Drive account cannot create files in the target folder.");
    }

    const url = `${UPLOAD_API_BASE}/files?uploadType=resumable&supportsAllDrives=true`;
    const response = await this.authorizedFetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": params.mimeType,
        "X-Upload-Content-Length": String(params.sizeBytes),
      },
      body: JSON.stringify({ name: filename, mimeType: params.mimeType, parents: [params.parentFolderId] }),
    });
    if (!response.ok) throw await mapDriveHttpError(response, "initiateResumableUpload", "upload_failed");

    const sessionUri = response.headers.get("Location");
    if (!sessionUri) {
      throw new DriveProviderError("upload_failed", "Google did not return a resumable upload session URI.");
    }

    return { sessionUri, parentFolderId: params.parentFolderId, filename, mimeType: params.mimeType, sizeBytes: params.sizeBytes };
  }

  async confirmUploadedFile(params: ConfirmUploadedFileParams): Promise<DriveFileMetadata> {
    // Always re-fetched from Drive — never trusts browser/caller-supplied metadata (§21).
    // The public getFileMetadata already enforces root containment — no separate call needed.
    const metadata = await this.getFileMetadata(params.fileId);

    if (metadata.trashed) throw new DriveProviderError("upload_failed", "The uploaded file is trashed.");

    if (!metadata.parents.includes(params.expectedParentFolderId)) {
      throw new DriveProviderError("upload_failed", "The uploaded file's parent does not match the expected target folder.");
    }
    if (metadata.mimeType !== params.expectedMimeType) {
      throw new DriveProviderError("upload_failed", "The uploaded file's MIME type does not match what was declared.");
    }
    if (metadata.size !== params.expectedSizeBytes) {
      throw new DriveProviderError("upload_failed", "The uploaded file's size does not match what was declared.");
    }
    if (metadata.name !== params.expectedFilename) {
      throw new DriveProviderError("upload_failed", "The uploaded file's name does not match the intended normalized filename.");
    }

    return metadata;
  }

  async trashFile(fileId: string): Promise<void> {
    await this.assertWithinRoot(fileId);
    const url = `${API_BASE}/files/${encodeURIComponent(fileId)}?supportsAllDrives=true`;
    const response = await this.authorizedFetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trashed: true }),
    });
    if (!response.ok) throw await mapDriveHttpError(response, `trashFile(${fileId})`);
  }
}
