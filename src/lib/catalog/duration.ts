import type { DurationBand } from "./types";

export const DURATION_BAND_LABELS: Record<DurationBand, string> = {
  under_5: "Under 5 minutes",
  five_to_ten: "5–10 minutes",
  ten_plus: "10+ minutes",
};

export function getReadDurationBand(minutes: number): DurationBand {
  if (minutes < 5) return "under_5";
  if (minutes <= 10) return "five_to_ten";
  return "ten_plus";
}

/** Ranking-signal-only intent extraction (never a hard filter) — see docs/SEARCH.md. */
export function parseDurationBandFromText(text: string): DurationBand | undefined {
  const normalized = text.toLowerCase();

  // An explicit minute count is resolved through the same banding function used for
  // real durations, so "5 minute" and a book whose readAloudMinutes is 5 always agree
  // on which band they're in — deliberately not a separate, potentially-inconsistent
  // set of keyword thresholds.
  const explicitMinutes = normalized.match(/\b(\d{1,2})[\s-]*minutes?\b/);
  if (explicitMinutes) {
    return getReadDurationBand(Number(explicitMinutes[1]));
  }

  if (/\b(short|quick|under\s*5|less than 5)\b/.test(normalized)) return "under_5";
  if (/\b(10\+|ten\s*plus|longer|long read)\b/.test(normalized)) return "ten_plus";
  if (/\b5[\s-]*(to|-)[\s-]*10\b/.test(normalized)) return "five_to_ten";

  return undefined;
}
