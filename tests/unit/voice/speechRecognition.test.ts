// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createSpeechRecognition,
  extractFinalTranscript,
  extractInterimTranscript,
  isSpeechRecognitionSupported,
  type SpeechRecognitionEventLike,
} from "@/lib/voice/speechRecognition";
import { FakeSpeechRecognition } from "./fakeSpeechRecognition";

function eventWith(items: Array<{ transcript: string; isFinal: boolean }>): SpeechRecognitionEventLike {
  const results: { length: number } & Record<number, unknown> = { length: items.length };
  items.forEach((item, index) => {
    results[index] = { length: 1, isFinal: item.isFinal, 0: { transcript: item.transcript, confidence: 1 } };
  });
  return { resultIndex: 0, results: results as unknown as SpeechRecognitionEventLike["results"] };
}

describe("speechRecognition adapter — capability detection", () => {
  afterEach(() => {
    delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
    delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
  });

  it("reports supported when window.SpeechRecognition exists", () => {
    (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = FakeSpeechRecognition;
    expect(isSpeechRecognitionSupported()).toBe(true);
    expect(createSpeechRecognition()).not.toBeNull();
  });

  it("reports supported via the webkit-prefixed constructor too", () => {
    (window as unknown as { webkitSpeechRecognition: unknown }).webkitSpeechRecognition = FakeSpeechRecognition;
    expect(isSpeechRecognitionSupported()).toBe(true);
  });

  it("reports unsupported when neither constructor exists", () => {
    expect(isSpeechRecognitionSupported()).toBe(false);
    expect(createSpeechRecognition()).toBeNull();
  });

  it("configures a created instance for single-utterance, interim-enabled listening", () => {
    (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = FakeSpeechRecognition;
    const recognition = createSpeechRecognition();
    expect(recognition?.continuous).toBe(false);
    expect(recognition?.interimResults).toBe(true);
  });
});

describe("speechRecognition adapter — transcript extraction", () => {
  beforeEach(() => {
    FakeSpeechRecognition.reset();
  });

  it("extracts a final transcript when present", () => {
    const event = eventWith([{ transcript: "dinosaur books", isFinal: true }]);
    expect(extractFinalTranscript(event)).toBe("dinosaur books");
  });

  it("returns null (not a final transcript) when only interim results exist", () => {
    const event = eventWith([{ transcript: "dino", isFinal: false }]);
    expect(extractFinalTranscript(event)).toBeNull();
    expect(extractInterimTranscript(event)).toBe("dino");
  });

  it("distinguishes an empty final transcript (no speech) from no final result at all", () => {
    const event = eventWith([{ transcript: "", isFinal: true }]);
    expect(extractFinalTranscript(event)).toBe("");
  });

  it("trims surrounding whitespace from a final transcript", () => {
    const event = eventWith([{ transcript: "  Eric Carle  ", isFinal: true }]);
    expect(extractFinalTranscript(event)).toBe("Eric Carle");
  });
});
