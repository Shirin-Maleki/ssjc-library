import { describe, expect, it, vi } from "vitest";
import type {
  CoverStorageProvider,
  DriveConnectionStatus,
  DriveFileMetadata,
  DriveListResult,
  InitiateResumableUploadParams,
  ResumableUploadSession,
  ConfirmUploadedFileParams,
} from "@/lib/googleDrive/provider";
import { DriveProviderError } from "@/lib/googleDrive/provider";
import { runSmokeTest, isSafeToCleanUp, DISPOSABLE_FILE_PREFIX, type SmokeTestDependencies } from "../../../scripts/google/smokeOrchestration";

const ROOT_FOLDER_ID = "root-folder-id";
const FIXED_NOW = 1_700_000_000_000;
const PNG_BYTES = Buffer.from([1, 2, 3, 4]);

function connectionStatus(overrides: Partial<DriveConnectionStatus> = {}): DriveConnectionStatus {
  return {
    connected: true,
    rootFolderId: ROOT_FOLDER_ID,
    rootFolderName: "SSJC Library Covers",
    rootIsFolder: true,
    rootTrashed: false,
    rootIsSharedDrive: false,
    canCreateChildren: true,
    checkedAt: new Date(FIXED_NOW).toISOString(),
    ...overrides,
  };
}

function fileMetadata(overrides: Partial<DriveFileMetadata> = {}): DriveFileMetadata {
  return {
    id: "uploaded-file-id",
    name: `${DISPOSABLE_FILE_PREFIX}${FIXED_NOW}.png`,
    mimeType: "image/png",
    size: PNG_BYTES.length,
    createdTime: new Date(FIXED_NOW).toISOString(),
    modifiedTime: new Date(FIXED_NOW).toISOString(),
    parents: [ROOT_FOLDER_ID],
    isFolder: false,
    trashed: false,
    capabilities: { canDownload: true, canAddChildren: false, canTrash: true },
    ...overrides,
  };
}

function emptyListing(): DriveListResult {
  return { files: [] };
}

/** A minimal, fully in-memory `CoverStorageProvider` fake. Every method has a sensible
 * happy-path default; individual tests override just the one method they need to fail. This
 * is the mechanism that makes the cleanup guarantee deterministically testable without any
 * real Google credentials or network calls. */
function makeFakeProvider(overrides: Partial<CoverStorageProvider> = {}): CoverStorageProvider {
  return {
    verifyConnection: vi.fn(async () => connectionStatus()),
    listChildren: vi.fn(async (): Promise<DriveListResult> => emptyListing()),
    getFileMetadata: vi.fn(async (fileId: string) => fileMetadata({ id: fileId })),
    downloadSource: vi.fn(async () => ({ bytes: Buffer.from(PNG_BYTES), metadata: fileMetadata() })),
    initiateResumableUpload: vi.fn(
      async (params: InitiateResumableUploadParams): Promise<ResumableUploadSession> => ({
        sessionUri: "https://upload.example/session/fake",
        parentFolderId: params.parentFolderId,
        filename: params.filename,
        mimeType: params.mimeType,
        sizeBytes: params.sizeBytes,
      })
    ),
    confirmUploadedFile: vi.fn(async (params: ConfirmUploadedFileParams) =>
      fileMetadata({ id: params.fileId, name: params.expectedFilename })
    ),
    trashFile: vi.fn(async () => undefined),
    ...overrides,
  };
}

function makeDeps(providerOverrides: Partial<CoverStorageProvider> = {}): SmokeTestDependencies {
  return {
    provider: makeFakeProvider(providerOverrides),
    generatePng: () => Buffer.from(PNG_BYTES),
    now: () => FIXED_NOW,
    uploadBytes: vi.fn(async () => ({ id: "uploaded-file-id" })),
  };
}

