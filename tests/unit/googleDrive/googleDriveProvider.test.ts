import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DriveProviderError } from "@/lib/googleDrive/provider";
import { GoogleDriveCoverStorageProvider } from "@/lib/googleDrive/googleDriveProvider";
import { __resetAccessTokenCacheForTests } from "@/lib/googleDrive/oauthClient";

const ROOT_FOLDER_ID = "root-folder-id";
const ENV_VARS = [
  "GOOGLE_OAUTH_CLIENT_ID",
  "GOOGLE_OAUTH_CLIENT_SECRET",
  "GOOGLE_OAUTH_REFRESH_TOKEN",
  "GOOGLE_DRIVE_ROOT_FOLDER_ID",
] as const;
const ORIGINAL_ENV: Record<string, string | undefined> = {};

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

function fileResource(overrides: Record<string, unknown> = {}) {
  return {
    id: "file-1",
    name: "cover.jpg",
    mimeType: "image/jpeg",
    size: "12345",
    createdTime: "2026-01-01T00:00:00.000Z",
    modifiedTime: "2026-01-01T00:00:00.000Z",
    parents: [ROOT_FOLDER_ID],
    trashed: false,
    capabilities: { canDownload: true, canAddChildren: false, canTrash: true },
    ...overrides,
  };
}

function folderResource(overrides: Record<string, unknown> = {}) {
  return fileResource({
    id: ROOT_FOLDER_ID,
    name: "SSJC Library Covers",
    mimeType: "application/vnd.google-apps.folder",
    size: undefined,
    capabilities: { canDownload: false, canAddChildren: true, canTrash: false },
    ...overrides,
  });
}

/** Mocks `fetch` to always resolve to the given access-token response first, then Drive
 * responses in order — mirrors the real call sequence (`getAccessToken()` then the Drive
 * REST call) without needing a real token endpoint. */
function mockTokenThenDrive(...driveResponses: Response[]) {
  const tokenResponse = jsonResponse({ access_token: "test-access-token", expires_in: 3600 });
  return vi.spyOn(globalThis, "fetch").mockImplementation((url) => {
    if (String(url).includes("oauth2.googleapis.com")) return Promise.resolve(tokenResponse.clone());
    const next = driveResponses.shift();
    if (!next) throw new Error("mockTokenThenDrive: ran out of queued Drive responses");
    return Promise.resolve(next);
  });
}

