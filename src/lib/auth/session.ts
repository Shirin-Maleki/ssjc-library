import { SignJWT, jwtVerify } from "jose";
import { sessionConfig } from "@/config/site";

export type SessionRole = "staff" | "admin";

export interface Session {
  role: SessionRole;
  /** Unix seconds. Only present once elevated — admin privileges lapse after this even
   * if the token itself (and its plain staff-level access) is still valid. */
  adminExpiresAt?: number;
  expiresAt: number;
  issuedAt: number;
}

function getSecretKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      "Missing or too-short SESSION_SECRET environment variable. See .env.example and README.md."
    );
  }
  return new TextEncoder().encode(secret);
}

async function sign(role: SessionRole, adminExpiresAt?: number): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const jwt = new SignJWT({ role, adminExpiresAt })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(now)
    .setExpirationTime(now + sessionConfig.staffSessionTtlSeconds);
  return jwt.sign(getSecretKey());
}

export async function createStaffSessionToken(): Promise<string> {
  return sign("staff");
}

export async function createAdminSessionToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return sign("admin", now + sessionConfig.adminElevationTtlSeconds);
}

export async function verifySessionToken(token: string): Promise<Session | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey());
    const { role, exp, iat, adminExpiresAt } = payload;
    if (role !== "staff" && role !== "admin") return null;
    if (typeof exp !== "number" || typeof iat !== "number") return null;
    return {
      role,
      adminExpiresAt: typeof adminExpiresAt === "number" ? adminExpiresAt : undefined,
      expiresAt: exp,
      issuedAt: iat,
    };
  } catch {
    return null;
  }
}

export function isAdminActive(session: Session): boolean {
  if (session.role !== "admin" || typeof session.adminExpiresAt !== "number") return false;
  return Math.floor(Date.now() / 1000) < session.adminExpiresAt;
}

/**
 * Sliding-expiry renewal, checked on every request in middleware. Returns a freshly
 * signed token once the current one is past the configured renewal threshold, or null
 * if no renewal is needed yet. An admin session whose elevation window has lapsed is
 * silently re-issued as a plain staff session rather than logging the user out —
 * matching docs/ARCHITECTURE.md §14 ("downgrades back to staff rather than logging out
 * entirely").
 */
export async function maybeRenewSessionToken(session: Session): Promise<string | null> {
  const now = Math.floor(Date.now() / 1000);
  const lifetime = session.expiresAt - session.issuedAt;
  const remaining = session.expiresAt - now;
  if (lifetime <= 0 || remaining / lifetime > sessionConfig.slidingRenewalThreshold) {
    return null;
  }
  if (session.role === "admin" && isAdminActive(session)) {
    return createAdminSessionToken();
  }
  return createStaffSessionToken();
}

export function sessionCookieOptions(maxAgeSeconds: number) {
  // Defaults to NODE_ENV, but "production build" and "served over HTTPS" are not the
  // same thing — `next start` is a production build even for local/E2E testing over
  // plain HTTP. WebKit (unlike Chromium) does not reliably treat a Secure cookie on
  // localhost/127.0.0.1 as sendable from fetch()-driven client-side navigations, so it
  // silently drops the session cookie on the second request. SESSION_COOKIE_SECURE lets
  // a real plain-HTTP context (local builds, this test suite) opt out explicitly, without
  // weakening the default for an actual HTTPS deployment.
  const secure =
    process.env.SESSION_COOKIE_SECURE !== undefined
      ? process.env.SESSION_COOKIE_SECURE === "true"
      : process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    secure,
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSeconds,
  };
}
