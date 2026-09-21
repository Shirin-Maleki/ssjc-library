import { eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import { bookIdentityCandidates } from "@/db/schema";
import type { NormalizedMetadataCandidate } from "@/lib/metadataProviders/provider";

/**
 * Operationalizes the existing (previously-unused-by-Phase-7) `book_identity_
 * candidates` table (Phase 7 correction pass §7) — every normalized metadata
 * candidate a lookup considered, for audit/review, not just the one silently
 * chosen. Distinct from `ingestion_items.intake_draft` (`draft.ts`): the draft
 * is the resumable UI/domain state one intake actively uses; this table is the
 * durable audit trail of what was considered and why, independent of whatever
 * the draft's shape evolves to later.
 *
 * Never stores a secret or raw AI chain-of-thought — `candidatePayload` is the
 * already-normalized `NormalizedMetadataCandidate` shape (bibliographic fields
 * only), the same one `metadata_provider_cache` already stores.
 */
export interface IdentityCandidateToPersist {
  candidate: NormalizedMetadataCandidate;
  /** 0-1, clamped — `reconciliation.ts`'s raw weighted score (which can exceed
   * 100 with several stacked signals) divided by 100 and capped at 1, since the
   * `match_confidence numeric(3,2)` column can hold at most 9.99. */
  matchScore: number;
  wasSelected: boolean;
}

/**
 * Replaces (never appends to) the candidate set for one ingestion item — a
 * retry of metadata lookup re-searches and its result is authoritative for
 * that attempt; blindly appending would leave stale/duplicate rows from an
 * earlier attempt sitting alongside the current ones.
 */
export async function persistIdentityCandidates(
  db: Database,
  ingestionItemId: string,
  candidates: IdentityCandidateToPersist[]
): Promise<void> {
  await db.delete(bookIdentityCandidates).where(eq(bookIdentityCandidates.ingestionItemId, ingestionItemId));
  if (candidates.length === 0) return;

  await db.insert(bookIdentityCandidates).values(
    candidates.map(({ candidate, matchScore, wasSelected }) => ({
      ingestionItemId,
      provider: candidate.provider,
      providerIdentifier: candidate.providerIdentifier,
      rawResponse: candidate,
      matchConfidence: Math.min(1, Math.max(0, matchScore / 100)).toFixed(2),
      wasSelected,
    }))
  );
}