describe("GoogleDriveCoverStorageProvider (mocked Drive REST)", () => {
  let provider: GoogleDriveCoverStorageProvider;

  beforeEach(() => {
    __resetAccessTokenCacheForTests();
    for (const key of ENV_VARS) ORIGINAL_ENV[key] = process.env[key];
    process.env.GOOGLE_OAUTH_CLIENT_ID = "test-client-id";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-client-secret";
    process.env.GOOGLE_OAUTH_REFRESH_TOKEN = "test-refresh-token";
    process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID = ROOT_FOLDER_ID;
    provider = new GoogleDriveCoverStorageProvider();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    __resetAccessTokenCacheForTests();
    for (const key of ENV_VARS) {
      if (ORIGINAL_ENV[key] === undefined) delete process.env[key];
      else process.env[key] = ORIGINAL_ENV[key];
    }
  });

  describe("verifyConnection", () => {
    it("succeeds for a My Drive-style root (no driveId)", async () => {
      mockTokenThenDrive(jsonResponse(folderResource()));
      const status = await provider.verifyConnection();
      expect(status.connected).toBe(true);
      expect(status.rootIsSharedDrive).toBe(false);
      expect(status.sharedDriveId).toBeUndefined();
      expect(status.rootIsFolder).toBe(true);
      expect(status.canCreateChildren).toBe(true);
    });

    it("succeeds for a Shared Drive-style root (driveId present)", async () => {
      mockTokenThenDrive(jsonResponse(folderResource({ driveId: "shared-drive-id" })));
      const status = await provider.verifyConnection();
      expect(status.rootIsSharedDrive).toBe(true);
      expect(status.sharedDriveId).toBe("shared-drive-id");
    });

    it("maps a missing root (404) to root_folder_missing", async () => {
      mockTokenThenDrive(jsonResponse({}, 404));
      await expect(provider.verifyConnection()).rejects.toMatchObject({ category: "root_folder_missing" });
    });

    it("maps a trashed root to root_folder_missing", async () => {
      mockTokenThenDrive(jsonResponse(folderResource({ trashed: true })));
      await expect(provider.verifyConnection()).rejects.toMatchObject({ category: "root_folder_missing" });
    });

    it("maps a root that isn't actually a folder to root_folder_missing", async () => {
      mockTokenThenDrive(jsonResponse(fileResource({ id: ROOT_FOLDER_ID })));
      await expect(provider.verifyConnection()).rejects.toMatchObject({ category: "root_folder_missing" });
    });

    it("maps a revoked credential (401) to authorization_required", async () => {
      mockTokenThenDrive(jsonResponse({}, 401));
      await expect(provider.verifyConnection()).rejects.toMatchObject({ category: "authorization_required" });
    });
  });

  describe("listChildren", () => {
    it("lists the root's children within a bounded page size", async () => {
      // assertWithinRoot(ROOT_FOLDER_ID) short-circuits (candidate === root), so only one
      // Drive call (the listing itself) is needed.
      mockTokenThenDrive(jsonResponse({ files: [fileResource(), fileResource({ id: "file-2" })] }));
      const result = await provider.listChildren(ROOT_FOLDER_ID);
      expect(result.files).toHaveLength(2);
      expect(result.files[0].id).toBe("file-1");
    });

    it("caps an oversized requested page size at the hard maximum", async () => {
      const fetchMock = mockTokenThenDrive(jsonResponse({ files: [] }));
      await provider.listChildren(ROOT_FOLDER_ID, { pageSize: 100_000 });
      const driveCall = fetchMock.mock.calls.find(([url]) => String(url).includes("/files?"));
      const url = new URL(String(driveCall![0]));
      expect(Number(url.searchParams.get("pageSize"))).toBeLessThanOrEqual(200);
    });

    it("passes through a pagination token and returns the next one", async () => {
      const fetchMock = mockTokenThenDrive(jsonResponse({ files: [], nextPageToken: "next-page" }));
      const result = await provider.listChildren(ROOT_FOLDER_ID, { pageToken: "prior-page" });
      expect(result.nextPageToken).toBe("next-page");
      const driveCall = fetchMock.mock.calls.find(([url]) => String(url).includes("/files?"));
      const url = new URL(String(driveCall![0]));
      expect(url.searchParams.get("pageToken")).toBe("prior-page");
    });

    it("scopes the query to the parent folder and excludes trashed files", async () => {
      const fetchMock = mockTokenThenDrive(jsonResponse({ files: [] }));
      await provider.listChildren(ROOT_FOLDER_ID);
      const driveCall = fetchMock.mock.calls.find(([url]) => String(url).includes("/files?"));
      const url = new URL(String(driveCall![0]));
      const q = url.searchParams.get("q");
      expect(q).toContain(`'${ROOT_FOLDER_ID}' in parents`);
      expect(q).toContain("trashed = false");
    });

    it("sets Shared Drive compatibility flags on every listing request", async () => {
      const fetchMock = mockTokenThenDrive(jsonResponse({ files: [] }));
      await provider.listChildren(ROOT_FOLDER_ID);
      const driveCall = fetchMock.mock.calls.find(([url]) => String(url).includes("/files?"));
      const url = new URL(String(driveCall![0]));
      expect(url.searchParams.get("supportsAllDrives")).toBe("true");
      expect(url.searchParams.get("includeItemsFromAllDrives")).toBe("true");
    });

    it("denies listing a folder outside the configured root", async () => {
      // getParentsForContainment resolves to a parent chain that never reaches the root.
      mockTokenThenDrive(jsonResponse({ parents: ["some-other-folder"] }), jsonResponse({ parents: [] }));
      await expect(provider.listChildren("outside-folder-id")).rejects.toMatchObject({ category: "outside_configured_root" });
    });
  });

  describe("getFileMetadata", () => {
    it("normalizes a real Drive file resource", async () => {
      mockTokenThenDrive(
        jsonResponse(
          fileResource({
            id: "abc123",
            name: "original-name.jpg",
            md5Checksum: "d41d8cd98f00b204e9800998ecf8427e",
          })
        )
      );
      const metadata = await provider.getFileMetadata("abc123");
      expect(metadata.id).toBe("abc123");
      expect(metadata.name).toBe("original-name.jpg");
      expect(metadata.mimeType).toBe("image/jpeg");
      expect(metadata.size).toBe(12345);
      expect(metadata.parents).toEqual([ROOT_FOLDER_ID]);
      expect(metadata.md5Checksum).toBe("d41d8cd98f00b204e9800998ecf8427e");
      expect(metadata.isFolder).toBe(false);
      expect(metadata.trashed).toBe(false);
    });

    it("a rename does not change identity — the id is what's retained, not the name", async () => {
      mockTokenThenDrive(jsonResponse(fileResource({ id: "stable-id", name: "renamed-file.jpg" })));
      const metadata = await provider.getFileMetadata("stable-id");
      expect(metadata.id).toBe("stable-id");
      expect(metadata.name).toBe("renamed-file.jpg");
    });

    it("maps a missing file (404) to file_not_found", async () => {
      mockTokenThenDrive(jsonResponse({}, 404));
      await expect(provider.getFileMetadata("missing-id")).rejects.toMatchObject({ category: "file_not_found" });
    });

    it("maps a permission-denied response (403) to permission_denied", async () => {
      mockTokenThenDrive(jsonResponse({}, 403));
      await expect(provider.getFileMetadata("no-access-id")).rejects.toMatchObject({ category: "permission_denied" });
    });

    it("throws unexpected_provider_failure on a malformed (non-JSON) Google response", async () => {
      mockTokenThenDrive(new Response("not json", { status: 200 }));
      await expect(provider.getFileMetadata("some-id")).rejects.toThrow();
    });
  });

  describe("downloadSource", () => {
    it("downloads a file's bytes and returns them with metadata", async () => {
      const bytes = new Uint8Array([1, 2, 3, 4]);
      mockTokenThenDrive(
        jsonResponse(fileResource({ id: "file-1" })), // getFileMetadata
        new Response(bytes, { status: 200 }) // alt=media download
      );
      const result = await provider.downloadSource("file-1");
      expect(Buffer.from(result.bytes)).toEqual(Buffer.from(bytes));
      expect(result.metadata.id).toBe("file-1");
    });

    it("refuses to download a folder", async () => {
      mockTokenThenDrive(jsonResponse(folderResource()));
      await expect(provider.downloadSource(ROOT_FOLDER_ID)).rejects.toMatchObject({ category: "invalid_file" });
    });

    it("refuses to download a trashed file", async () => {
      mockTokenThenDrive(jsonResponse(fileResource({ trashed: true })));
      await expect(provider.downloadSource("file-1")).rejects.toMatchObject({ category: "file_not_found" });
    });

    it("refuses to download when the account lacks download capability", async () => {
      mockTokenThenDrive(jsonResponse(fileResource({ capabilities: { canDownload: false, canAddChildren: false, canTrash: true } })));
      await expect(provider.downloadSource("file-1")).rejects.toMatchObject({ category: "permission_denied" });
    });
  });

  describe("initiateResumableUpload", () => {
    const validParams = { parentFolderId: ROOT_FOLDER_ID, filename: "cover.jpg", mimeType: "image/jpeg", sizeBytes: 1024 };

    it("initiates a resumable session and returns the Location header as sessionUri", async () => {
      mockTokenThenDrive(
        jsonResponse(folderResource()), // parent metadata check
        new Response(null, { status: 200, headers: { Location: "https://upload.example/session/abc" } })
      );
      const session = await provider.initiateResumableUpload(validParams);
      expect(session.sessionUri).toBe("https://upload.example/session/abc");
      expect(session.parentFolderId).toBe(ROOT_FOLDER_ID);
      expect(session.mimeType).toBe("image/jpeg");
    });

    it("throws upload_failed when Google omits the Location header", async () => {
      mockTokenThenDrive(jsonResponse(folderResource()), new Response(null, { status: 200 }));
      await expect(provider.initiateResumableUpload(validParams)).rejects.toMatchObject({ category: "upload_failed" });
    });

    it("rejects an unsupported MIME type before ever calling Drive", async () => {
      const fetchMock = vi.spyOn(globalThis, "fetch");
      await expect(provider.initiateResumableUpload({ ...validParams, mimeType: "application/pdf" })).rejects.toMatchObject({
        category: "invalid_file",
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("rejects an oversized file before ever calling Drive", async () => {
      const fetchMock = vi.spyOn(globalThis, "fetch");
      await expect(provider.initiateResumableUpload({ ...validParams, sizeBytes: 999_999_999 })).rejects.toMatchObject({
        category: "invalid_file",
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("rejects an invalid (zero) size", async () => {
      await expect(provider.initiateResumableUpload({ ...validParams, sizeBytes: 0 })).rejects.toMatchObject({ category: "invalid_file" });
    });

    it("rejects an invalid parent folder (not actually a folder)", async () => {
      mockTokenThenDrive(jsonResponse(fileResource({ id: ROOT_FOLDER_ID })));
      await expect(provider.initiateResumableUpload(validParams)).rejects.toMatchObject({ category: "invalid_file" });
    });

    it("denies uploading into a folder outside the configured root", async () => {
      mockTokenThenDrive(
        jsonResponse(folderResource({ id: "outside-folder", parents: ["outside"] })), // getFileMetadata(parentFolderId)
        jsonResponse({ parents: [] }) // getParentsForContainment("outside") — dead end, never reaches root
      );
      await expect(provider.initiateResumableUpload({ ...validParams, parentFolderId: "outside-folder" })).rejects.toMatchObject({
        category: "outside_configured_root",
      });
    });

    it("never includes the resumable session URI in a thrown error message", async () => {
      mockTokenThenDrive(jsonResponse(folderResource()), jsonResponse({}, 500));
      try {
        await provider.initiateResumableUpload(validParams);
        expect.unreachable();
      } catch (error) {
        expect((error as DriveProviderError).message).not.toContain("upload.example");
      }
    });
  });

  describe("confirmUploadedFile", () => {
    const expected = {
      fileId: "uploaded-file-id",
      expectedParentFolderId: ROOT_FOLDER_ID,
      expectedFilename: "cover.jpg",
      expectedMimeType: "image/jpeg",
      expectedSizeBytes: 1024,
    };

    it("confirms a valid completed upload by re-fetching from Drive", async () => {
      mockTokenThenDrive(
        jsonResponse(fileResource({ id: "uploaded-file-id", name: "cover.jpg", size: "1024", mimeType: "image/jpeg" }))
      );
      const metadata = await provider.confirmUploadedFile(expected);
      expect(metadata.id).toBe("uploaded-file-id");
    });

    it("rejects when the parent does not match (even though that parent is itself validly within the root)", async () => {
      mockTokenThenDrive(
        jsonResponse(fileResource({ id: "uploaded-file-id", parents: ["a-different-folder-in-root"] })),
        jsonResponse({ parents: [ROOT_FOLDER_ID] }) // "a-different-folder-in-root" resolves within root — a real business mismatch, not a security violation
      );
      await expect(provider.confirmUploadedFile(expected)).rejects.toMatchObject({ category: "upload_failed" });
    });

    it("rejects when the MIME type does not match", async () => {
      mockTokenThenDrive(jsonResponse(fileResource({ id: "uploaded-file-id", mimeType: "image/png" })));
      await expect(provider.confirmUploadedFile(expected)).rejects.toMatchObject({ category: "upload_failed" });
    });

    it("rejects when the size does not match", async () => {
      mockTokenThenDrive(jsonResponse(fileResource({ id: "uploaded-file-id", size: "999" })));
      await expect(provider.confirmUploadedFile(expected)).rejects.toMatchObject({ category: "upload_failed" });
    });

    it("rejects when the file is outside the configured root", async () => {
      mockTokenThenDrive(
        jsonResponse(fileResource({ id: "uploaded-file-id", parents: ["outside-folder"] })),
        jsonResponse({ parents: ["also-outside"] }),
        jsonResponse({ parents: [] })
      );
      await expect(provider.confirmUploadedFile(expected)).rejects.toMatchObject({ category: "outside_configured_root" });
    });

    it("rejects when Drive reports the file as missing", async () => {
      mockTokenThenDrive(jsonResponse({}, 404));
      await expect(provider.confirmUploadedFile(expected)).rejects.toMatchObject({ category: "file_not_found" });
    });
  });

  describe("secret safety across a realistic failure sequence", () => {
    it("never leaks the client secret or refresh token through any thrown error in a verifyConnection failure", async () => {
      process.env.GOOGLE_OAUTH_CLIENT_SECRET = "definitely-secret-value";
      process.env.GOOGLE_OAUTH_REFRESH_TOKEN = "definitely-secret-refresh-token";
      mockTokenThenDrive(jsonResponse({}, 403));
      try {
        await provider.verifyConnection();
        expect.unreachable();
      } catch (error) {
        const message = (error as DriveProviderError).message;
        expect(message).not.toContain("definitely-secret-value");
        expect(message).not.toContain("definitely-secret-refresh-token");
      }
    });
  });
});
