import "../../src/db/loadEnv";
import zlib from "node:zlib";
import { GoogleDriveCoverStorageProvider } from "../../src/lib/googleDrive/googleDriveProvider";
import { isDriveConfigured } from "../../src/lib/googleDrive/config";
import { DriveProviderError, type DriveFileMetadata } from "../../src/lib/googleDrive/provider";

/**
 * Real, opt-in Google Drive connectivity proof — `npm run google:smoke` (Phase 6, §32 of
 * the phase brief). Requires real OAuth configuration; never runs automatically in normal
 * unit/integration CI, and this file is not imported by any test.
 *
 * Deliberately does NOT go through `src/lib/googleDrive/index.ts`'s
 * `getConfiguredCoverStorageProvider()` factory — that module is `import "server-only"`,
 * which throws unconditionally outside Next's own build pipeline (the exact same reason
 * `scripts/embeddings/generate.ts` constructs its provider directly rather than importing
 * the server-only-guarded factory). Constructs `GoogleDriveCoverStorageProvider` here
 * instead, the one place a plain Node script is allowed to.
 *
 * Steps A–G below match the phase brief exactly. Every step that could touch the real,
 * pre-existing photo collection is read-only and bounded; the only mutation this script
 * ever performs is creating and then trashing its own disposable, unmistakably-named test
 * file — never anything already in the folder.
 */

