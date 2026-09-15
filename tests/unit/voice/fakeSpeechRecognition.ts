import type {
  SpeechRecognitionErrorEventLike,
  SpeechRecognitionEventLike,
  SpeechRecognitionLike,
  SpeechRecognitionResultListLike,
} from "@/lib/voice/speechRecognition";

/**
 * A controllable fake `SpeechRecognition` used by both unit/component tests here and,
 * conceptually, by the E2E `page.addInitScript()` mock (docs/TESTING.md) — the shape
 * exercises real production code (`useVoiceSearch`, `SearchInput`) against a fully
 * scripted browser API, never a fake speech endpoint.
 */
export class FakeSpeechRecognition implements SpeechRecognitionLike {
  static instances: FakeSpeechRecognition[] = [];

  lang = "";
  continuous = false;
  interimResults = false;
  maxAlternatives = 1;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null = null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null = null;

  private endedAlready = false;

  constructor() {
    FakeSpeechRecognition.instances.push(this);
  }

  static reset() {
    FakeSpeechRecognition.instances = [];
  }

  static latest(): FakeSpeechRecognition {
    const instance = FakeSpeechRecognition.instances[FakeSpeechRecognition.instances.length - 1];
    if (!instance) throw new Error("No FakeSpeechRecognition instance has been created yet");
    return instance;
  }

  start() {
    this.endedAlready = false;
    this.onstart?.();
  }

  stop() {
    this.endIfNotAlready();
  }

  abort() {
    this.onerror?.({ error: "aborted" });
    this.endIfNotAlready();
  }

  /** Simulates an interim (non-final) result — the browser is still listening. */
  emitInterim(transcript: string) {
    this.onresult?.({ resultIndex: 0, results: makeResultList([{ transcript, isFinal: false }]) });
  }

  /** Simulates a final result, followed by the browser naturally ending the session —
   * matches real SpeechRecognition behavior (a final result always ends listening). */
  emitFinal(transcript: string) {
    this.onresult?.({ resultIndex: 0, results: makeResultList([{ transcript, isFinal: true }]) });
    this.endIfNotAlready();
  }

  emitError(error: string) {
    this.onerror?.({ error });
    this.endIfNotAlready();
  }

  private endIfNotAlready() {
    if (this.endedAlready) return;
    this.endedAlready = true;
    this.onend?.();
  }
}

function makeResultList(items: Array<{ transcript: string; isFinal: boolean }>): SpeechRecognitionResultListLike {
  const results: { length: number } & Record<number, unknown> = { length: items.length };
  items.forEach((item, index) => {
    results[index] = {
      length: 1,
      isFinal: item.isFinal,
      0: { transcript: item.transcript, confidence: 1 },
    };
  });
  return results as unknown as SpeechRecognitionResultListLike;
}
