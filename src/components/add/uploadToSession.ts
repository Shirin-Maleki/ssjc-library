/**
 * The one place a File's bytes are ever sent from the browser — in
 * <=4 MiB chunks to this application's own same-origin endpoints
 * (`/api/intake/cover/init` then repeated `/api/intake/cover/chunk` calls),
 * which relay each chunk to Google Drive server-side.
 *
 * **Two architecture corrections, both documented in `docs/DECISIONS.md`.**
 * §11 of the Phase 7 brief specified a direct browser→Drive PUT (Phase
 * 6-approved); real Chromium testing proved that structurally impossible —
 * Google's resumable-upload CORS behavior is bound to the `Origin` present at
 * session-creation time, which is necessarily server-side here. The first
 * correction made the upload server-mediated but still single-request. A
 * Phase 7 correction pass then found that single request itself would exceed
 * Vercel's real 4.5 MB serverless Function request-body limit for any source
 * cover over that size — a real deployment-blocking gap, since this pipeline
 * allows up to 25 MiB and real validation covers already included files
 * larger than 4.5 MB. This is the second correction: the same server-mediated
 * relay, now chunked, so no individual request the app's own server has to
 * accept ever exceeds Vercel's limit, while Drive still receives the
 * complete, unmodified original — never recompressed merely to fit a request
 * size.
 *
 * Still uses `XMLHttpRequest`, not `fetch`, for real upload progress
 * (`xhr.upload.onprogress`) within each chunk — combined with the byte offset
 * already confirmed, this gives real, continuous byte-based progress across
 * the whole file, not just within one chunk.
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

/** A chunk (or the empty-body status-check form) failed once — retried up to
 * this many times, each preceded by a real status query against Drive's
 * authoritative received-byte count (never a blind resend), before the whole
 * upload surfaces as a real, retryable error to the teacher. */
const MAX_CHUNK_ATTEMPTS = 3;

interface InitResponseBody {
  ok: boolean;
  uploadToken?: string;
  chunkSizeBytes?: number;
  message?: string;
  category?: string;
}

interface ChunkResponseBody {
  ok: boolean;
  done?: boolean;
  bytesReceived?: number;
  ingestionItemId?: string;
  message?: string;
  category?: string;
}

async function initUpload(file: File): Promise<{ uploadToken: string; chunkSizeBytes: number }> {
  const response = await fetch("/api/intake/cover/init", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename: file.name, mimeType: file.type, sizeBytes: file.size }),
  });
  let body: InitResponseBody;
  try {
    body = await response.json();
  } catch {
    throw new UploadToSessionError(response.status, "Couldn't start the upload. Please try again.");
  }
  if (!response.ok || !body.ok || !body.uploadToken || !body.chunkSizeBytes) {
    throw new UploadToSessionError(response.status, body.message ?? "Couldn't start the upload. Please try again.", body.category);
  }
  return { uploadToken: body.uploadToken, chunkSizeBytes: body.chunkSizeBytes };
}

/** One real HTTP PUT — either a genuine chunk (`start`/`end` given) or the
 * documented empty-body status-check form (`start`/`end` omitted). */
function putRange(
  uploadToken: string,
  body: Blob,
  contentRange: string,
  onChunkProgress?: (loadedBytes: number) => void
): Promise<ChunkResponseBody> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", `/api/intake/cover/chunk?token=${encodeURIComponent(uploadToken)}`, true);
    xhr.setRequestHeader("Content-Range", contentRange);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onChunkProgress?.(event.loaded);
    };

    xhr.onload = () => {
      let parsed: ChunkResponseBody;
      try {
        parsed = JSON.parse(xhr.responseText);
      } catch {
        reject(new UploadToSessionError(xhr.status, "The upload response could not be read."));
        return;
      }
      if (xhr.status < 200 || xhr.status >= 300 || !parsed.ok) {
        reject(new UploadToSessionError(xhr.status, parsed.message ?? "The upload did not complete successfully.", parsed.category));
        return;
      }
      resolve(parsed);
    };
    xhr.onerror = () => reject(new UploadToSessionError(undefined, "A network error interrupted the upload."));
    xhr.onabort = () => reject(new UploadToSessionError(undefined, "The upload was cancelled."));

    xhr.send(body);
  });
}

/** After a failed chunk attempt, resync with Drive's own authoritative
 * received-byte count rather than assuming the failed request's bytes were —
 * or weren't — received server-side (Google's own documented guidance). */
function queryStatus(uploadToken: string, totalBytes: number): Promise<ChunkResponseBody> {
  return putRange(uploadToken, new Blob([]), `bytes */${totalBytes}`);
}

/** Pure, directly testable: the end offset (exclusive) of the next chunk given
 * how much has been confirmed so far. Never exceeds `chunkSizeBytes` for a
 * single chunk — this is the one place that guarantee is enforced client-side
 * (the server independently re-enforces it too, defense in depth). */
export function nextChunkEnd(offset: number, totalSizeBytes: number, chunkSizeBytes: number): number {
  return Math.min(offset + chunkSizeBytes, totalSizeBytes);
}

export function uploadCover(file: File, onProgress?: (event: UploadProgressEvent) => void): Promise<UploadedCoverResult> {
  return (async () => {
    const { uploadToken, chunkSizeBytes } = await initUpload(file);

    let offset = 0;
    let attempt = 0;
    while (offset < file.size) {
      const end = nextChunkEnd(offset, file.size, chunkSizeBytes);
      try {
        const result = await putRange(uploadToken, file.slice(offset, end), `bytes ${offset}-${end - 1}/${file.size}`, (loaded) => {
          onProgress?.({ loadedBytes: offset + loaded, totalBytes: file.size });
        });
        if (result.done && result.ingestionItemId) {
          return { ingestionItemId: result.ingestionItemId };
        }
        offset = result.bytesReceived ?? end;
        attempt = 0;
      } catch (error) {
        attempt += 1;
        if (attempt > MAX_CHUNK_ATTEMPTS) {
          throw error instanceof UploadToSessionError ? error : new UploadToSessionError(undefined, "A network error interrupted the upload.");
        }
        const status = await queryStatus(uploadToken, file.size).catch(() => null);
        if (status?.done && status.ingestionItemId) {
          return { ingestionItemId: status.ingestionItemId };
        }
        offset = status?.bytesReceived ?? offset;
      }
    }
    throw new UploadToSessionError(undefined, "The upload did not complete.");
  })();
}
