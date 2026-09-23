import { DrizzleLocationRepository } from "../../src/db/repositories/locationRepository";
import { createBulkImportJob } from "../../src/lib/bulkImport/jobs";
import { buildBulkImportDriveProvider, connectDb, parseFlagInt, parseFlagList, parseFlagValue } from "./shared";

/**
 * `npm run import:create-job` — the ONLY way a bulk-import job comes into
 * existence (§45 of the phase brief: a plain `import:run` must never
 * accidentally start all ~1,500 files). Requires an explicit, bounded
 * `--limit=N` or `--file-id=id1,id2,...` — refuses to run with neither,
 * rather than silently defaulting to "the whole collection."
 *
 * `--location=<slug>` (Phase 9 addendum §10) is optional — every physical
 * copy this job creates starts at that location; omitted, copies start with
 * no location recorded, exactly like any manually-added copy. Never defaults
 * to Corridor 218 or any other real location just because this is bulk
 * import — validated server-side against the real, currently-ACTIVE location
 * list, the same list the Move/Return workflow's destination picker uses.
 */
async function main() {
  const limit = parseFlagInt("limit");
  const fileIds = parseFlagList("file-id");
  const locationSlug = parseFlagValue("location");

  if (limit == null && !fileIds) {
    throw new Error('Refusing to create an unbounded job. Pass --limit=N (a bounded count of newly-discovered files) or --file-id=id1,id2,... (an explicit, deterministic list). Run "npm run import:list" first to see what exists.');
  }

  const { db, client } = connectDb();
  try {
    let initialLocationId: string | undefined;
    if (locationSlug) {
      const activeLocations = await new DrizzleLocationRepository(db).listActiveLocations();
      const match = activeLocations.find((location) => location.slug === locationSlug);
      if (!match) {
        throw new Error(`--location="${locationSlug}" isn't a currently-active location slug. Active locations: ${activeLocations.map((l) => l.slug).join(", ") || "(none configured yet)"}.`);
      }
      initialLocationId = match.id;
    }

    const { provider, rootFolderId } = buildBulkImportDriveProvider();
    const result = await createBulkImportJob(db, {
      sourceFolderId: rootFolderId,
      listChildren: (folderId, options) => provider.listChildren(folderId, options),
      limit,
      fileIds,
      initialLocationId,
    });

    console.log(`Total supported files discovered under the source root: ${result.totalDiscovered}`);
    console.log(`Job created: ${result.jobId}`);
    console.log(`Initial copy location: ${locationSlug ? `${locationSlug} (validated active)` : "(none — copies will start with no location recorded)"}`);
    console.log(`New items created: ${result.createdItems.length}`);
    for (const item of result.createdItems) console.log(`  ${item.name} (${item.fileId}) -> item ${item.itemId}`);
    if (result.alreadyTrackedFiles.length > 0) {
      console.log(`Already tracked (left untouched): ${result.alreadyTrackedFiles.length}`);
      for (const f of result.alreadyTrackedFiles) console.log(`  ${f.name} (${f.fileId}) — existing status: ${f.existingStatus}`);
    }
    console.log(`\nRun: npm run import:run -- --job-id=${result.jobId}`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
