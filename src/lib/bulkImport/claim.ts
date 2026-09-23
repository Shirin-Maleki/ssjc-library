import { and, eq, isNull, lt, or } from "drizzle-orm";
import type { Database } from "@/db/client";
import { ingestionItems } from "@/db/schema";

/**
 * Claim-before-mutate for bulk-import items (§29/§41 of the phase brief) —
 * reuses the exact same atomic-conditional-UPDATE pattern already established
 * by Phase 8's `approveReviewLater`/`resolveDuplicate` (`src/lib/admin/
 * persistence.ts`: `UPDATE ... WHERE status = 'needs_review' RETURNING`), never
 * a new concurrency primitive. Postgres's own row-level locking on the `UPDATE`
 * is what makes this correct under real concurrent workers: two connections
 * racing the same conditional update on the same row serialize against each
 * other, and the loser's `RETURNING` set is empty.
 */

/** Default staleness threshold for recovering a `"processing"` item after a
 * crashed/killed worker — generous relative to a single item's real pipeline
 * latency (Drive download + one Gemini call + metadata lookup is normally under
 * 30 seconds per `docs/COSTS.md`'s observed Phase 7 latencies), while short
 * enough that an operator re-running the CLI after a real crash doesn't have to
 * wait an unreasonable time for recovery. This is a single-operator, bounded
 * CLI tool, not a distributed worker fleet — a time-based staleness check is a
 * deliberately simple, documented, "good enough" mechanism at this scale
 * (`docs/BULK_IMPORT.md`), not a lease/heartbeat protocol. */
export const DEFAULT_STALE_PROCESSING_MS = 30 * 60 * 1000;

export interface ClaimedItem {
  id: string;
  driveFileId: string;
  retryCount: number;
}

/**
 * Claims exactly one `"pending"` item under `jobId` for processing, or
 * `undefined` when none remain (or none could be claimed this attempt — see
 * below). Two steps: pick a real candidate row (oldest first, deterministic),
 * then a conditional `UPDATE ... WHERE id = $1 AND status = 'pending'
 * RETURNING`. The SELECT alone is never the safety boundary — two concurrent
 * workers can genuinely pick the SAME candidate row in that narrow window; the
 * UPDATE's own `WHERE status = 'pending'` is what actually decides the race
 * (Postgres serializes the two competing UPDATEs on that row, and the loser's
 * `RETURNING` set is empty). A caller that gets `undefined` back while pending
 * items still exist should simply call this again to pick a different
 * candidate — never assume `undefined` means "no work left" without checking.
 */
export async function claimNextPendingItem(db: Database, jobId: string): Promise<ClaimedItem | undefined> {
  const [candidate] = await db
    .select({ id: ingestionItems.id })
    .from(ingestionItems)
    .where(and(eq(ingestionItems.jobId, jobId), eq(ingestionItems.status, "pending")))
    .orderBy(ingestionItems.createdAt)
    .limit(1);
  if (!candidate) return undefined;

  const [claimed] = await db
    .update(ingestionItems)
    .set({ status: "processing", startedAt: new Date() })
    .where(and(eq(ingestionItems.id, candidate.id), eq(ingestionItems.status, "pending")))
    .returning({ id: ingestionItems.id, driveFileId: ingestionItems.driveFileId, retryCount: ingestionItems.retryCount });

  return claimed;
}

export interface RecoverStaleProcessingResult {
  recoveredCount: number;
  recoveredItemIds: string[];
}

/**
 * Resets any `"processing"` item under `jobId` whose `startedAt` is older than
 * `staleAfterMs` back to `"pending"` — the crash-recovery half of
 * resumability (§29). Run once at the START of every `import:run`/
 * `import:resume` invocation, before claiming begins, so a worker that was
 * killed mid-item never leaves that item stuck in `"processing"` forever.
 *
 * Correctness note (documented, not silently glossed over): this is a
 * time-based heuristic, not a true lease/fencing protocol — if a worker is
 * merely slow (not crashed) and still genuinely holds an item past the
 * threshold, this could theoretically let a second run reclaim it. At this
 * project's real scale (one operator, bounded concurrency of 1-2, a CLI tool
 * run interactively) that risk is accepted and documented rather than solved
 * with heavier machinery a school library import doesn't need.
 */
export async function recoverStaleProcessingItems(db: Database, jobId: string, staleAfterMs: number = DEFAULT_STALE_PROCESSING_MS): Promise<RecoverStaleProcessingResult> {
  const staleBefore = new Date(Date.now() - staleAfterMs);
  const recovered = await db
    .update(ingestionItems)
    .set({ status: "pending", startedAt: null })
    .where(
      and(
        eq(ingestionItems.jobId, jobId),
        eq(ingestionItems.status, "processing"),
        or(isNull(ingestionItems.startedAt), lt(ingestionItems.startedAt, staleBefore))
      )
    )
    .returning({ id: ingestionItems.id });

  return { recoveredCount: recovered.length, recoveredItemIds: recovered.map((r) => r.id) };
}
