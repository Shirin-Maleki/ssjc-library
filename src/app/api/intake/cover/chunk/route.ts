import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/guards";
import { getConfiguredCoverStorageProvider, DriveProviderError } from "@/lib/googleDrive";
import { verifyUploadSessionToken } from "@/lib/intake/uploadSessionToken";
import { createIngestionRecord } from "@/lib/intake/ingestionRecord";
import { CHUNK_SIZE_BYTES } from "@/lib/intake/uploadChunking";

export const runtime = "nodejs";

type ParsedContentRange = { kind: "chunk"; start: number; end: number; total: number } | { kind: "status"; total: number };

/** `bytes {start}-{end}/{total}` for a real chunk, or the documented resumable-
 * upload status-check form `bytes *&#47;{total}` (empty body) — both real,
 * current Google-documented formats (developers.google.com/workspace/drive/api/guides/manage-uploads). */
function parseContentRange(header: string | null): ParsedContentRange | null {
  if (!header) return null;
  const trimmed = header.trim();
  const statusMatch = /^bytes \*\/(\d+)$/.exec(trimmed);
  if (statusMatch) return { kind: "status", total: Number(statusMatch[1]) };
  const chunkMatch = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(trimmed);
  if (chunkMatch) return { kind: "chunk", start: Number(chunkMatch[1]), end: Number(chunkMatch[2]), total: Number(chunkMatch[3]) };
  return null;
}

/** Google's 308 response reports received bytes as `Range: bytes=0-N` (no
 * bytes received at all omits the header entirely) — next start is N+1. */
function parseReceivedRangeHeader(value: string | null): number {
  if (!value) return 0;
  const match = /^bytes=0-(\d+)$/.exec(value.trim());
  return match ? Number(match[1]) + 1 : 0;
}

/**
 * Step 2 of the chunked cover upload (Phase 7 correction pass — §1). Each
 * request carries one <=`CHUNK_SIZE_BYTES` slice of the real source photo
 * (comfortably under Vercel's 4.5 MB serverless request-body limit, unlike
 * the single-request upload this replaces) plus the encrypted upload token
 * from `/api/intake/cover/init`. This handler decrypts the token to recover
 * the real Drive resumable session URI (never sent to the browser) and
 * relays the chunk server-side using the exact Content-Range semantics
 * Google's resumable-upload protocol documents — server-to-server traffic,
 * never subject to browser CORS, exactly like the single-shot predecessor.
 *
 * Also accepts the documented status-check form (`Content-Range: bytes
 * *&#47;{total}`, empty body) so a client that lost the response to a chunk
 * PUT (but not necessarily the chunk itself — "do not assume the server did
 * or didn't receive the bytes," per Google's own docs) can resync to Drive's
 * authoritative received-byte count before deciding what to send next,
 * rather than blindly resending a chunk Drive may have already accepted.
 */
export async function PUT(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, category: "unauthenticated", message: "Please sign in again." }, { status: 401 });
  }

  const token = new URL(request.url).searchParams.get("token");
  if (!token) {
    return NextResponse.json({ ok: false, category: "invalid_file", message: "Missing upload session." }, { status: 400 });
  }
  const uploadSession = await verifyUploadSessionToken(token);
  if (!uploadSession) {
    return NextResponse.json(
      { ok: false, category: "upload_failed", message: "This upload session has expired. Please try again." },
      { status: 400 }
    );
  }

  const parsedRange = parseContentRange(request.headers.get("Content-Range"));
  if (!parsedRange || parsedRange.total !== uploadSession.totalSizeBytes) {
    return NextResponse.json({ ok: false, category: "invalid_file", message: "Malformed upload chunk." }, { status: 400 });
  }

  const bodyBytes = Buffer.from(await request.arrayBuffer());

  if (parsedRange.kind === "chunk") {
    const expectedChunkLength = parsedRange.end - parsedRange.start + 1;
    if (bodyBytes.length !== expectedChunkLength || bodyBytes.length > CHUNK_SIZE_BYTES) {
      return NextResponse.json({ ok: false, category: "invalid_file", message: "Malformed upload chunk." }, { status: 400 });
    }
  } else if (bodyBytes.length !== 0) {
    return NextResponse.json({ ok: false, category: "invalid_file", message: "Malformed upload chunk." }, { status: 400 });
  }

  if (uploadSession.fake) {
    // E2E fixture path — see e2eFixtures.ts's own doc comment. No real Drive
    // session exists to query, so a status check simply reports nothing
    // received yet; this path never fails in practice (no real network), so
    // resumability is never actually exercised here — only real-mode is.
    if (parsedRange.kind === "status") {
      return NextResponse.json({ ok: true, done: false, bytesReceived: 0 });
    }
    const isFinal = parsedRange.end + 1 >= uploadSession.totalSizeBytes;
    if (!isFinal) {
      return NextResponse.json({ ok: true, done: false, bytesReceived: parsedRange.end + 1 });
    }
    const ingestionItemId = await createIngestionRecord({
      fileId: `e2e-fake-drive-file-${crypto.randomUUID()}`,
      filename: uploadSession.filename,
      mimeType: uploadSession.mimeType,
      sizeBytes: uploadSession.totalSizeBytes,
      checksum: null,
    });
    return NextResponse.json({ ok: true, done: true, ingestionItemId });
  }

  const provider = getConfiguredCoverStorageProvider();
  if (!provider || !uploadSession.sessionUri) {
    return NextResponse.json(
      { ok: false, category: "configuration_missing", message: "Photo storage isn't configured yet. Please contact your administrator." },
      { status: 503 }
    );
  }
  const rootFolderId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID!;

  try {
    const driveResponse = await fetch(uploadSession.sessionUri, {
      method: "PUT",
      headers: {
        "Content-Length": String(bodyBytes.length),
        "Content-Range":
          parsedRange.kind === "chunk" ? `bytes ${parsedRange.start}-${parsedRange.end}/${parsedRange.total}` : `bytes */${parsedRange.total}`,
      },
      body: bodyBytes.length > 0 ? bodyBytes : undefined,
    });

    if (driveResponse.status === 308) {
      const bytesReceived = parseReceivedRangeHeader(driveResponse.headers.get("Range"));
      return NextResponse.json({ ok: true, done: false, bytesReceived });
    }

    if (!driveResponse.ok) {
      return NextResponse.json({ ok: false, category: "upload_failed", message: "The upload didn't complete. Please try again." }, { status: 502 });
    }

    const uploaded = (await driveResponse.json()) as { id?: string };
    if (!uploaded.id) {
      return NextResponse.json({ ok: false, category: "upload_failed", message: "The upload didn't complete. Please try again." }, { status: 502 });
    }

    const metadata = await provider.confirmUploadedFile({
      fileId: uploaded.id,
      expectedParentFolderId: rootFolderId,
      expectedFilename: uploadSession.filename,
      expectedMimeType: uploadSession.mimeType,
      expectedSizeBytes: uploadSession.totalSizeBytes,
    });

    const ingestionItemId = await createIngestionRecord({
      fileId: metadata.id,
      filename: metadata.name,
      mimeType: metadata.mimeType,
      sizeBytes: metadata.size ?? uploadSession.totalSizeBytes,
      checksum: metadata.md5Checksum ?? null,
    });

    return NextResponse.json({ ok: true, done: true, ingestionItemId });
  } catch (error) {
    const category = error instanceof DriveProviderError ? error.category : "unexpected_provider_failure";
    return NextResponse.json({ ok: false, category, message: "Couldn't upload the photo. Please try again." }, { status: 502 });
  }
}
