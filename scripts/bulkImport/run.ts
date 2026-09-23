import { getJobInitialLocationId } from "../../src/lib/intake/persistence";
import { getJobStatus } from "../../src/lib/bulkImport/jobs";
import { runBulkImportJob, DEFAULT_CONCURRENCY, MAX_ALLOWED_CONCURRENCY, DEFAULT_MAX_RETRIES } from "../../src/lib/bulkImport/runner";
import { createCallCounters } from "../../src/lib/bulkImport/costTracking";
import { projectCostFromObservedUsage } from "../../src/lib/bulkImport/pricing";
import { buildAiProvider, buildBulkImportDriveProvider, buildMetadataProviders, connectDb, parseFlagInt, parseFlagValue } from "./shared";

/**
 * `npm run import:run` / `npm run import:resume` — the ONE worker loop
 * (§29/§31/§45 of the phase brief). Both commands run this exact same script;
 * "resume" is not a different code path — `recoverStaleProcessingItems` (run
 * automatically at the start of every invocation, inside
 * `runBulkImportJob`) plus claiming only ever-`"pending"` items already makes
 * every run of this script a safe resume of whatever that job's own state
 * says is left to do. Requires an explicit `--job-id` — never operates on
 * "whichever job is most recent" implicitly.
 */
async function main() {
  const jobId = parseFlagValue("job-id");
  if (!jobId) throw new Error('Pass --job-id=<id> (from "npm run import:create-job").');

  const concurrency = parseFlagInt("concurrency") ?? DEFAULT_CONCURRENCY;
  if (concurrency > MAX_ALLOWED_CONCURRENCY) {
    throw new Error(`--concurrency=${concurrency} exceeds the maximum allowed (${MAX_ALLOWED_CONCURRENCY}) — correctness and provider rate limits matter more than throughput for this project (docs/BULK_IMPORT.md).`);
  }
  const maxRetries = parseFlagInt("max-retries") ?? DEFAULT_MAX_RETRIES;
  const limit = parseFlagInt("limit");

  const { db, client } = connectDb();
  try {
    const before = await getJobStatus(db, jobId);
    if (!before) throw new Error(`No job found with id ${jobId}.`);

    const maxItems = limit ?? before.pendingCount + before.processingCount;
    if (maxItems <= 0) {
      console.log("Nothing pending or processing for this job — nothing to do.");
      return;
    }

    const { provider: driveProvider, rootFolderId } = buildBulkImportDriveProvider();
    const aiProvider = buildAiProvider();
    const metadataProviders = buildMetadataProviders();
    const counters = createCallCounters();
    // Resolved once per run, not per item — this job's `--location` (if any)
    // was validated/fixed at `import:create-job` time and never changes for
    // the life of the job (Phase 9 addendum §10).
    const initialLocationId = (await getJobInitialLocationId(db, jobId)) ?? undefined;

    console.log(`Running job ${jobId}: up to ${maxItems} item(s), concurrency=${concurrency}, max retries per item=${maxRetries}.`);
    console.log(`Initial copy location for items this job completes: ${initialLocationId ?? "(none recorded)"}`);

    const result = await runBulkImportJob(db, {
      jobId,
      deps: { db, driveProvider, aiProvider, metadataProviders, bulkImportRootFolderId: rootFolderId, counters, initialLocationId },
      driveProvider,
      maxItems,
      concurrency,
      maxRetries,
      onItemResult: ({ driveFileId, outcome }) => {
        console.log(`  [${driveFileId}] ${outcome.kind}${"reason" in outcome ? ` — ${outcome.reason}` : ""}${"bookId" in outcome ? ` — book ${outcome.bookId}` : ""}`);
      },
    });

    console.log(`\nRun summary — attempted: ${result.attempted}, completed: ${result.completed}, needs_review: ${result.needsReview}, retried: ${result.retried}, failed: ${result.failed}`);
    if (result.recoveredStaleCount > 0) console.log(`Recovered ${result.recoveredStaleCount} item(s) stuck in "processing" from an earlier interrupted run.`);

    console.log(`\nProvider calls this run — Drive downloads: ${counters.drive_download}, Gemini vision: ${counters.gemini_vision}, metadata lookups: ${counters.metadata_lookup}, duplicate checks: ${counters.duplicate_check}`);
    const projection = projectCostFromObservedUsage(counters.geminiUsage);
    if (projection) {
      console.log(`\nObserved Gemini cost (from ${projection.sampleCount} real call(s), pricing checked ${projection.pricingCheckedDate}):`);
      console.log(`  avg prompt tokens/item: ${projection.averagePromptTokensPerItem}, avg output tokens/item: ${projection.averageCandidateTokensPerItem}`);
      console.log(`  avg cost/item: $${projection.averageCostPerItemUsd.toFixed(5)}`);
      console.log(`  projected 100 images: $${projection.projected100ImagesUsd.toFixed(2)}`);
      console.log(`  projected ~1,500 images: $${projection.projected1500ImagesUsd.toFixed(2)} (NOT run — this is a projection only)`);
    } else {
      console.log("\nNo Gemini usage metadata was returned this run — no cost projection available.");
    }

    const after = await getJobStatus(db, jobId);
    if (after) console.log(`\nJob ${jobId} now: pending=${after.pendingCount}, processing=${after.processingCount}, needs_review=${after.needsReviewCount}, completed=${after.completedCount}, failed=${after.failedCount}`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
