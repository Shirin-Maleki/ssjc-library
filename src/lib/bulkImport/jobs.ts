import { eq, inArray } from "drizzle-orm";
import type { Database } from "@/db/client";
import { ingestionItems, ingestionJobs } from "@/db/schema";
import { enumerateSourceImages, type EnumeratedSourceFile, type ListChildrenFn } from "./enumerate";

/**
 * Bulk-import job creation (§25/§28/§45 of the phase brief) — the ONE place a
 * new `ingestion_jobs`(`job_type: "bulk_import"`, `source: "admin_bulk_drive"`)
 * row and its `ingestion_items` rows get created. Deliberately idempotent by
 * construction: re-running this against the same source folder never creates a
 * second `ingestion_items` row for a Drive file that already has one (in ANY
 * status) — the safe default is "already tracked, leave it alone," never
 * "create a duplicate and let the database's own partial unique index reject
 * it," which would make a routine re-run noisy for no benefit. Retrying a
 * genuinely `"failed"` item is a deliberate, explicit, separate operator
 * action (resetting that same row, never creating a second one) — out of this
 * function's scope.
 *
 * A plain, no-argument run of this function is never possible — the safety
 * rail against "accidentally start all ~1,500 files" (§45) is enforced by the
 * CLI layer requiring an explicit, bounded `limit` or `fileIds` before this is
 * ever called for real (see `scripts/bulkImport/createJob.ts`), not by this
 * function silently capping itself.
 */

export interface CreateBulkImportJobInput {
  sourceFolderId: string;
  listChildren: ListChildrenFn;
  /** Caps how many NEWLY-DISCOVERED files (never already-tracked ones) this
   * job will include — the operator-facing bound `--limit` maps to. */
  limit?: number;
  /** Restricts enumeration to exactly these Drive file ids, for a fully
   * deterministic, minimal real-validation run (§42's `--file-id` support) —
   * when present, `limit` is ignored (the explicit list IS the bound). */
  fileIds?: string[];
  createdBy?: string;
}

export interface CreateBulkImportJobResult {
  jobId: string;
  /** Files that got a brand-new `ingestion_items` row under this job, in
   * deterministic enumeration order. */
  createdItems: { itemId: string; fileId: string; name: string }[];
  /** Files enumeration found that already had an existing `ingestion_items`
   * row (any status, any job) — intentionally left untouched. */
  alreadyTrackedFiles: { fileId: string; name: string; existingStatus: string }[];
  /** Total supported image files enumeration discovered under the source root
   * (before applying `limit`/`fileIds`) — for honest "here is the real size of
   * what you're bounding yourself away from" CLI reporting. */
  totalDiscovered: number;
}

export async function createBulkImportJob(db: Database, input: CreateBulkImportJobInput): Promise<CreateBulkImportJobResult> {
  const allFiles = await enumerateSourceImages(input.listChildren, input.sourceFolderId);
  const totalDiscovered = allFiles.length;

  const candidateFiles: EnumeratedSourceFile[] = input.fileIds?.length
    ? allFiles.filter((f) => input.fileIds!.includes(f.fileId))
    : typeof input.limit === "number"
      ? allFiles.slice(0, input.limit)
      : allFiles;

  const existingRows =
    candidateFiles.length > 0
      ? await db
          .select({ driveFileId: ingestionItems.driveFileId, status: ingestionItems.status })
          .from(ingestionItems)
          .where(inArray(ingestionItems.driveFileId, candidateFiles.map((f) => f.fileId)))
      : [];
  const existingByFileId = new Map(existingRows.map((r) => [r.driveFileId, r.status]));

  const toCreate = candidateFiles.filter((f) => !existingByFileId.has(f.fileId));
  const alreadyTrackedFiles = candidateFiles
    .filter((f) => existingByFileId.has(f.fileId))
    .map((f) => ({ fileId: f.fileId, name: f.name, existingStatus: existingByFileId.get(f.fileId)! }));

  const [job] = await db
    .insert(ingestionJobs)
    .values({
      jobType: "bulk_import",
      source: "admin_bulk_drive",
      status: "pending",
      totalItems: toCreate.length,
      config: { sourceFolderId: input.sourceFolderId, requestedLimit: input.limit ?? null, requestedFileIds: input.fileIds ?? null, totalDiscovered },
      createdBy: input.createdBy ?? "bulk-import-cli",
    })
    .returning({ id: ingestionJobs.id });

  const createdItems: CreateBulkImportJobResult["createdItems"] = [];
  for (const file of toCreate) {
    const [item] = await db
      .insert(ingestionItems)
      .values({ jobId: job.id, driveFileId: file.fileId, status: "pending" })
      .returning({ id: ingestionItems.id });
    createdItems.push({ itemId: item.id, fileId: file.fileId, name: file.name });
  }

  return { jobId: job.id, createdItems, alreadyTrackedFiles, totalDiscovered };
}

export interface JobStatusCounts {
  jobId: string;
  jobType: string;
  status: string;
  totalItems: number;
  processedItems: number;
  failedItems: number;
  skippedItems: number;
  pendingCount: number;
  processingCount: number;
  needsReviewCount: number;
  completedCount: number;
  failedCount: number;
  skippedDuplicateCount: number;
}

/** Real, live counts by status — never trusts `ingestion_jobs`' own summary
 * columns alone for the per-status breakdown (those track processed/failed/
 * skipped totals, not the current live distribution across `pending`/
 * `processing`/`needs_review`, which is what an operator checking on a
 * possibly-interrupted run actually needs to see). */
export async function getJobStatus(db: Database, jobId: string): Promise<JobStatusCounts | undefined> {
  const [job] = await db.select().from(ingestionJobs).where(eq(ingestionJobs.id, jobId)).limit(1);
  if (!job) return undefined;

  const items = await db.select({ status: ingestionItems.status }).from(ingestionItems).where(eq(ingestionItems.jobId, jobId));
  const count = (s: string) => items.filter((i) => i.status === s).length;

  return {
    jobId: job.id,
    jobType: job.jobType,
    status: job.status,
    totalItems: job.totalItems,
    processedItems: job.processedItems,
    failedItems: job.failedItems,
    skippedItems: job.skippedItems,
    pendingCount: count("pending"),
    processingCount: count("processing"),
    needsReviewCount: count("needs_review"),
    completedCount: count("completed"),
    failedCount: count("failed"),
    skippedDuplicateCount: count("skipped_duplicate"),
  };
}
