import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { ingestionItems, ingestionJobs } from "@/db/schema";
import { getSession } from "@/lib/auth/guards";
import {
  getConfiguredCoverStorageProvider,
  DriveProviderError,
  isAllowedSourceCoverMimeType,
  isValidSourceCoverSize,
  MAX_SOURCE_COVER_SIZE_BYTES,
} from "@/lib/googleDrive";
import { createInitialDraft } from "@/lib/intake/draft";
import { isE2EFakeProvidersEnabled } from "@/lib/intake/e2eFixtures";

export const runtime = "nodejs";

interface ConfirmedUpload {
  fileId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string | null;
}

async function createIngestionRecord(confirmed: ConfirmedUpload): Promise<string> {
  const [job] = await db
    .insert(ingestionJobs)
    .values({ jobType: "single_add", source: "teacher_capture", status: "running", totalItems: 1 })
    .returning({ id: ingestionJobs.id });
  const draft = createInitialDraft({
    fileId: confirmed.fileId,
    filename: confirmed.filename,
    mimeType: confirmed.mimeType,
    sizeBytes: confirmed.sizeBytes,
    checksum: confirmed.checksum,
  });
  const [item] = await db
    .insert(ingestionItems)
    .values({ jobId: job.id, driveFileId: confirmed.fileId, contentHash: confirmed.checksum, status: "processing", intakeDraft: draft })
    .returning({ id: ingestionItems.id });
  return item.id;
}

/**
 * Server-mediated cover upload — the corrected Phase 7 upload architecture.
 * `docs/DECISIONS.md` has the full record; short version: §11 of the phase brief
 * specified a direct browser→Drive PUT (Phase 6-approved), but real
 * Playwright/Chromium testing against the live Drive API during Phase 7
 * implementation proved that structurally impossible — Google's resumable-upload
 * CORS behavior is bound to the `Origin` header present at SESSION-CREATION time
 * (confirmed against Google's own Cloud Storage resumable-upload docs; Drive's own
 * upload docs expose no CORS configuration surface at all), and that request is
 * necessarily made server-side with no real browser origin. A real browser PUT to
 * a server-created session is unconditionally blocked by CORS, reproduced live
 * against the real Drive API, not assumed.
 *
 * This is a Route Handler rather than a Server Action specifically because Server
 * Actions have no upload-progress events — the browser POSTs raw bytes here (real
 * `xhr.upload.onprogress` for that leg), and this handler relays them to Drive
 * server-side (server-to-server traffic is never subject to browser CORS, exactly
 * like `scripts/google/smoke.ts`'s own real Drive PUT). Drive OAuth tokens/client
 * secret never reach the browser — the one security property §11 actually cared
 * about is unchanged; only the "browser talks to Drive directly" mechanic is gone.
 *
 * Folds together what were three separate steps (`initiateUploadAction` /
 * browser PUT / `confirmUploadAction`) into one authenticated request, since the
 * intermediate browser round-trip no longer serves a purpose.
 */
export async function POST(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, category: "unauthenticated", message: "Please sign in again." }, { status: 401 });
  }

  const url = new URL(request.url);
  const filename = url.searchParams.get("filename");
  const mimeType = url.searchParams.get("mimeType");
  const declaredSizeBytes = Number(url.searchParams.get("sizeBytes"));
  if (!filename || !mimeType || !Number.isFinite(declaredSizeBytes)) {
    return NextResponse.json({ ok: false, category: "invalid_file", message: "Missing upload details." }, { status: 400 });
  }
  if (!isAllowedSourceCoverMimeType(mimeType)) {
    return NextResponse.json(
      { ok: false, category: "invalid_file", message: "That file type isn't supported. Please choose a JPEG, PNG, WebP, HEIC, or HEIF photo." },
      { status: 400 }
    );
  }
  if (!isValidSourceCoverSize(declaredSizeBytes)) {
    return NextResponse.json(
      {
        ok: false,
        category: "invalid_file",
        message: `That photo is too large (max ${Math.floor(MAX_SOURCE_COVER_SIZE_BYTES / (1024 * 1024))} MB).`,
      },
      { status: 400 }
    );
  }

  const bytes = Buffer.from(await request.arrayBuffer());
  if (bytes.length === 0 || !isValidSourceCoverSize(bytes.length)) {
    return NextResponse.json({ ok: false, category: "invalid_file", message: "The uploaded photo was empty or too large." }, { status: 400 });
  }

  // E2E fixture path — see e2eFixtures.ts's own doc comment. Skips Drive entirely
  // (no provider call, no network PUT); everything downstream (ingestion row
  // creation, the rest of the intake pipeline) runs exactly as it does for a real
  // upload.
  if (isE2EFakeProvidersEnabled()) {
    const ingestionItemId = await createIngestionRecord({
      fileId: `e2e-fake-drive-file-${crypto.randomUUID()}`,
      filename,
      mimeType,
      sizeBytes: bytes.length,
      checksum: null,
    });
    return NextResponse.json({ ok: true, ingestionItemId });
  }

  const provider = getConfiguredCoverStorageProvider();
  if (!provider) {
    return NextResponse.json(
      { ok: false, category: "configuration_missing", message: "Photo storage isn't configured yet. Please contact your administrator." },
      { status: 503 }
    );
  }
  const rootFolderId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID!;

  try {
    const uploadSession = await provider.initiateResumableUpload({
      parentFolderId: rootFolderId,
      filename,
      mimeType,
      sizeBytes: bytes.length,
    });

    const putResponse = await fetch(uploadSession.sessionUri, {
      method: "PUT",
      headers: { "Content-Type": mimeType, "Content-Length": String(bytes.length) },
      body: bytes,
    });
    if (!putResponse.ok) {
      return NextResponse.json({ ok: false, category: "upload_failed", message: "The upload didn't complete. Please try again." }, { status: 502 });
    }
    const uploaded = (await putResponse.json()) as { id?: string };
    if (!uploaded.id) {
      return NextResponse.json({ ok: false, category: "upload_failed", message: "The upload didn't complete. Please try again." }, { status: 502 });
    }

    const metadata = await provider.confirmUploadedFile({
      fileId: uploaded.id,
      expectedParentFolderId: rootFolderId,
      expectedFilename: filename,
      expectedMimeType: mimeType,
      expectedSizeBytes: bytes.length,
    });

    const ingestionItemId = await createIngestionRecord({
      fileId: metadata.id,
      filename: metadata.name,
      mimeType: metadata.mimeType,
      sizeBytes: metadata.size ?? bytes.length,
      checksum: metadata.md5Checksum ?? null,
    });

    return NextResponse.json({ ok: true, ingestionItemId });
  } catch (error) {
    const category = error instanceof DriveProviderError ? error.category : "unexpected_provider_failure";
    return NextResponse.json({ ok: false, category, message: "Couldn't upload the photo. Please try again." }, { status: 502 });
  }
}
