import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/guards", () => ({
  getSession: vi.fn().mockResolvedValue({ role: "staff", expiresAt: Math.floor(Date.now() / 1000) + 3600, issuedAt: Math.floor(Date.now() / 1000) }),
}));
// Sidesteps `@/db/client`'s `import "server-only"` guard (throws outside Next's own
// build pipeline) — these tests exercise request validation, not persistence, so a
// real database was never needed here.
vi.mock("@/lib/intake/ingestionRecord", () => ({
  createIngestionRecord: vi.fn().mockResolvedValue("00000000-0000-0000-0000-000000000000"),
}));
// Sidesteps `@/lib/googleDrive`'s own `import "server-only"` guard the same way —
// every test case here either uses the `fake: true` token path (never reaches this
// module at all) or deliberately fails validation before the provider is ever
// constructed.
vi.mock("@/lib/googleDrive", () => ({
  getConfiguredCoverStorageProvider: vi.fn(),
  DriveProviderError: class DriveProviderError extends Error {},
}));

import { PUT } from "@/app/api/intake/cover/chunk/route";
import { createUploadSessionToken } from "@/lib/intake/uploadSessionToken";

/** Server-side enforcement of the same chunk-size bound the client is
 * designed to respect (Phase 7 correction pass §1) — defense in depth: even a
 * buggy or malicious client can never make this endpoint accept a request
 * body large enough to risk exceeding Vercel's real request-size limit. */
describe("api/intake/cover/chunk — chunk-size enforcement", () => {
  const originalSecret = process.env.SESSION_SECRET;

  beforeEach(() => {
    process.env.SESSION_SECRET = "a-real-enough-test-session-secret-not-for-production-use";
  });
  afterEach(() => {
    process.env.SESSION_SECRET = originalSecret;
  });

  async function buildRequest(bodyLength: number, contentRange: string, token: string): Promise<Request> {
    const body = new Uint8Array(bodyLength);
    return new Request(`http://localhost/api/intake/cover/chunk?token=${encodeURIComponent(token)}`, {
      method: "PUT",
      headers: { "Content-Range": contentRange },
      body,
    });
  }

  it("rejects a chunk body larger than the chosen safe chunk size", async () => {
    const totalSizeBytes = 10 * 1024 * 1024;
    const token = await createUploadSessionToken({ sessionUri: null, filename: "big.jpg", mimeType: "image/jpeg", totalSizeBytes, fake: true });
    const oversized = 5 * 1024 * 1024; // > CHUNK_SIZE_BYTES (4 MiB)
    const request = await buildRequest(oversized, `bytes 0-${oversized - 1}/${totalSizeBytes}`, token);

    const response = await PUT(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.category).toBe("invalid_file");
  });

  it("rejects a chunk whose declared Content-Range length does not match the actual body length", async () => {
    const totalSizeBytes = 1_000_000;
    const token = await createUploadSessionToken({ sessionUri: null, filename: "x.jpg", mimeType: "image/jpeg", totalSizeBytes, fake: true });
    // Declares 100 bytes but the real body below is shorter.
    const request = await buildRequest(10, `bytes 0-99/${totalSizeBytes}`, token);

    const response = await PUT(request);
    expect(response.status).toBe(400);
  });

  it("accepts a chunk at exactly the chunk-size boundary (fake/E2E path, no real Drive call)", async () => {
    const totalSizeBytes = 10 * 1024 * 1024;
    const chunkSize = 4 * 1024 * 1024;
    const token = await createUploadSessionToken({ sessionUri: null, filename: "x.jpg", mimeType: "image/jpeg", totalSizeBytes, fake: true });
    const request = await buildRequest(chunkSize, `bytes 0-${chunkSize - 1}/${totalSizeBytes}`, token);

    const response = await PUT(request);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.done).toBe(false);
    expect(body.bytesReceived).toBe(chunkSize);
  });

  it("rejects an expired/invalid upload token before ever inspecting the body", async () => {
    const request = await buildRequest(10, "bytes 0-9/1000", "not-a-real-token");
    const response = await PUT(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.category).toBe("upload_failed");
  });
});
