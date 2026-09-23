/**
 * §35/§39 of the phase brief — bulk import must make full-import cost
 * measurable BEFORE Phase 10 runs it for real, without processing the full
 * collection just to find out. Pure counters, no DB, no network — a plain
 * mutable object the pipeline increments as it goes, read back by the CLI at
 * the end of a run for reporting. Deliberately not a database table: this is
 * per-run observability, not durable state anything else depends on.
 */

export type ProviderCallKind = "drive_download" | "gemini_vision" | "metadata_lookup" | "duplicate_check" | "embedding";

export interface BulkImportCallCounters {
  drive_download: number;
  gemini_vision: number;
  metadata_lookup: number;
  duplicate_check: number;
  embedding: number;
  /** Real token/usage metadata Gemini returned, when available — never
   * fabricated when the provider doesn't supply it. */
  geminiUsage: { promptTokens: number; candidateTokens: number; totalTokens: number }[];
}

export function createCallCounters(): BulkImportCallCounters {
  return { drive_download: 0, gemini_vision: 0, metadata_lookup: 0, duplicate_check: 0, embedding: 0, geminiUsage: [] };
}

export function recordProviderCall(counters: BulkImportCallCounters, kind: ProviderCallKind): void {
  counters[kind] += 1;
}

export function recordGeminiUsage(counters: BulkImportCallCounters, usage: { promptTokens: number; candidateTokens: number; totalTokens: number }): void {
  counters.geminiUsage.push(usage);
}
