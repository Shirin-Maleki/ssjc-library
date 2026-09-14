import { headers } from "next/headers";
import { rateLimitConfig } from "@/config/site";

/**
 * In-memory login-attempt throttle — a deliberate Phase 1 interim simplification.
 *
 * docs/DATA_MODEL.md designs a Postgres-backed `login_attempts` table for this, but
 * Phase 1 is explicitly forbidden from connecting a database. This in-memory version
 * covers the same threat model for local development and a single running instance;
 * it resets on restart and does not share state across multiple server instances, so
 * Phase 4 must replace it with the real table before either limitation matters for an
 * actual deployment. See docs/DECISIONS.md and docs/SECURITY.md.
 */
interface AttemptRecord {
  count: number;
  windowStartedAt: number;
}

const attempts = new Map<string, AttemptRecord>();

export async function getClientKey(prefix: string): Promise<string> {
  const store = await headers();
  const forwardedFor = store.get("x-forwarded-for");
  const ip = forwardedFor?.split(",")[0]?.trim() || "local";
  return `${prefix}:${ip}`;
}

export function isRateLimited(key: string): boolean {
  const record = attempts.get(key);
  if (!record) return false;
  const elapsedSeconds = (Date.now() - record.windowStartedAt) / 1000;
  if (elapsedSeconds > rateLimitConfig.windowSeconds) {
    attempts.delete(key);
    return false;
  }
  return record.count >= rateLimitConfig.maxAttempts;
}

export function recordFailedAttempt(key: string): void {
  const now = Date.now();
  const record = attempts.get(key);
  if (!record || (now - record.windowStartedAt) / 1000 > rateLimitConfig.windowSeconds) {
    attempts.set(key, { count: 1, windowStartedAt: now });
    return;
  }
  record.count += 1;
}

export function resetAttempts(key: string): void {
  attempts.delete(key);
}
