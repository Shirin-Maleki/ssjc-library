"use client";

import type { VoiceSearchStatus } from "@/lib/voice/useVoiceSearch";
import { getVoiceButtonLabel } from "@/lib/voice/messages";
import { cn } from "@/lib/utils/cn";

interface VoiceSearchButtonProps {
  status: VoiceSearchStatus;
  onStart: () => void;
  onStop: () => void;
  onCancel: () => void;
}

/**
 * Lives in the search input's right-hand icon slot, integrated with search rather than
 * a separate panel (product brief §4). Two controls show at most: the mic/stop toggle
 * (always present once voice is supported) and a small Cancel affordance that appears
 * only while listening — Stop completes the search with whatever was heard so far,
 * Cancel discards it and restores the query that existed before listening started
 * (docs/DECISIONS.md, "Voice search: Stop vs. Cancel are distinct outcomes"). Listening
 * is communicated by a shape change (mic → filled square) and the "Stop voice search"
 * label, not by color alone.
 */
export function VoiceSearchButton({ status, onStart, onStop, onCancel }: VoiceSearchButtonProps) {
  const listening = status === "listening";

  return (
    <div className="flex items-center gap-0.5">
      {listening && (
        <button
          type="button"
          onClick={onCancel}
          aria-label="Cancel voice search"
          className="flex h-11 w-11 items-center justify-center rounded-md text-text-secondary hover:bg-surface-subtle"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      )}
      <button
        type="button"
        onClick={listening ? onStop : onStart}
        aria-label={getVoiceButtonLabel(status)}
        aria-pressed={listening}
        className={cn(
          "flex h-11 w-11 items-center justify-center rounded-md text-text-primary transition-colors",
          listening ? "bg-accent-emphasis/20" : "text-text-secondary hover:bg-surface-subtle"
        )}
      >
        {listening ? (
          <svg
            width="18"
            height="18"
            viewBox="0 0 18 18"
            fill="none"
            aria-hidden="true"
            className="motion-safe:animate-pulse"
          >
            <rect x="5" y="5" width="8" height="8" rx="1.5" fill="currentColor" />
          </svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
            <rect x="6.5" y="2.5" width="5" height="8" rx="2.5" stroke="currentColor" strokeWidth="1.4" />
            <path d="M4 9.5a5 5 0 0 0 10 0M9 14.5v2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        )}
      </button>
    </div>
  );
}
