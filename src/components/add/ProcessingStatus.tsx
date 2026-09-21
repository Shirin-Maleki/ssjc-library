/**
 * Real, staged processing text (§12 of the phase brief) — every label here
 * corresponds to an actual server operation genuinely in flight when it's shown,
 * never a decorative fake stepper or an indefinite generic spinner. `AddBookFlow`
 * only ever renders one of these at a time, matching its own current real state.
 */
export type ProcessingStage = "uploading" | "identifying" | "looking_up" | "checking_duplicates" | "enriching" | "saving";

const STAGE_LABELS: Record<ProcessingStage, string> = {
  uploading: "Uploading cover…",
  identifying: "Identifying book…",
  looking_up: "Finding book details…",
  checking_duplicates: "Checking the library…",
  enriching: "Preparing details…",
  saving: "Saving…",
};

interface ProcessingStatusProps {
  stage: ProcessingStage;
  /** Only present while `stage === "uploading"` and the browser's own XHR upload
   * progress is real/computable — never a fabricated percentage (§11). */
  uploadProgressPercent?: number;
}

export function ProcessingStatus({ stage, uploadProgressPercent }: ProcessingStatusProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-20 text-center" role="status" aria-live="polite">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-border-strong border-t-brand-primary" aria-hidden="true" />
      <p className="text-base font-medium text-text-primary">{STAGE_LABELS[stage]}</p>
      {stage === "uploading" && uploadProgressPercent != null && (
        <p className="text-sm text-text-muted">{uploadProgressPercent}%</p>
      )}
    </div>
  );
}
