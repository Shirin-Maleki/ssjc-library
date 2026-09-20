import "../../src/db/loadEnv";
import { GoogleDriveCoverStorageProvider } from "../../src/lib/googleDrive/googleDriveProvider";
import { isDriveConfigured } from "../../src/lib/googleDrive/config";
import { runSmokeTest, generateTinySyntheticPng } from "./smokeOrchestration";

/**
 * Real, opt-in Google Drive connectivity proof — `npm run google:smoke` (Phase 6, §32 of
 * the phase brief). Requires real OAuth configuration; never runs automatically in normal
 * unit/integration CI, and this file is not imported by any test.
 *
 * A thin CLI wrapper only: constructs the real provider and the real network-facing
 * dependencies (byte upload, current time), calls the pure, fully-tested orchestration in
 * `smokeOrchestration.ts`, then prints the result and sets the process exit code. All step
 * logic — including the cleanup guarantee that a disposable test file is trashed even when
 * a later step fails — lives in that module, where it's directly unit-testable against a
 * fake provider (`tests/unit/googleDrive/smokeOrchestration.test.ts`).
 *
 * Deliberately does NOT go through `src/lib/googleDrive/index.ts`'s
 * `getConfiguredCoverStorageProvider()` factory — that module is `import "server-only"`,
 * which throws unconditionally outside Next's own build pipeline (the exact same reason
 * `scripts/embeddings/generate.ts` constructs its provider directly rather than importing
 * the server-only-guarded factory).
 */

async function main() {
  if (!isDriveConfigured()) {
    console.error(
      "\n[config] FAILED: Google Drive is not configured (one or more of GOOGLE_OAUTH_CLIENT_ID, " +
        "GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REFRESH_TOKEN, GOOGLE_DRIVE_ROOT_FOLDER_ID " +
        "is missing from .env.local). Run `npm run google:authorize` first — see docs/GOOGLE_SETUP.md.\n"
    );
    process.exit(1);
  }

  const provider = new GoogleDriveCoverStorageProvider();

  const report = await runSmokeTest({
    provider,
    generatePng: generateTinySyntheticPng,
    now: () => Date.now(),
    uploadBytes: async (sessionUri, bytes, mimeType) => {
      const response = await fetch(sessionUri, {
        method: "PUT",
        headers: { "Content-Type": mimeType, "Content-Length": String(bytes.length) },
        body: new Uint8Array(bytes),
      });
      if (!response.ok) {
        throw new Error(`Uploading bytes to the resumable session failed with HTTP ${response.status}.`);
      }
      return (await response.json()) as { id?: string };
    },
  });

  let currentStep = "";
  for (const line of report.steps) {
    if (line.step !== currentStep) {
      currentStep = line.step;
      console.log(`\n=== Step ${currentStep} ===`);
    }
    console.log(`[${line.step}] ${line.message}`);
  }

  if (report.success) {
    console.log("\nexisting library assets modified: NO\n");
    console.log("Real Google Drive smoke test PASSED — see docs/GOOGLE_INTEGRATION.md for what each step proved.\n");
    process.exit(0);
  }

  console.error(`\n[${report.failure!.step}] FAILED: ${report.failure!.message}\n`);

  if (report.cleanup.attempted || report.cleanup.fileId) {
    if (report.cleanup.succeeded) {
      console.log(`[cleanup] The disposable test file (${report.cleanup.fileId}) was trashed despite the failure above.`);
    } else {
      console.error(
        `[cleanup] FAILED SEPARATELY: could not clean up the disposable test file ` +
          `(Drive file id ${report.cleanup.fileId}): ${report.cleanup.error}\n` +
          `[cleanup] Manual action may be needed: open that Drive file id directly ` +
          `(https://drive.google.com/open?id=${report.cleanup.fileId}) and trash it by hand if ` +
          `still present.`
      );
    }
  }

  process.exit(1);
}

main().catch((error) => {
  console.error("\nUnexpected failure:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
