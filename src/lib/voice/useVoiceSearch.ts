"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createSpeechRecognition,
  extractFinalTranscript,
  extractInterimTranscript,
  isSpeechRecognitionSupported,
  type SpeechRecognitionLike,
} from "./speechRecognition";

export type VoiceSearchStatus =
  | "unsupported"
  | "idle"
  | "listening"
  | "processing"
  | "permission-denied"
  | "no-speech"
  | "error";

export interface VoiceSearchState {
  status: VoiceSearchStatus;
  interimTranscript: string;
  finalTranscript: string | null;
}

const IDLE_STATE: VoiceSearchState = { status: "idle", interimTranscript: "", finalTranscript: null };
const UNSUPPORTED_STATE: VoiceSearchState = { status: "unsupported", interimTranscript: "", finalTranscript: null };

/**
 * Owns only the browser SpeechRecognition lifecycle and an explicit status —
 * see docs/DECISIONS.md, "Voice search architecture: a state machine, not booleans."
 * It has no idea what a "search" or a "query" is: the caller (SearchInput) reads
 * `finalTranscript` once `status` becomes "processing" and is responsible for placing
 * it into the query and navigating via the exact same path typed search already uses.
 * This hook never calls `searchBooks` or builds a URL itself.
 *
 * `stop()` vs `cancel()` are deliberately different outcomes, matching the product
 * brief: `stop()` asks the browser to finish gracefully (whatever was heard so far
 * still produces a final result, which becomes a real search); `cancel()` aborts
 * immediately and returns to idle with no result, for the caller to then restore
 * whatever query existed before listening started.
 */
export function useVoiceSearch() {
  const [state, setState] = useState<VoiceSearchState>(() =>
    isSpeechRecognitionSupported() ? IDLE_STATE : UNSUPPORTED_STATE
  );
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const settledRef = useRef(false);

  useEffect(() => {
    return () => {
      recognitionRef.current?.abort();
    };
  }, []);

  const start = useCallback(() => {
    const recognition = createSpeechRecognition();
    if (!recognition) {
      setState(UNSUPPORTED_STATE);
      return;
    }
    settledRef.current = false;
    recognitionRef.current = recognition;

    recognition.onstart = () => {
      setState({ status: "listening", interimTranscript: "", finalTranscript: null });
    };

    recognition.onresult = (event) => {
      const finalTranscript = extractFinalTranscript(event);
      if (finalTranscript !== null) {
        settledRef.current = true;
        if (finalTranscript.length === 0) {
          setState({ status: "no-speech", interimTranscript: "", finalTranscript: null });
          return;
        }
        setState({ status: "processing", interimTranscript: "", finalTranscript });
        return;
      }
      const interim = extractInterimTranscript(event);
      if (interim !== null) {
        setState({ status: "listening", interimTranscript: interim, finalTranscript: null });
      }
    };

    recognition.onerror = (event) => {
      settledRef.current = true;
      if (event.error === "no-speech") {
        setState({ status: "no-speech", interimTranscript: "", finalTranscript: null });
      } else if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        setState({ status: "permission-denied", interimTranscript: "", finalTranscript: null });
      } else if (event.error === "aborted") {
        // A deliberate cancel() already moved state back to idle; nothing more to do.
      } else {
        setState({ status: "error", interimTranscript: "", finalTranscript: null });
      }
    };

    recognition.onend = () => {
      if (!settledRef.current) {
        // The browser stopped listening (e.g. silence) without ever firing a result
        // or an error — treat it the same as an explicit "no-speech" error.
        setState((prev) => (prev.status === "listening" ? { status: "no-speech", interimTranscript: "", finalTranscript: null } : prev));
      }
    };

    try {
      recognition.start();
    } catch {
      setState({ status: "error", interimTranscript: "", finalTranscript: null });
    }
  }, []);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
  }, []);

  const cancel = useCallback(() => {
    settledRef.current = true;
    recognitionRef.current?.abort();
    recognitionRef.current = null;
    setState((prev) => (prev.status === "unsupported" ? prev : IDLE_STATE));
  }, []);

  const reset = useCallback(() => {
    setState((prev) => (prev.status === "unsupported" ? prev : IDLE_STATE));
  }, []);

  return { ...state, start, stop, cancel, reset };
}
