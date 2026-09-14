import { describe, expect, it } from "vitest";
import { SignJWT } from "jose";
import {
  createAdminSessionToken,
  createStaffSessionToken,
  isAdminActive,
  maybeRenewSessionToken,
  verifySessionToken,
} from "@/lib/auth/session";

describe("session tokens", () => {
  it("creates a verifiable staff session with no admin elevation", async () => {
    const token = await createStaffSessionToken();
    const session = await verifySessionToken(token);
    expect(session).not.toBeNull();
    expect(session?.role).toBe("staff");
    expect(session?.adminExpiresAt).toBeUndefined();
    expect(isAdminActive(session!)).toBe(false);
  });

  it("creates a verifiable admin session with active elevation", async () => {
    const token = await createAdminSessionToken();
    const session = await verifySessionToken(token);
    expect(session).not.toBeNull();
    expect(session?.role).toBe("admin");
    expect(isAdminActive(session!)).toBe(true);
  });

  it("rejects a garbage token", async () => {
    expect(await verifySessionToken("not-a-real-token")).toBeNull();
  });

  it("rejects a token signed with the wrong secret", async () => {
    const wrongKey = new TextEncoder().encode("a-completely-different-secret-value");
    const now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({ role: "staff" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(now)
      .setExpirationTime(now + 3600)
      .sign(wrongKey);
    expect(await verifySessionToken(token)).toBeNull();
  });

  it("rejects an expired token", async () => {
    const key = new TextEncoder().encode(process.env.SESSION_SECRET!);
    const past = Math.floor(Date.now() / 1000) - 3600;
    const token = await new SignJWT({ role: "staff" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(past - 3600)
      .setExpirationTime(past)
      .sign(key);
    expect(await verifySessionToken(token)).toBeNull();
  });

  it("treats admin elevation as inactive once its window has passed, without invalidating the whole session", () => {
    const now = Math.floor(Date.now() / 1000);
    const lapsedAdminSession = {
      role: "admin" as const,
      adminExpiresAt: now - 10,
      issuedAt: now - 1000,
      expiresAt: now + 1000,
    };
    expect(isAdminActive(lapsedAdminSession)).toBe(false);
  });

  it("does not renew a freshly issued session", async () => {
    const now = Math.floor(Date.now() / 1000);
    const freshSession = { role: "staff" as const, issuedAt: now, expiresAt: now + 3600 };
    expect(await maybeRenewSessionToken(freshSession)).toBeNull();
  });

  it("renews a session past the sliding-expiry threshold", async () => {
    const now = Math.floor(Date.now() / 1000);
    // Lifetime 1000s, issued 900s ago -> only 10% remaining, well past the 50% threshold.
    const staleSession = { role: "staff" as const, issuedAt: now - 900, expiresAt: now - 900 + 1000 };
    const renewed = await maybeRenewSessionToken(staleSession);
    expect(renewed).not.toBeNull();
    const renewedSession = await verifySessionToken(renewed!);
    expect(renewedSession?.role).toBe("staff");
  });

  it("downgrades a session to staff on renewal once admin elevation has lapsed", async () => {
    const now = Math.floor(Date.now() / 1000);
    const staleLapsedAdmin = {
      role: "admin" as const,
      adminExpiresAt: now - 500,
      issuedAt: now - 900,
      expiresAt: now - 900 + 1000,
    };
    const renewed = await maybeRenewSessionToken(staleLapsedAdmin);
    expect(renewed).not.toBeNull();
    const renewedSession = await verifySessionToken(renewed!);
    expect(renewedSession?.role).toBe("staff");
  });
});
