/**
 * The one place a File's bytes are ever sent from the browser — to this
 * application's own same-origin upload endpoint (`/api/intake/cover`), which then
 * relays the bytes to Google Drive server-side.
 *
 * **Architecture correction, documented in `docs/DECISIONS.md`**: §11 of the Phase 7
 * brief specified a direct browser→Drive PUT, approved from Phase 6. Real
 * Playwright/Chromium testing against the live Drive API during Phase 7
 * implementation proved that architecture structurally impossible: Google's
 * resumable-upload CORS behavior is bound to the `Origin` header present at
 * SESSION-CREATION time, that request is necessarily made server-side (no real
 * browser `Origin`), and Drive's own upload docs expose no CORS configuration
 * surface at all (unlike Cloud Storage buckets). A real browser PUT to a
 * server-created session is unconditionally blocked by CORS — confirmed live,
 * not assumed. See `docs/DECISIONS.md` for the full evidence.
 *
 * This keeps every security property §11 actually cared about — Drive OAuth
 * tokens/client secret never reach the browser, the browser never talks to Drive
 * directly — while fixing the one specific mechanic that didn't survive contact
 * with a real browser.
 *
 * Still uses `XMLHttpRequest`, not `fetch`, specifically for real upload progress
 * (`xhr.upload.onprogress`) — now measuring the browser→server leg, which is the
 * one the teacher is actually waiting on over their own network connection.
 */

export interface UploadProgressEvent {
  loadedBytes: number;
  totalBytes: number;
}

export interface UploadedCoverResult {
  ingestionItemId: string;
}

export class UploadToSessionError extends Error {
  constructor(
    readonly status: number | undefined,
    message: string,
    readonly category?: string
  ) {
    super(message);
    this.name = "UploadToSessionError";
  }
}

/**
 * POSTs `file`'s raw bytes to `/api/intake/cover`, which validates, uploads to
 * Drive, confirms the result, and creates the ingestion job/item row — resolving
 * with the new ingestion item id ready for the identify/lookup/duplicate/enrich
 * steps.
 */
export function uploadCover(file: File, onProgress?: (event: UploadProgressEvent) => void): Promise<UploadedCoverResult> {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({
      filename: file.name,
      mimeType: file.type,
      sizeBytes: String(file.size),
    });

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/intake/cover?${params.toString()}`, true);
    xhr.setRequestHeader("Content-Type", file.type);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress?.({ loadedBytes: event.loaded, totalBytes: event.total });
      }
    };

    xhr.onload = () => {
      let body: { ok?: boolean; ingestionItemId?: string; category?: string; message?: string };
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        reject(new UploadToSessionError(xhr.status, "The upload response could not be read."));
        return;
      }
      if (xhr.status < 200 || xhr.status >= 300 || !body.ok || !body.ingestionItemId) {
        reject(new UploadToSessionError(xhr.status, body.message ?? "The upload did not complete successfully.", body.category));
        return;
      }
      resolve({ ingestionItemId: body.ingestionItemId });
    };

    xhr.onerror = () => reject(new UploadToSessionError(undefined, "A network error interrupted the upload."));
    xhr.onabort = () => reject(new UploadToSessionError(undefined, "The upload was cancelled."));

    xhr.send(file);
  });
}
