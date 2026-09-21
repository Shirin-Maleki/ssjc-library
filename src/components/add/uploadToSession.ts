/**
 * The one place a File's bytes are ever sent — directly to Google's resumable
 * upload session URI, never through this application's own server (Phase 7, §11 of
 * the phase brief: "the intended upload architecture is already approved... First
 * test the intended direct browser upload in a real browser"). Pure browser logic,
 * independent of React, so it's testable without mounting a component.
 *
 * Uses `XMLHttpRequest`, not `fetch`, specifically because it gives real upload
 * progress events (`xhr.upload.onprogress`) — §11 explicitly allows a real progress
 * indicator "if direct XHR upload gives real byte progress," and forbids a faked
 * percentage otherwise. `fetch`'s request-body streaming has no equivalent
 * cross-browser progress signal as of this codebase's target runtime.
 */

export interface UploadProgressEvent {
  loadedBytes: number;
  totalBytes: number;
}

export interface UploadedFileResult {
  /** The real Drive file id Google returned directly in the upload response body —
   * still independently re-confirmed server-side via `confirmUploadAction` before
   * this application ever trusts it (§11: "Do not trust a browser-supplied Drive ID
   * without server confirmation"). */
  driveFileId: string;
}

export class UploadToSessionError extends Error {
  constructor(readonly status: number | undefined, message: string) {
    super(message);
    this.name = "UploadToSessionError";
  }
}

/**
 * PUTs `file`'s bytes to `sessionUri` (a Google Drive resumable upload session,
 * obtained from `initiateUploadAction` and never persisted beyond this one call).
 * Resolves with the resulting Drive file id from Google's own response body.
 */
export function uploadToSession(sessionUri: string, file: File, onProgress?: (event: UploadProgressEvent) => void): Promise<UploadedFileResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", sessionUri, true);
    xhr.setRequestHeader("Content-Type", file.type);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress?.({ loadedBytes: event.loaded, totalBytes: event.total });
      }
    };

    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new UploadToSessionError(xhr.status, "The upload did not complete successfully."));
        return;
      }
      try {
        const body = JSON.parse(xhr.responseText) as { id?: string };
        if (!body.id) {
          reject(new UploadToSessionError(xhr.status, "The upload response did not include a file id."));
          return;
        }
        resolve({ driveFileId: body.id });
      } catch {
        reject(new UploadToSessionError(xhr.status, "The upload response could not be read."));
      }
    };

    xhr.onerror = () => reject(new UploadToSessionError(undefined, "A network error interrupted the upload."));
    xhr.onabort = () => reject(new UploadToSessionError(undefined, "The upload was cancelled."));

    xhr.send(file);
  });
}
