import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { ingestionItems } from "@/db/schema";
import { hasActiveAdminSession } from "@/lib/auth/guards";
import { getConfiguredCoverStorageProvider, DriveProviderError } from "@/lib/googleDrive";
import { isUuid } from "@/lib/utils/uuid";

export const runtime = "nodejs";

/**
 * Admin-only original-source-cover proxy (Phase 8, §10) — the one place an admin
 * can inspect the real teacher-photographed Drive original during Review Later,
 * without ever exposing a raw Drive file id, an OAuth credential, or a general
 * arbitrary-file proxy to the browser. Accepts only an application-owned
 * `ingestionItemId`; the actual Drive file id is resolved server-side from
 * `ingestion_items.drive_file_id` (set once at upload time, Phase 6/7 — never
 * trusted from a query param or request body). Requires active admin elevation,
 * checked independently of whether the referring page was itself protected
 * (`hasActiveAdminSession`, never `requireAdminSession`'s `redirect()` — a
 * `<img>`/`fetch()` caller needs a real HTTP status, not a 3xx to an HTML page).
 *
 * This is a REVIEW tool, not normal teacher catalog rendering — the teacher-facing
 * catalog never serves images through this route; `books.display_cover_url` (a
 * previously-verified external provider thumbnail) is what Find/Book Detail use.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ ingestionItemId: string }> }): Promise<Response> {
  const isAdmin = await hasActiveAdminSession();
  if (!isAdmin) {
    return NextResponse.json({ ok: false, message: "Admin access required." }, { status: 403 });
  }

  const { ingestionItemId } = await params;
  if (!isUuid(ingestionItemId)) {
    return NextResponse.json({ ok: false, message: "Invalid ingestion item id." }, { status: 400 });
  }

  const [item] = await db.select({ driveFileId: ingestionItems.driveFileId }).from(ingestionItems).where(eq(ingestionItems.id, ingestionItemId)).limit(1);
  if (!item) {
    return NextResponse.json({ ok: false, message: "This review item no longer exists." }, { status: 404 });
  }

  const provider = getConfiguredCoverStorageProvider();
  if (!provider) {
    return NextResponse.json({ ok: false, message: "The source photo storage is not available right now." }, { status: 503 });
  }

  try {
    const { bytes, metadata } = await provider.downloadSource(item.driveFileId);
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": metadata.mimeType,
        "Content-Length": String(bytes.length),
        // Conservative/private caching (§10) — this is admin-only review material,
        // never cached by a shared/CDN cache, and short-lived enough that a stale
        // cached copy after a re-upload is not worth risking.
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    if (error instanceof DriveProviderError) {
      const status = error.category === "file_not_found" ? 404 : error.category === "rate_limited" ? 429 : 502;
      return NextResponse.json({ ok: false, message: "The original source photo could not be loaded right now." }, { status });
    }
    return NextResponse.json({ ok: false, message: "The original source photo could not be loaded right now." }, { status: 500 });
  }
}
