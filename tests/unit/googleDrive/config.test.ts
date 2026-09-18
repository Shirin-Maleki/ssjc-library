import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DriveProviderError } from "@/lib/googleDrive/provider";
import { isDriveConfigured, loadDriveConfig } from "@/lib/googleDrive/config";

const ENV_VARS = [
  "GOOGLE_OAUTH_CLIENT_ID",
  "GOOGLE_OAUTH_CLIENT_SECRET",
  "GOOGLE_OAUTH_REFRESH_TOKEN",
  "GOOGLE_DRIVE_ROOT_FOLDER_ID",
] as const;

const ORIGINAL_ENV: Record<string, string | undefined> = {};

describe("googleDrive/config", () => {
  beforeEach(() => {
    for (const key of ENV_VARS) {
      ORIGINAL_ENV[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_VARS) {
      if (ORIGINAL_ENV[key] === undefined) delete process.env[key];
      else process.env[key] = ORIGINAL_ENV[key];
    }
  });

  function setAllVars() {
    process.env.GOOGLE_OAUTH_CLIENT_ID = "test-client-id";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-client-secret";
    process.env.GOOGLE_OAUTH_REFRESH_TOKEN = "test-refresh-token";
    process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID = "test-root-folder-id";
  }

  it("returns the full config when every variable is present", () => {
    setAllVars();
    const config = loadDriveConfig();
    expect(config).toEqual({
      clientId: "test-client-id",
      clientSecret: "test-client-secret",
      refreshToken: "test-refresh-token",
      rootFolderId: "test-root-folder-id",
    });
  });

  it("throws configuration_missing when GOOGLE_OAUTH_CLIENT_ID is absent", () => {
    setAllVars();
    delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    expect(() => loadDriveConfig()).toThrow(DriveProviderError);
    try {
      loadDriveConfig();
    } catch (error) {
      expect(error).toBeInstanceOf(DriveProviderError);
      expect((error as DriveProviderError).category).toBe("configuration_missing");
      expect((error as DriveProviderError).message).toContain("GOOGLE_OAUTH_CLIENT_ID");
    }
  });

  it("throws configuration_missing when GOOGLE_OAUTH_CLIENT_SECRET is absent", () => {
    setAllVars();
    delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    try {
      loadDriveConfig();
      expect.unreachable();
    } catch (error) {
      expect((error as DriveProviderError).message).toContain("GOOGLE_OAUTH_CLIENT_SECRET");
    }
  });

  it("throws configuration_missing when GOOGLE_OAUTH_REFRESH_TOKEN is absent", () => {
    setAllVars();
    delete process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
    try {
      loadDriveConfig();
      expect.unreachable();
    } catch (error) {
      expect((error as DriveProviderError).message).toContain("GOOGLE_OAUTH_REFRESH_TOKEN");
    }
  });

  it("throws configuration_missing when GOOGLE_DRIVE_ROOT_FOLDER_ID is absent", () => {
    setAllVars();
    delete process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
    try {
      loadDriveConfig();
      expect.unreachable();
    } catch (error) {
      expect((error as DriveProviderError).message).toContain("GOOGLE_DRIVE_ROOT_FOLDER_ID");
    }
  });

  it("treats a whitespace-only value the same as missing (malformed config)", () => {
    setAllVars();
    process.env.GOOGLE_OAUTH_CLIENT_ID = "   ";
    try {
      loadDriveConfig();
      expect.unreachable();
    } catch (error) {
      expect((error as DriveProviderError).category).toBe("configuration_missing");
      expect((error as DriveProviderError).message).toContain("GOOGLE_OAUTH_CLIENT_ID");
    }
  });

  it("lists every missing variable at once, not just the first", () => {
    // All four absent (the beforeEach already deleted them all).
    try {
      loadDriveConfig();
      expect.unreachable();
    } catch (error) {
      const message = (error as DriveProviderError).message;
      for (const key of ENV_VARS) expect(message).toContain(key);
    }
  });

  it("never includes a real secret value in the thrown error message", () => {
    setAllVars();
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "super-secret-value-should-never-leak";
    delete process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
    try {
      loadDriveConfig();
      expect.unreachable();
    } catch (error) {
      expect((error as DriveProviderError).message).not.toContain("super-secret-value-should-never-leak");
    }
  });

  describe("isDriveConfigured", () => {
    it("returns true when fully configured", () => {
      setAllVars();
      expect(isDriveConfigured()).toBe(true);
    });

    it("returns false, never throws, when not configured", () => {
      expect(() => isDriveConfigured()).not.toThrow();
      expect(isDriveConfigured()).toBe(false);
    });
  });
});
