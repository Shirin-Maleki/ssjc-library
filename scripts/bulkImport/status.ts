import { getJobStatus } from "../../src/lib/bulkImport/jobs";
import { connectDb, parseFlagValue } from "./shared";

/** `npm run import:status -- --job-id=<id>` — read-only, safe to run at any
 * time, including while another `import:run` is actively in progress. */
async function main() {
  const jobId = parseFlagValue("job-id");
  if (!jobId) throw new Error("Pass --job-id=<id>.");

  const { db, client } = connectDb();
  try {
    const status = await getJobStatus(db, jobId);
    if (!status) {
      console.log(`No job found with id ${jobId}.`);
      return;
    }
    console.log(`Job ${status.jobId} (${status.jobType}) — status: ${status.status}`);
    console.log(`Total items: ${status.totalItems}`);
    console.log(`  pending: ${status.pendingCount}`);
    console.log(`  processing: ${status.processingCount}`);
    console.log(`  needs_review: ${status.needsReviewCount}`);
    console.log(`  completed: ${status.completedCount}`);
    console.log(`  failed: ${status.failedCount}`);
    console.log(`  skipped_duplicate: ${status.skippedDuplicateCount}`);
    console.log(`Job counters — processed: ${status.processedItems}, failed: ${status.failedItems}, skipped: ${status.skippedItems}`);
    if (status.pendingCount > 0 || status.processingCount > 0) {
      console.log(`\nRun: npm run import:resume -- --job-id=${status.jobId}`);
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
