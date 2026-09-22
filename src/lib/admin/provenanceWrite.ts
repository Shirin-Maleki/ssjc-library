import { and, eq } from "drizzle-orm";
import { bookFieldProvenance } from "@/db/schema";
import type { MetadataFieldKey } from "@/lib/metadata/fieldRegistry";
import type { Transaction } from "@/lib/intake/persistence";

export interface ProvenanceWrite {
  fieldKey: MetadataFieldKey;
  sourceType: "external_provider" | "ai_inferred" | "cover_visible" | "human_corrected" | "human_verified";
  sourceLabel?: string;
  confidenceLevel?: "high" | "medium" | "low";
  notes?: string;
}

/**
 * The single reusable transactional provenance-history helper (Phase 8, §17) — do
 * not duplicate this "find current row, retire it, insert the new current row"
 * sequence across multiple admin actions. For each write: finds the current
 * `(book_id, field_key)` row (if any), sets it `is_current = false`, then inserts
 * exactly one new current row. Respects the real partial unique index
 * (`book_field_provenance_current_unique`, enforced on `is_current = true`) by
 * construction — the old row is retired in the SAME transaction before the new one
 * is inserted, so at no point do two current rows for the same field coexist.
 * Previous evidence is never deleted — provenance history is append-only by design
 * (`docs/DATA_MODEL.md` §6).
 */
export async function writeCurrentProvenance(tx: Transaction, bookId: string, writes: ProvenanceWrite[]): Promise<void> {
  for (const write of writes) {
    await tx
      .update(bookFieldProvenance)
      .set({ isCurrent: false })
      .where(and(eq(bookFieldProvenance.bookId, bookId), eq(bookFieldProvenance.fieldKey, write.fieldKey), eq(bookFieldProvenance.isCurrent, true)));

    await tx.insert(bookFieldProvenance).values({
      bookId,
      fieldKey: write.fieldKey,
      sourceType: write.sourceType,
      sourceLabel: write.sourceLabel,
      confidenceLevel: write.confidenceLevel,
      notes: write.notes,
      isCurrent: true,
    });
  }
}
