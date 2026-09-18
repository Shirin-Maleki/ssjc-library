import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DriveProviderError } from "@/lib/googleDrive/provider";
import { __resetAccessTokenCacheForTests, getAccessToken } from "@/lib/googleDrive/oauthClient";

const ENV_VARS = [
  "GOOGLE_OAUTH_CLIENT_ID",
  "GOOGLE_OAUTH_CLIENT_SECRET",
  "GOOGLE_OAUTH_REFRESH_TOKEN",
  "GOOGLE_DRIVE_ROOT_FOLDER_ID",
] as const;
const ORIGINAL_ENV: Record<string, string | undefined> = {};

function tokenSuccess(accessToken: string, expiresInSeconds: number): Response {
  return new Response(JSON.stringify({ access_token: accessToken, expires_in: expiresInSeconds }), { status: 200 });
}
function tokenError(status: number, error?: string): Response {
  return new Response(JSON.stringify(error ? { error } : {}), { status });
}

describe("googleDrive/oauthClient", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    __resetAccessTokenCacheForTests();
    for (const key of ENV_VARS) {
      ORIGINAL_ENV[key] = process.env[key];
    }
    process.env.GOOGLE_OAUTH_CLIENT_ID = "test-client-id";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "super-secret-value-should-never-leak";
    process.env.GOOGLE_OAUTH_REFRESH_TOKEN = "test-refresh-token-should-never-leak";
    process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID = "test-root-folder-id";
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    __resetAccessTokenCacheForTests();
    for (const key of ENV_VARS) {
      if (ORIGINAL_ENV[key] === undefined) delete process.env[key];
      else process.env[key] = ORIGINAL_ENV[key];
    }
  });

  it("successfully exchanges the refresh token for an access token", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(tokenSuccess("real-access-token", 3600));
    const token = await getAccessToken();
    expect(token).toBe("real-access-token");
  });

  it("sends the refresh token, client id, and client secret to Google's token endpoint", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(tokenSuccess("token-1", 3600));
    await getAccessToken();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://oauth2.googleapis.com/token");
    const body = (init as RequestInit).body as string;
    expect(body).toContain("grant_type=refresh_token");
    expect(body).toContain("test-client-id");
  });

  it("parses expiry correctly and reuses the cached token before it expires", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(tokenSuccess("cached-token", 3600));
    const first = await getAccessToken();
    const second = await getAccessToken();
    expect(first).toBe("cached-token");
    expect(second).toBe("cached-token");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refreshes again once the cached token is near expiry", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(tokenSuccess("first-token", 3600))
      .mockResolvedValueOnce(tokenSuccess("second-token", 3600));

    const first = await getAccessToken();
    expect(first).toBe("first-token");

    // Advance to within the 60s safety margin of the 3600s expiry.
    vi.advanceTimersByTime(3600_000 - 30_000);

    const second = await getAccessToken();
    expect(second).toBe("second-token");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not refresh again well before expiry", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(tokenSuccess("token", 3600));
    await getAccessToken();
    vi.advanceTimersByTime(1000_000); // well under 3600s - 60s margin
    await getAccessToken();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("maps invalid_grant to authorization_revoked_or_invalid", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(tokenError(400, "invalid_grant"));
    try {
      await getAccessToken();
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(DriveProviderError);
      expect((error as DriveProviderError).category).toBe("authorization_revoked_or_invalid");
    }
  });

  it("maps a 401 to authorization_required", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(tokenError(401));
    try {
      await getAccessToken();
      expect.unreachable();
    } catch (error) {
      expect((error as DriveProviderError).category).toBe("authorization_required");
    }
  });

  it("maps a 429 to rate_limited", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(tokenError(429));
    const promise = getAccessToken();
    const expectation = expect(promise).rejects.toMatchObject({ category: "rate_limited" });
    await vi.runAllTimersAsync();
    await expectation;
  });

  it("retries a transient 5xx and eventually maps it to transient_provider_failure if it never recovers", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(tokenError(503));
    const promise = getAccessToken();
    const expectation = expect(promise).rejects.toMatchObject({ category: "transient_provider_failure" });
    await vi.runAllTimersAsync();
    await expectation;
  });

  it("recovers from a transient 5xx that succeeds on retry", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(tokenError(503)).mockResolvedValueOnce(tokenSuccess("recovered-token", 3600));
    const promise = getAccessToken();
    await vi.runAllTimersAsync();
    const token = await promise;
    expect(token).toBe("recovered-token");
  });

  it("never includes the client secret or refresh token in a thrown error message", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(tokenError(401, "unauthorized_client"));
    try {
      await getAccessToken();
      expect.unreachable();
    } catch (error) {
      const message = (error as DriveProviderError).message;
      expect(message).not.toContain("super-secret-value-should-never-leak");
      expect(message).not.toContain("test-refresh-token-should-never-leak");
    }
  });

  it("throws configuration_missing (not a network call) when config is absent", async () => {
    delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    const fetchMock = vi.spyOn(globalThis, "fetch");
    try {
      await getAccessToken();
      expect.unreachable();
    } catch (error) {
      expect((error as DriveProviderError).category).toBe("configuration_missing");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
