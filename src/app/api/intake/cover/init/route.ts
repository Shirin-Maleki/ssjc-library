import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/guards";
import {
  getConfiguredCoverStorageProvider,
  DriveProviderError,
  isAllowedSourceCoverMimeType,
  isValidSourceCoverSize,
  MAX_SOURCE_COVER_SIZE_BYTES,
} from "@/lib/googleDrive";
import { createUploadSessionToken } from "@/lib/intake/uploadSessionToken";
import { isE2EFakeProvidersEnabled } from "@/lib/intake/e2eFixtures";
import { CHUNK_SIZE_BYTES } from "@/lib/intake/uploadChunking";

export const runtime = "nodejs";

/**
 * Step 1 of the chunked cover upload (Phase 7 correction pass — §1; full
 * record in `docs/DECISIONS.md`). Small JSON body only (filename/mimeType/
 * sizeBytes) — never file bytes, so this request is trivially small regardless
 * of the real photo's size. Starts the real Drive resumable session
 * server-side and hands the browser back only an opaque, encrypted upload
 * token (`uploadSessionToken.ts`) — never the real Drive session URI.
 */
export async function POST(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, category: "unauthenticated", message: "Please sign in again." }, { status: 401 });
  }

  let body: { filename?: unknown; mimeType?: unknown; sizeBytes?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, category: "invalid_file", message: "Missing upload details." }, { status: 400 });
  }
  const { filename, mimeType, sizeBytes } = body;
  if (typeof filename !== "string" || !filename || typeof mimeType !== "string" || typeof sizeBytes !== "number" || !Number.isFinite(sizeBytes)) {
    return NextResponse.json({ ok: false, category: "invalid_file", message: "Missing upload details." }, { status: 400 });
  }
  if (!isAllowedSourceCoverMimeType(mimeType)) {
    return NextResponse.json(
      { ok: false, category: "invalid_file", message: "That file type isn't supported. Please choose a JPEG, PNG, WebP, HEIC, or HEIF photo." },
      { status: 400 }
    );
  }
  if (!isValidSourceCoverSize(sizeBytes)) {
    return NextResponse.json(
      {
        ok: false,
        category: "invalid_file",
        message: `That photo is too large (max ${Math.floor(MAX_SOURCE_COVER_SIZE_BYTES / (1024 * 1024))} MB).`,
      },
      { status: 400 }
    );
  }

  if (isE2EFakeProvidersEnabled()) {
    const uploadToken = await createUploadSessionToken({ sessionUri: null, filename, mimeType, totalSizeBytes: sizeBytes, fake: true });
    return NextResponse.json({ ok: true, uploadToken, chunkSizeBytes: CHUNK_SIZE_BYTES });
  }

  const provider = getConfiguredCoverStorageProvider();
  if (!provider) {
    return NextResponse.json(
      { ok: false, category: "configuration_missing", message: "Photo storage isn't configured yet. Please contact your administrator." },
      { status: 503 }
    );
  }

  try {
    const uploadSession = await provider.initiateResumableUpload({
      parentFolderId: process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID!,
      filename,
      mimeType,
      sizeBytes,
    });
    const uploadToken = await createUploadSessionToken({
      sessionUri: uploadSession.sessionUri,
      filename,
      mimeType,
      totalSizeBytes: sizeBytes,
      fake: false,
    });
    return NextResponse.json({ ok: true, uploadToken, chunkSizeBytes: CHUNK_SIZE_BYTES });
  } catch (error) {
    const category = error instanceof DriveProviderError ? error.category : "unexpected_provider_failure";
    return NextResponse.json({ ok: false, category, message: "Couldn't start the upload. Please try again." }, { status: 502 });
  }
}