describe("scripts/google/smokeOrchestration", () => {
  it("succeeds end to end against a fully happy-path fake provider, and cleans up via Step F", async () => {
    const deps = makeDeps();
    const report = await runSmokeTest(deps);

    expect(report.success).toBe(true);
    expect(report.failure).toBeUndefined();
    expect(report.cleanup).toEqual({ attempted: true, succeeded: true, fileId: "uploaded-file-id" });
    expect(deps.provider.trashFile).toHaveBeenCalledExactlyOnceWith("uploaded-file-id");
    expect(report.existingAssetsModified).toBe(false);
  });

  it("never calls trashFile when the upload itself fails (no file id was ever created)", async () => {
    const deps = makeDeps({
      initiateResumableUpload: vi.fn(async () => {
        throw new DriveProviderError("upload_failed", "simulated initiate failure");
      }),
    });
    const report = await runSmokeTest(deps);

    expect(report.success).toBe(false);
    expect(report.failure?.step).toBe("C");
    expect(report.cleanup).toEqual({ attempted: false, succeeded: false });
    expect(deps.provider.trashFile).not.toHaveBeenCalled();
  });

  it("cleans up the disposable file when confirmation (Step D) fails after a successful upload", async () => {
    const deps = makeDeps({
      confirmUploadedFile: vi.fn(async () => {
        throw new DriveProviderError("upload_failed", "simulated confirmation mismatch");
      }),
    });
    const report = await runSmokeTest(deps);

    expect(report.success).toBe(false);
    expect(report.failure?.step).toBe("D");
    expect(report.failure?.message).toContain("simulated confirmation mismatch");
    expect(report.cleanup).toEqual({ attempted: true, succeeded: true, fileId: "uploaded-file-id" });
    expect(deps.provider.trashFile).toHaveBeenCalledExactlyOnceWith("uploaded-file-id");
  });

  it("cleans up the disposable file when download (Step E) fails after a successful upload+confirmation", async () => {
    const deps = makeDeps({
      downloadSource: vi.fn(async () => {
        throw new DriveProviderError("download_failed", "simulated download failure");
      }),
    });
    const report = await runSmokeTest(deps);

    expect(report.success).toBe(false);
    expect(report.failure?.step).toBe("E");
    expect(report.cleanup).toEqual({ attempted: true, succeeded: true, fileId: "uploaded-file-id" });
  });

  it("cleans up when the downloaded bytes don't match the uploaded ones", async () => {
    const deps = makeDeps({
      downloadSource: vi.fn(async () => ({ bytes: Buffer.from([9, 9, 9, 9]), metadata: fileMetadata() })),
    });
    const report = await runSmokeTest(deps);

    expect(report.success).toBe(false);
    expect(report.failure?.step).toBe("E");
    expect(report.failure?.message).toContain("did not match");
    expect(report.cleanup.succeeded).toBe(true);
  });

  it("reports a cleanup failure SEPARATELY, without hiding the original validation failure", async () => {
    const deps = makeDeps({
      confirmUploadedFile: vi.fn(async () => {
        throw new DriveProviderError("upload_failed", "simulated confirmation mismatch");
      }),
      trashFile: vi.fn(async () => {
        throw new DriveProviderError("permission_denied", "simulated trash failure");
      }),
    });
    const report = await runSmokeTest(deps);

    expect(report.success).toBe(false);
    // The ORIGINAL failure (Step D) is still what's reported as the failure.
    expect(report.failure?.step).toBe("D");
    expect(report.failure?.message).toContain("simulated confirmation mismatch");
    // The cleanup failure is recorded separately, in its own field, not merged into `failure`.
    expect(report.cleanup.attempted).toBe(true);
    expect(report.cleanup.succeeded).toBe(false);
    expect(report.cleanup.error).toContain("simulated trash failure");
    expect(report.cleanup.fileId).toBe("uploaded-file-id");
  });

  it("cleans up when Step F's own safety checks fail (mismatched confirmed id)", async () => {
    const deps = makeDeps({
      confirmUploadedFile: vi.fn(async (params: ConfirmUploadedFileParams) => fileMetadata({ id: "a-different-id", name: params.expectedFilename })),
    });
    const report = await runSmokeTest(deps);

    expect(report.success).toBe(false);
    expect(report.failure?.step).toBe("F");
    expect(report.cleanup.attempted).toBe(true);
    expect(report.cleanup.succeeded).toBe(true);
  });

  it("cleans up when Step G's mutation-safety check fails (a pre-existing id goes missing)", async () => {
    let listCallCount = 0;
    const deps = makeDeps({
      listChildren: vi.fn(async (): Promise<DriveListResult> => {
        listCallCount += 1;
        // First call (Step B): one pre-existing file. Second call (Step G): that file is
        // gone — a real mutation-safety violation the smoke test must catch.
        return listCallCount === 1 ? { files: [fileMetadata({ id: "pre-existing-file" })] } : emptyListing();
      }),
    });
    const report = await runSmokeTest(deps);

    expect(report.success).toBe(false);
    expect(report.failure?.step).toBe("G");
    expect(report.cleanup.succeeded).toBe(true);
  });

  it("does not attempt cleanup twice — a second call after Step F's own cleanup is a no-op", async () => {
    const deps = makeDeps();
    await runSmokeTest(deps);
    // trashFile should have been called exactly once (by Step F), not once more by the
    // catch-block's cleanup guarantee running redundantly on the happy path.
    expect(deps.provider.trashFile).toHaveBeenCalledTimes(1);
  });

  it("the disposable-prefix guard (isSafeToCleanUp) accepts only correctly-prefixed names", () => {
    expect(isSafeToCleanUp(`${DISPOSABLE_FILE_PREFIX}1234567890.png`)).toBe(true);
    expect(isSafeToCleanUp("cover-photo.jpg")).toBe(false);
    expect(isSafeToCleanUp("")).toBe(false);
    expect(isSafeToCleanUp("__ssjc_phase6_smoke")).toBe(false); // prefix alone, no trailing name
  });

  it("the orchestration always generates a correctly disposable-prefixed filename on the real happy path", async () => {
    const deps = makeDeps();
    const report = await runSmokeTest(deps);
    const generatedNameStep = report.steps.find((s) => s.message.includes("Generated a"));
    expect(generatedNameStep?.message).toContain(DISPOSABLE_FILE_PREFIX);
    expect(isSafeToCleanUp(`${DISPOSABLE_FILE_PREFIX}${FIXED_NOW}.png`)).toBe(true);
  });
});
