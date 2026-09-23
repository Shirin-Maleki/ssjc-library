import type { Database } from "@/db/client";
import type { CoverStorageProvider } from "@/lib/googleDrive/provider";
import { claimNextPendingItem, recoverStaleProcessingItems, type ClaimedItem } from "./claim";
import { processOneClaimedItem, type BulkPipelineDeps, type ItemOutcome } from "./pipeline";

/**
 * The bounded run loop `import:run`/`import:resume` share (§29/§31/§45 of the
 * phase brief) — claims one item at a time (never a bare unbounded `while`
 * over "all pending," always respecting an explicit `maxItems` this run may
 * touch), fetches that item's current Drive metadata fresh (never trusts
 * possibly-stale enumeration-time data), and delegates the real pipeline work
 * to `processOneClaimedItem`. Concurrency is a small, explicitly-capped worker
 * pool — never literal unbounded `Promise.all` over every pending item at
 * once.
 */

/** Hard ceiling on `--concurrency` — correctness and provider rate limits
 * matter far more than throughput for a small school library's one-time
 * import (§31). An operator cannot accidentally request more than this via
 * the CLI regardless of what they type. */
export const MAX_ALLOWED_CONCURRENCY = 4;

/** The CLI's own default when `--concurrency` is omitted — conservative per
 * §31's explicit guidance ("approximately 1-2 expensive intake pipelines
 * concurrently is reasonable"). */
export const DEFAULT_CONCURRENCY = 1;

export const DEFAULT_MAX_RETRIES = 3;

export interface RunBulkImportOptions {
  jobId: string;
  deps: BulkPipelineDeps;
  driveProvider: Pick<CoverStorageProvider, "getFileMetadata">;
  /** Maximum number of items THIS invocation will claim and process — never
   * unbounded; the CLI always supplies a real number (defaulting to the job's
   * own remaining pending count only when the operator explicitly asks to run
   * "the rest of this already-created, already-bounded job," never as a
   * silent default for a fresh job). */
  maxItems: number;
  concurrency?: number;
  maxRetries?: number;
  onItemResult?: (result: { driveFileId: string; outcome: ItemOutcome }) => void;
}

export interface RunBulkImportResult {
  attempted: number;
  completed: number;
  needsReview: number;
  retried: number;
  failed: number;
  recoveredStaleCount: number;
}

export async function runBulkImportJob(db: Database, options: RunBulkImportOptions): Promise<RunBulkImportResult> {
  const concurrency = Math.max(1, Math.min(options.concurrency ?? DEFAULT_CONCURRENCY, MAX_ALLOWED_CONCURRENCY));
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;

  const recovery = await recoverStaleProcessingItems(db, options.jobId);

  const result: RunBulkImportResult = { attempted: 0, completed: 0, needsReview: 0, retried: 0, failed: 0, recoveredStaleCount: recovery.recoveredCount };

  let remaining = options.maxItems;

  while (remaining > 0) {
    const batchSize = Math.min(concurrency, remaining);
    const claims: ClaimedItem[] = [];
    for (let i = 0; i < batchSize; i++) {
      const claimed = await claimNextPendingItem(db, options.jobId);
      if (!claimed) break;
      claims.push(claimed);
    }
    if (claims.length === 0) break; // no pending items remain

    const outcomes = await Promise.all(
      claims.map(async (claim): Promise<{ driveFileId: string; outcome: ItemOutcome }> => {
        const metadata = await options.driveProvider.getFileMetadata(claim.driveFileId);
        const outcome = await processOneClaimedItem(
          options.deps,
          { itemId: claim.id, driveFileId: claim.driveFileId, fileName: metadata.name, mimeType: metadata.mimeType, sizeBytes: metadata.size ?? 1 },
          maxRetries
        );
        return { driveFileId: claim.driveFileId, outcome };
      })
    );

    for (const entry of outcomes) {
      result.attempted += 1;
      if (entry.outcome.kind === "completed") result.completed += 1;
      else if (entry.outcome.kind === "needs_review") result.needsReview += 1;
      else if (entry.outcome.kind === "retry_scheduled") result.retried += 1;
      else result.failed += 1;
      options.onItemResult?.(entry);
    }

    remaining -= claims.length;
  }

  return result;
}
