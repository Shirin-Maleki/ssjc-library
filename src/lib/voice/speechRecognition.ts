/**
 * Thin adapter around the non-standard browser Web Speech Recognition API
 * (`SpeechRecognition` / the WebKit-prefixed `webkitSpeechRecognition`). Isolated here
 * so no other module needs to touch `window` or feature-detect directly — see
 * docs/DECISIONS.md, "Voice search: browser Web Speech API only, no server involvement."
 *
 * The API is deliberately not part of TypeScript's own DOM lib (it remains
 * non-standard), so only the small shape this app actually uses is declared locally
 * rather than pulling in a third-party `@types` package for the whole surface.
 */

export interface SpeechRecognitionAlternativeLike {
  transcript: string;
  confidence: number;
}

export interface SpeechRecognitionResultLike {
  readonly length: number;
  isFinal: boolean;
  [index: number]: SpeechRecognitionAlternativeLike;
}

export interface SpeechRecognitionResultListLike {
  readonly length: number;
  [index: number]: SpeechRecognitionResultLike;
}

export interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: SpeechRecognitionResultListLike;
}

export type SpeechRecognitionErrorCode =
  | "no-speech"
  | "audio-capture"
  | "not-allowed"
  | "network"
  | "aborted"
  | "service-not-allowed"
  | "bad-grammar"
  | "language-not-supported"
  | string;

export interface SpeechRecognitionErrorEventLike {
  error: SpeechRecognitionErrorCode;
  message?: string;
}

export interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

function getSpeechRecognitionConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function isSpeechRecognitionSupported(): boolean {
  return getSpeechRecognitionConstructor() !== null;
}

/** Creates one configured recognition instance per listening session — a fresh
 * instance each time, rather than a reused singleton, so a prior session's listeners
 * can never leak into a new one. */
export function createSpeechRecognition(): SpeechRecognitionLike | null {
  const Ctor = getSpeechRecognitionConstructor();
  if (!Ctor) return null;
  const recognition = new Ctor();
  recognition.lang = typeof navigator !== "undefined" && navigator.language ? navigator.language : "en-US";
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;
  return recognition;
}

/** The first final transcript found at or after `resultIndex`, or `null` if this event
 * carries no final result (only interim ones). An empty-but-final transcript is
 * returned as `""`, distinct from `null` — the caller treats that as "no speech." */
export function extractFinalTranscript(event: SpeechRecognitionEventLike): string | null {
  for (let i = event.resultIndex; i < event.results.length; i += 1) {
    const result = event.results[i];
    if (result.isFinal) {
      return (result[0]?.transcript ?? "").trim();
    }
  }
  return null;
}

/** The concatenated interim (non-final) transcript at or after `resultIndex`, for live
 * "here's what I'm hearing" display — `null` when there's nothing interim to show. */
export function extractInterimTranscript(event: SpeechRecognitionEventLike): string | null {
  let interim = "";
  for (let i = event.resultIndex; i < event.results.length; i += 1) {
    const result = event.results[i];
    if (!result.isFinal) {
      interim += result[0]?.transcript ?? "";
    }
  }
  return interim || null;
}
