import { DriveProviderError } from "@/lib/googleDrive/provider";
import { AIProviderError } from "@/lib/ai/provider";

/**
 * §32 of the phase brief: failures are never treated identically. Pure and
 * dependency-free (no DB, no network) so this mapping is directly unit-testable —
 * mirrors `visionFailureClassification.ts`'s exact reasoning, generalized across
 * every provider boundary the bulk pipeline touches, not just vision.
 *
 * - `"transient"` — worth a bounded retry with backoff (rate limits, timeouts,
 *   momentary provider/network failures).
 * - `"permanent"` — never worth retrying at the item level; either the source is
 *   genuinely unusable (corrupt/unsupported image) or the whole RUN is
 *   misconfigured (missing credentials, revoked authorization, wrong root) — the
 *   caller distinguishes these two by category name when deciding whether to
 *   abort the entire run rather than just this one item.
 * - `"reviewable"` — the call completed and returned a real answer, but that
 *   answer itself is the kind of ambiguity a human, not a retry, resolves
 *   (handled by `completionGate.ts` for reconciliation/duplicate/category
 *   uncertainty; this class exists here for the smaller set of hard provider
 *   errors that are best read as "needs a look," e.g. an image the vision
 *   provider could parse the response for but genuinely couldn't read).
 */
export type BulkImportFailureClass = "transient" | "permanent" | "reviewable";

/** Run-level configuration/authorization categories — worth aborting the WHOLE
 * run immediately rather than marking every remaining item failed one at a time
 * (the exact same misconfiguration would fail identically for every other item
 * too). Exported so the CLI run loop can check membership directly. */
export const RUN_FATAL_DRIVE_CATEGORIES: ReadonlySet<string> = new Set([
  "configuration_missing",
  "authorization_required",
  "authorization_revoked_or_invalid",
  "root_folder_missing",
]);

export interface ClassifiedBulkImportFailure {
  failureClass: BulkImportFailureClass;
  message: string;
  /** `true` when this specific error indicates the entire run (not just this
   * item) cannot proceed — the CLI should stop rather than continue burning
   * through the remaining queue. */
  runFatal: boolean;
}

export function classifyBulkImportError(error: unknown): ClassifiedBulkImportFailure {
  if (error instanceof DriveProviderError) {
    const runFatal = RUN_FATAL_DRIVE_CATEGORIES.has(error.category);
    switch (error.category) {
      case "rate_limited":
      case "transient_provider_failure":
        return { failureClass: "transient", message: error.message, runFatal };
      case "file_not_found":
      case "permission_denied":
      case "invalid_file":
      case "download_failed":
      case "outside_configured_root":
        return { failureClass: "permanent", message: error.message, runFatal };
      default:
        return { failureClass: runFatal ? "permanent" : "transient", message: error.message, runFatal };
    }
  }

  if (error instanceof AIProviderError) {
    switch (error.category) {
      case "rate_limited":
      case "transient_provider_failure":
      case "timeout":
        return { failureClass: "transient", message: error.message, runFatal: false };
      case "invalid_image":
      case "invalid_response":
        return { failureClass: "reviewable", message: error.message, runFatal: false };
      case "configuration_missing":
        return { failureClass: "permanent", message: error.message, runFatal: true };
      default:
        return { failureClass: "transient", message: error.message, runFatal: false };
    }
  }

  return { failureClass: "transient", message: error instanceof Error ? error.message : "An unknown error occurred.", runFatal: false };
}
