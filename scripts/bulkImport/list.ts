import { enumerateSourceImages } from "../../src/lib/bulkImport/enumerate";
import { buildBulkImportDriveProvider } from "./shared";

/**
 * `npm run import:list` — safe, read-only enumeration of the configured bulk
 * import source folder. Never touches the database, never claims anything,
 * never downloads an image. The one command an operator should run FIRST,
 * before ever creating a job, to see exactly how many supported files exist
 * and confirm the configured root is what they expect (§30/§45 of the phase
 * brief).
 */
async function main() {
  const { provider, rootFolderId } = buildBulkImportDriveProvider();

  console.log(`Enumerating supported image files under the configured bulk-import root...`);
  const rootMeta = await provider.getFileMetadata(rootFolderId);
  console.log(`Root: "${rootMeta.name}" (folder)`);

  const files = await enumerateSourceImages((folderId, options) => provider.listChildren(folderId, options), rootFolderId);

  console.log(`\nFound ${files.length} supported image file(s).`);
  const byFolder = new Map<string, number>();
  for (const file of files) {
    const key = file.folderPath.join(" / ") || "(root)";
    byFolder.set(key, (byFolder.get(key) ?? 0) + 1);
  }
  console.log("\nBy folder:");
  for (const [folder, count] of [...byFolder.entries()].sort()) {
    console.log(`  ${folder}: ${count}`);
  }

  const sampleCount = Math.min(5, files.length);
  if (sampleCount > 0) {
    console.log(`\nFirst ${sampleCount} file(s) in deterministic order:`);
    for (const file of files.slice(0, sampleCount)) {
      console.log(`  ${file.folderPath.join("/")}/${file.name} (${file.mimeType}, ${file.size ?? "unknown"} bytes)`);
    }
  }

  console.log(`\nNothing was downloaded or written. Run "npm run import:create-job -- --limit=N" (or --file-id=...) to create a bounded job.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
