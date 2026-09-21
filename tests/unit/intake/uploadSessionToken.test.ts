import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createUploadSessionToken, verifyUploadSessionToken } from "@/lib/intake/uploadSessionToken";

describe("intake/uploadSessionToken", () => {
  const originalSecret = process.env.SESSION_SECRET;

  beforeEach(() => {
    process.env.SESSION_SECRET = "a-real-enough-test-session-secret-not-for-production-use";
  });
  afterEach(() => {
    process.env.SESSION_SECRET = originalSecret;
    vi.useRealTimers();
  });

  const payload = { sessionUri: "https://www.googleapis.com/upload/drive/v3/files?upload_id=real-session", filename: "cover.jpg", mimeType: "image/jpeg", totalSizeBytes: 6_400_000, fake: false };

  it("round-trips a real payload through encrypt then decrypt", async () => {
    const token = await createUploadSessionToken(payload);
    const decoded = await verifyUploadSessionToken(token);
    expect(decoded).toEqual(payload);
  });

  it("produces an opaque token that does not contain the plaintext Drive session URI", async () => {
    const token = await createUploadSessionToken(payload);
    expect(token).not.toContain("googleapis.com");
    expect(token).not.toContain("upload_id=real-session");
  });

  it("round-trips the E2E fixture (fake, sessionUri null) shape", async () => {
    const fakePayload = { sessionUri: null, filename: "fixture.png", mimeType: "image/png", totalSizeBytes: 1234, fake: true };
    const token = await createUploadSessionToken(fakePayload);
    const decoded = await verifyUploadSessionToken(token);
    expect(decoded).toEqual(fakePayload);
  });

  it("returns null (never throws) for a tampered token", async () => {
    const token = await createUploadSessionToken(payload);
    const tampered = token.slice(0, -4) + (token.slice(-4) === "abcd" ? "efgh" : "abcd");
    await expect(verifyUploadSessionToken(tampered)).resolves.toBeNull();
  });

  it("returns null for garbage input", async () => {
    await expect(verifyUploadSessionToken("not-a-real-token")).resolves.toBeNull();
    await expect(verifyUploadSessionToken("")).resolves.toBeNull();
  });

  it("returns null for an expired token", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const token = await createUploadSessionToken(payload);
    vi.setSystemTime(new Date("2026-01-01T05:00:00Z")); // well past the 2-hour TTL
    await expect(verifyUploadSessionToken(token)).resolves.toBeNull();
  });

  it("cannot be decrypted with a different SESSION_SECRET", async () => {
    const token = await createUploadSessionToken(payload);
    process.env.SESSION_SECRET = "a-completely-different-test-session-secret-value-here";
    await expect(verifyUploadSessionToken(token)).resolves.toBeNull();
  });
});
