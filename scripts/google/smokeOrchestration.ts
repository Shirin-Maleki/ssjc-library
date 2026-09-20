import zlib from "node:zlib";
import type { CoverStorageProvider, DriveFileMetadata } from "../../src/lib/googleDrive/provider";
import { DriveProviderError } from "../../src/lib/googleDrive/provider";

/**
 * The pure, provider-injected orchestration logic behind `npm run google:smoke` (Phase 6
 * §32; cleanup-guarantee correction 2026-09-20). Extracted from `smoke.ts` specifically so
 * the cleanup guarantee below — "once a real disposable file exists, every failure path
 * still attempts to trash it" — is deterministically testable
 * (`tests/unit/googleDrive/smokeOrchestration.test.ts`) against a fake `CoverStorageProvider`,
 * without any real Google credentials or network calls. `smoke.ts` itself is a thin CLI
 * wrapper: construct the real provider, call `runSmokeTest`, print the result, set the exit
 * code.
 *
 * The bug this correction fixes: the original script called `process.exit(1)` directly from
 * every failure path (via a `fail()` helper), including every failure *after* Step C had
 * already created a real, disposable Drive file — leaving `__ssjc_phase6_smoke_*.png`
 * orphaned in the real configured root whenever confirmation (Step D), download (Step E), or
 * even a bug in Step F/G's own checks failed. `runSmokeTest` never calls `process.exit`; it
 * always returns a `SmokeTestReport`, and a single `try/finally`-equivalent guarantees a
 * cleanup attempt runs whenever `uploadedFileId` was set and hasn't already been cleaned up
 * by the normal Step F path.
 */

export const DISPOSABLE_FILE_PREFIX = "__ssjc_phase6_smoke_";

/** The one guard standing between "a real Drive file id exists" and "this orchestration is
 * willing to trash it" — extracted as its own pure function so the guard's logic is directly
 * unit-testable, independent of the full orchestration's internal state (which always
 * generates a correctly-prefixed name itself, making the failure branch otherwise
 * unreachable through the public API surface alone). */
export function isSafeToCleanUp(filename: string): boolean {
  return filename.startsWith(DISPOSABLE_FILE_PREFIX);
}
const SAMPLE_CHILD_FOLDERS_TO_INSPECT = 3;
const SAMPLE_METADATA_PAGE_SIZE = 3;

export interface SmokeTestLogLine {
  step: string;
  message: string;
}

export interface SmokeTestCleanupReport {
  /** `false` only when nothing was ever created (no real file id exists to clean up), or
   * when Step F already cleaned up successfully on the happy path. */
  attempted: boolean;
  succeeded: boolean;
  /** Present only when `attempted` is true and `succeeded` is false. Never the original
   * validation failure — see `SmokeTestReport.failure` for that. */
  error?: string;
  fileId?: string;
}

export interface SmokeTestReport {
  success: boolean;
  steps: SmokeTestLogLine[];
  failure?: { step: string; message: string };
  cleanup: SmokeTestCleanupReport;
  /** Only meaningful when `success` is true (Step G actually ran and compared listings). */
  existingAssetsModified?: boolean;
}

/** Carries which step failed through the orchestration's single try/catch, without losing
 * step attribution the way a bare `Error` would. */
class OrchestrationFailure extends Error {
  constructor(readonly step: string, message: string) {
    super(message);
    this.name = "OrchestrationFailure";
  }
}

/** Formats any error for the report without ever including a secret or raw Google response
 * body — `DriveProviderError.message` is already safe by construction
 * (`docs/GOOGLE_INTEGRATION.md`); any other error type falls back to its own `.message`. */
function describeError(error: unknown): string {
  if (error instanceof DriveProviderError) return `[${error.category}] ${error.message}`;
  if (error instanceof Error) return error.message;
  return String(error);
}

function crc32(buf: Buffer): number {
  return zlib.crc32(buf) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([length, typeBuf, data, crc]);
}

/** Builds a real, valid, tiny (1x1 white pixel) PNG entirely in memory — never a binary
 * asset committed to the repository (§32 of the phase brief: "without committing an image
 * binary"). Constructed chunk-by-chunk with real CRC32s rather than a hand-typed byte
 * literal, so its validity doesn't depend on trusting an opaque constant. */