const DISPOSABLE_FILE_PREFIX = "__ssjc_phase6_smoke_";
const SAMPLE_CHILD_FOLDERS_TO_INSPECT = 3;
const SAMPLE_METADATA_PAGE_SIZE = 3;

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
function generateTinySyntheticPng(): Buffer {
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

function logStep(step: string, message: string): void {
  console.log(`[${step}] ${message}`);
}

function fail(step: string, message: string): never {
  console.error(`\n[${step}] FAILED: ${message}\n`);
  process.exit(1);
}

async function main() {
  if (!isDriveConfigured()) {
    fail(
      "config",
      "Google Drive is not configured (one or more of GOOGLE_OAUTH_CLIENT_ID, " +
        "GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REFRESH_TOKEN, GOOGLE_DRIVE_ROOT_FOLDER_ID " +
        "is missing from .env.local). Run `npm run google:authorize` first — see docs/GOOGLE_SETUP.md."
    );
  }

  const provider = new GoogleDriveCoverStorageProvider();
  const rootFolderId = requireRootFolderId();

  // --- Step A: connection ---------------------------------------------------------
  console.log("\n=== Step A: connection ===");
  let status;
  try {
    status = await provider.verifyConnection();
  } catch (error) {
    fail("A", describeError(error));
  }
  logStep("A", `Connected. Root folder: "${status.rootFolderName}" (${status.rootFolderId})`);
  logStep("A", `Shared Drive: ${status.rootIsSharedDrive ? `yes (${status.sharedDriveId})` : "no (My Drive)"}`);
  logStep("A", `Can create children under root: ${status.canCreateChildren}`);

  // --- Step B: bounded metadata access ----------------------------------------------
  console.log("\n=== Step B: bounded metadata access ===");
  let rootListing;
  try {
    rootListing = await provider.listChildren(rootFolderId, { pageSize: 50 });
  } catch (error) {
    fail("B", describeError(error));
  }
  const preExistingChildIds = rootListing.files.map((f) => f.id).sort();
  logStep("B", `Root has ${rootListing.files.length} immediate non-trashed child item(s) (this page).`);
  for (const child of rootListing.files) {
    logStep("B", `  - ${child.isFolder ? "[folder]" : "[file]  "} "${child.name}" (${child.id})`);
  }

  const childFolders = rootListing.files.filter((f) => f.isFolder).slice(0, SAMPLE_CHILD_FOLDERS_TO_INSPECT);
  for (const folder of childFolders) {
    try {
      const sample = await provider.listChildren(folder.id, { pageSize: SAMPLE_METADATA_PAGE_SIZE });
      logStep(
        "B",
        `  Sampled "${folder.name}": ${sample.files.length} item(s) in a bounded ${SAMPLE_METADATA_PAGE_SIZE}-item page (not processed).`
      );
    } catch (error) {
      logStep("B", `  Could not sample "${folder.name}": ${describeError(error)} (non-fatal — continuing).`);
    }
  }

  // --- Step C: disposable upload -----------------------------------------------------
  console.log("\n=== Step C: disposable upload ===");
  const pngBytes = generateTinySyntheticPng();
  const disposableFilename = `${DISPOSABLE_FILE_PREFIX}${Date.now()}.png`;
  logStep("C", `Generated a ${pngBytes.length}-byte synthetic PNG named "${disposableFilename}".`);

  let session;
  try {
    session = await provider.initiateResumableUpload({
      parentFolderId: rootFolderId,
      filename: disposableFilename,
      mimeType: "image/png",
      sizeBytes: pngBytes.length,
    });
  } catch (error) {
    fail("C", describeError(error));
  }
  logStep("C", "Resumable upload session initiated (session URI withheld from all output, as designed).");

  let uploadedFileId: string;
  try {
    const uploadResponse = await fetch(session.sessionUri, {
      method: "PUT",
      headers: { "Content-Type": "image/png", "Content-Length": String(pngBytes.length) },
      body: new Uint8Array(pngBytes),
    });
    if (!uploadResponse.ok) {
      fail("C", `Uploading bytes to the resumable session failed with HTTP ${uploadResponse.status}.`);
    }
    const uploaded = (await uploadResponse.json()) as { id?: string };
    if (!uploaded.id) fail("C", "Google's upload response did not include a file id.");
    uploadedFileId = uploaded.id;
  } catch (error) {
    fail("C", describeError(error));
  }
  logStep("C", `Upload complete. Real Drive file ID: ${uploadedFileId}`);

  // --- Step D: confirmation -----------------------------------------------------------
  console.log("\n=== Step D: confirmation ===");
  let confirmed: DriveFileMetadata;
  try {
    confirmed = await provider.confirmUploadedFile({
      fileId: uploadedFileId,
      expectedParentFolderId: rootFolderId,
      expectedFilename: disposableFilename,
      expectedMimeType: "image/png",
      expectedSizeBytes: pngBytes.length,
    });
  } catch (error) {
    fail("D", describeError(error));
  }
  logStep("D", `Confirmed: parent, MIME type, size, and filename all match. Checksum: ${confirmed.md5Checksum ?? "(not supplied)"}`);

  // --- Step E: download -----------------------------------------------------------------
  console.log("\n=== Step E: download ===");
  let downloaded: { bytes: Buffer; metadata: DriveFileMetadata };
  try {
    downloaded = await provider.downloadSource(uploadedFileId);
  } catch (error) {
    fail("E", describeError(error));
  }
  const bytesMatch = Buffer.compare(downloaded.bytes, pngBytes) === 0;
  logStep("E", `Downloaded ${downloaded.bytes.length} bytes. Byte-for-byte match with the original synthetic PNG: ${bytesMatch}.`);
  if (!bytesMatch) fail("E", "Downloaded bytes did not match the originally uploaded synthetic PNG.");

  // --- Step F: cleanup ------------------------------------------------------------------
  console.log("\n=== Step F: cleanup ===");
  if (uploadedFileId !== confirmed.id) fail("F", "Safety check failed: the file id to clean up does not match the confirmed upload's id.");
  if (!confirmed.name.startsWith(DISPOSABLE_FILE_PREFIX)) {
    fail("F", "Safety check failed: the file to clean up does not have the expected disposable-test filename prefix.");
  }
  try {
    await provider.trashFile(uploadedFileId);
  } catch (error) {
    fail("F", describeError(error));
  }
  logStep("F", `Trashed the disposable test file (${uploadedFileId}). Nothing else was touched.`);

  // --- Step G: mutation safety ------------------------------------------------------------
  console.log("\n=== Step G: mutation safety ===");
  let finalListing;
  try {
    finalListing = await provider.listChildren(rootFolderId, { pageSize: 50 });
  } catch (error) {
    fail("G", describeError(error));
  }
  const finalChildIds = finalListing.files.map((f) => f.id).sort();
  const allPreExistingStillPresent = preExistingChildIds.every((id) => finalChildIds.includes(id));
  const testFileGone = !finalChildIds.includes(uploadedFileId);

  logStep("G", `Pre-existing child count: ${preExistingChildIds.length}. Post-cleanup child count: ${finalChildIds.length}.`);
  logStep("G", `Every pre-existing child id still present: ${allPreExistingStillPresent}.`);
  logStep("G", `Disposable test file no longer listed (trashed): ${testFileGone}.`);

  if (!allPreExistingStillPresent || !testFileGone) {
    fail("G", "Mutation-safety check failed — see the lines above.");
  }

  console.log("\nexisting library assets modified: NO\n");
  console.log("Real Google Drive smoke test PASSED — see docs/GOOGLE_INTEGRATION.md for what each step proved.\n");
}

function requireRootFolderId(): string {
  const value = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
  if (!value) fail("config", "GOOGLE_DRIVE_ROOT_FOLDER_ID is not set.");
  return value;
}

/** Formats an error for terminal output without ever including a secret or a raw Google
 * response body — `DriveProviderError.message` is already safe by construction
 * (`docs/GOOGLE_INTEGRATION.md`); any other error type falls back to its own `.message`. */
function describeError(error: unknown): string {
  if (error instanceof DriveProviderError) return `[${error.category}] ${error.message}`;
  if (error instanceof Error) return error.message;
  return String(error);
}

main().catch((error) => {
  console.error("\nUnexpected failure:", describeError(error));
  process.exit(1);
});
