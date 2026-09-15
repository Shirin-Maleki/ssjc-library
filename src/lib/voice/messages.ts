import type { VoiceSearchStatus } from "./useVoiceSearch";

/**
 * Every teacher-facing voice-search string lives here, as pure functions of `status` —
 * kept out of the component so the exact wording is unit-testable without rendering
 * anything, and so `SearchInput`/`VoiceSearchButton` never duplicate copy.
 */

const PRIVACY_NOTE =
  "Voice search uses your browser's speech recognition. SSJC Library doesn't save audio. Please don't include children's names or identifying information.";

/** The visible (and screen-reader-announced) status line shown near the search input
 * while voice search is engaged. `null` means there's nothing to say — idle and
 * unsupported both speak for themselves through the input's normal state. */
export function getVoiceStatusMessage(status: VoiceSearchStatus, interimTranscript: string): string | null {
  switch (status) {
    case "listening":
      return interimTranscript ? `Listening… "${interimTranscript}"` : "Listening…";
    case "processing":
      return "Searching…";
    case "no-speech":
      return "I didn't catch anything. Try again, or type your search.";
    case "permission-denied":
      return "Microphone access is blocked. You can allow it in your browser settings, or keep typing instead.";
    case "error":
      return "Voice search had a problem. You can keep typing instead.";
    default:
      return null;
  }
}

/** Shown only while actually engaging the microphone — not on every render, and not
 * dominating the interface (product brief §5). */
export function shouldShowVoicePrivacyNote(status: VoiceSearchStatus): boolean {
  return status === "listening" || status === "processing";
}

export function getVoicePrivacyNoteText(): string {
  return PRIVACY_NOTE;
}

export function getVoiceUnsupportedMessage(): string {
  return "Voice search isn't supported in this browser. You can still type your search.";
}

export function getVoiceButtonLabel(status: VoiceSearchStatus): string {
  return status === "listening" ? "Stop voice search" : "Search by voice";
}