export function generateTinySyntheticPng(): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(1, 0); // width = 1
  ihdrData.writeUInt32BE(1, 4); // height = 1
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 2; // color type: truecolor RGB
  ihdrData[10] = 0; // compression method
  ihdrData[11] = 0; // filter method
  ihdrData[12] = 0; // interlace method
  const ihdr = pngChunk("IHDR", ihdrData);

  const rawScanline = Buffer.from([0, 255, 255, 255]); // filter byte + one white RGB pixel
  const idat = pngChunk("IDAT", zlib.deflateSync(rawScanline));

  const iend = pngChunk("IEND", Buffer.alloc(0));

  return Buffer.concat([signature, ihdr, idat, iend]);
}

export interface SmokeTestDependencies {
  provider: CoverStorageProvider;
  /** Injected so a test can supply a deterministic fixed-size buffer instead of a real PNG. */
  generatePng: () => Buffer;
  /** Injected so a test never makes a real `fetch` call to a resumable session URI. */
  uploadBytes: (sessionUri: string, bytes: Buffer, mimeType: string) => Promise<{ id?: string }>;
  /** Injected so a test can produce a deterministic filename. */
  now: () => number;
}

export async function runSmokeTest(deps: SmokeTestDependencies): Promise<SmokeTestReport> {
  const steps: SmokeTestLogLine[] = [];
  const log = (step: string, message: string) => steps.push({ step, message });

  let uploadedFileId: string | undefined;
  let disposableFilename: string | undefined;
  let rootFolderId: string | undefined;
  let cleanup: SmokeTestCleanupReport = { attempted: false, succeeded: false };

  /**
   * The cleanup guarantee itself. Safe to call multiple times (a no-op once cleanup has
   * already succeeded) and safe to call when nothing was ever created. Retains every safety
   * check the original script had — the exact uploaded file id, the disposable-filename
   * prefix — and delegates root-containment enforcement to `provider.trashFile` itself
   * (§14 of the phase brief: every provider method already enforces this). Never a
   * wildcard/search-based cleanup: it only ever knows about the one file id this exact
   * invocation created.
   */
  async function attemptCleanupIfNeeded(): Promise<void> {
    if (!uploadedFileId || !disposableFilename) return; // nothing was ever created
    if (cleanup.succeeded) return; // Step F already cleaned up on the happy path

    if (!isSafeToCleanUp(disposableFilename)) {
      // Should be unreachable in practice (this script generates the filename itself with
      // the correct prefix) — retained as a defensive guard, per the phase brief, against
      // ever trashing something whose provenance isn't unambiguously this invocation's own.
      cleanup = {
        attempted: false,
        succeeded: false,
        error: "Refusing to clean up: the disposable filename does not have the expected prefix.",
        fileId: uploadedFileId,
      };
      return;
    }

    try {
      await deps.provider.trashFile(uploadedFileId);
      cleanup = { attempted: true, succeeded: true, fileId: uploadedFileId };
    } catch (error) {
      cleanup = { attempted: true, succeeded: false, error: describeError(error), fileId: uploadedFileId };
    }
  }

  try {
    // --- Step A: connection ---------------------------------------------------------
    const status = await catchStep("A", () => deps.provider.verifyConnection());
    rootFolderId = status.rootFolderId;
    log("A", `Connected. Root folder: "${status.rootFolderName}" (${status.rootFolderId})`);
    log("A", `Shared Drive: ${status.rootIsSharedDrive ? `yes (${status.sharedDriveId})` : "no (My Drive)"}`);
    log("A", `Can create children under root: ${status.canCreateChildren}`);

    // --- Step B: bounded metadata access ----------------------------------------------
    const rootListing = await catchStep("B", () => deps.provider.listChildren(rootFolderId!, { pageSize: 50 }));
    const preExistingChildIds = rootListing.files.map((f) => f.id).sort();
    log("B", `Root has ${rootListing.files.length} immediate non-trashed child item(s) (this page).`);
    for (const child of rootListing.files) {
      log("B", `  - ${child.isFolder ? "[folder]" : "[file]  "} "${child.name}" (${child.id})`);
    }
    const childFolders = rootListing.files.filter((f) => f.isFolder).slice(0, SAMPLE_CHILD_FOLDERS_TO_INSPECT);
    for (const folder of childFolders) {
      try {
        const sample = await deps.provider.listChildren(folder.id, { pageSize: SAMPLE_METADATA_PAGE_SIZE });
        log("B", `  Sampled "${folder.name}": ${sample.files.length} item(s) in a bounded ${SAMPLE_METADATA_PAGE_SIZE}-item page (not processed).`);
      } catch (error) {
        log("B", `  Could not sample "${folder.name}": ${describeError(error)} (non-fatal — continuing).`);
      }
    }

    // --- Step C: disposable upload -----------------------------------------------------
    const pngBytes = deps.generatePng();
    disposableFilename = `${DISPOSABLE_FILE_PREFIX}${deps.now()}.png`;
    log("C", `Generated a ${pngBytes.length}-byte synthetic PNG named "${disposableFilename}".`);

    const session = await catchStep("C", () =>
      deps.provider.initiateResumableUpload({
        parentFolderId: rootFolderId!,
        filename: disposableFilename!,
        mimeType: "image/png",
        sizeBytes: pngBytes.length,
      })
    );
    log("C", "Resumable upload session initiated (session URI withheld from all output, as designed).");

    const uploaded = await catchStep("C", () => deps.uploadBytes(session.sessionUri, pngBytes, "image/png"));
    if (!uploaded.id) throw new OrchestrationFailure("C", "Google's upload response did not include a file id.");
    // From this exact point on, a real Drive file exists — every subsequent failure path
    // (including ones below) must attempt cleanup before this function returns.
    uploadedFileId = uploaded.id;
    log("C", `Upload complete. Real Drive file ID: ${uploadedFileId}`);

    // --- Step D: confirmation -----------------------------------------------------------
    const confirmed: DriveFileMetadata = await catchStep("D", () =>
      deps.provider.confirmUploadedFile({
        fileId: uploadedFileId!,
        expectedParentFolderId: rootFolderId!,
        expectedFilename: disposableFilename!,
        expectedMimeType: "image/png",
        expectedSizeBytes: pngBytes.length,
      })
    );
    log("D", `Confirmed: parent, MIME type, size, and filename all match. Checksum: ${confirmed.md5Checksum ?? "(not supplied)"}`);

    // --- Step E: download -----------------------------------------------------------------
    const downloaded = await catchStep("E", () => deps.provider.downloadSource(uploadedFileId!));
    const bytesMatch = Buffer.compare(downloaded.bytes, pngBytes) === 0;
    log("E", `Downloaded ${downloaded.bytes.length} bytes. Byte-for-byte match with the original synthetic PNG: ${bytesMatch}.`);
    if (!bytesMatch) throw new OrchestrationFailure("E", "Downloaded bytes did not match the originally uploaded synthetic PNG.");

    // --- Step F: cleanup ------------------------------------------------------------------
    if (uploadedFileId !== confirmed.id) {
      throw new OrchestrationFailure("F", "Safety check failed: the file id to clean up does not match the confirmed upload's id.");
    }
    if (!confirmed.name.startsWith(DISPOSABLE_FILE_PREFIX)) {
      throw new OrchestrationFailure("F", "Safety check failed: the file to clean up does not have the expected disposable-test filename prefix.");
    }
    await catchStep("F", () => deps.provider.trashFile(uploadedFileId!));
    cleanup = { attempted: true, succeeded: true, fileId: uploadedFileId };
    log("F", `Trashed the disposable test file (${uploadedFileId}). Nothing else was touched.`);

    // --- Step G: mutation safety ------------------------------------------------------------
    const finalListing = await catchStep("G", () => deps.provider.listChildren(rootFolderId!, { pageSize: 50 }));
    const finalChildIds = finalListing.files.map((f) => f.id).sort();
    const allPreExistingStillPresent = preExistingChildIds.every((id) => finalChildIds.includes(id));
    const testFileGone = !finalChildIds.includes(uploadedFileId);
    log("G", `Pre-existing child count: ${preExistingChildIds.length}. Post-cleanup child count: ${finalChildIds.length}.`);
    log("G", `Every pre-existing child id still present: ${allPreExistingStillPresent}.`);
    log("G", `Disposable test file no longer listed (trashed): ${testFileGone}.`);
    if (!allPreExistingStillPresent || !testFileGone) {
      throw new OrchestrationFailure("G", "Mutation-safety check failed — see the log lines above.");
    }

    return { success: true, steps, cleanup, existingAssetsModified: false };
  } catch (error) {
    // The cleanup guarantee: reached from every throw above, including ones raised after a
    // real disposable file was created. A cleanup failure is recorded separately and never
    // overwrites or hides the original validation failure below.
    await attemptCleanupIfNeeded();
    const step = error instanceof OrchestrationFailure ? error.step : "unexpected";
    return {
      success: false,
      steps,
      failure: { step, message: describeError(error) },
      cleanup,
    };
  }
}

/** Runs one async step, rethrowing any failure as an `OrchestrationFailure` tagged with the
 * step it happened in — keeps the main flow above free of repetitive try/catch blocks while
 * still giving the final report accurate step attribution. */
async function catchStep<T>(step: string, action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof OrchestrationFailure) throw error;
    throw new OrchestrationFailure(step, describeError(error));
  }
}
