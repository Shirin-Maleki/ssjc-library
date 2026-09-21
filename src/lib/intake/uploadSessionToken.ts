import { EncryptJWT, jwtDecrypt } from "jose";
import { hkdfSync } from "node:crypto";

/**
 * The server-controlled, opaque, encrypted capability the browser holds during
 * a chunked cover upload (Phase 7 correction pass — §1). The browser never
 * sees a usable Google URL: the real Drive resumable `sessionUri` lives only
 * inside this encrypted token's payload, decrypted server-side on every chunk
 * request. A stolen/leaked token still can't be used to talk to Drive
 * directly — only to this app's own authenticated `/api/intake/cover/chunk`
 * endpoint, which itself requires a valid staff session.
 *
 * Deliberately stateless (no new database table, no in-memory session store):
 * a Vercel serverless deployment gives no guarantee two requests for the same
 * upload land on the same instance, so any server-side "remember this session"
 * approach would need external storage anyway — an encrypted, self-contained
 * token is the smaller, already-idiomatic mechanism for this codebase (mirrors
 * `src/lib/auth/session.ts`'s JWT session cookie, though that one only signs,
 * since a session role isn't sensitive; this one encrypts, since a raw Drive
 * session URI is).
 */

const UPLOAD_SESSION_TOKEN_TTL_SECONDS = 60 * 60 * 2; // comfortably covers a slow multi-chunk mobile upload with retries

export interface UploadSessionPayload {
  /** `null` only in the E2E fixture path (`fake: true`) — see e2eFixtures.ts. */
  sessionUri: string | null;
  filename: string;
  mimeType: string;
  totalSizeBytes: number;
  fake: boolean;
}

/** HKDF-derived from the existing `SESSION_SECRET` with a distinct "info" context
 * — cryptographically separate from the session-cookie signing key even though
 * both root from the same secret, so no new required environment variable. */
function getEncryptionKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("Missing or too-short SESSION_SECRET environment variable. See .env.example and README.md.");
  }
  const derived = hkdfSync("sha256", Buffer.from(secret, "utf8"), Buffer.alloc(0), Buffer.from("ssjc-upload-session-token"), 32);
  return new Uint8Array(derived);
}

export async function createUploadSessionToken(payload: UploadSessionPayload): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new EncryptJWT({ ...payload })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuedAt(now)
    .setExpirationTime(now + UPLOAD_SESSION_TOKEN_TTL_SECONDS)
    .encrypt(getEncryptionKey());
}

/** Returns `null` (never throws) for an expired, tampered, or malformed token —
 * the caller treats this the same as any other upload failure: a calm error,
 * never a raw decryption exception. */
export async function verifyUploadSessionToken(token: string): Promise<UploadSessionPayload | null> {
  try {
    const { payload } = await jwtDecrypt(token, getEncryptionKey());
    if (
      typeof payload.filename !== "string" ||
      typeof payload.mimeType !== "string" ||
      typeof payload.totalSizeBytes !== "number" ||
      (payload.sessionUri !== null && typeof payload.sessionUri !== "string")
    ) {
      return null;
    }
    return {
      sessionUri: (payload.sessionUri as string | null) ?? null,
      filename: payload.filename,
      mimeType: payload.mimeType,
      totalSizeBytes: payload.totalSizeBytes,
      fake: payload.fake === true,
    };
  } catch {
    return null;
  }
}
