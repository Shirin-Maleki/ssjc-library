// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useVoiceSearch } from "@/lib/voice/useVoiceSearch";
import { FakeSpeechRecognition } from "./fakeSpeechRecognition";

describe("useVoiceSearch", () => {
  beforeEach(() => {
    FakeSpeechRecognition.reset();
    (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = FakeSpeechRecognition;
  });

  afterEach(() => {
    cleanup();
    delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
  });

  it("starts idle when the browser supports speech recognition", () => {
    const { result } = renderHook(() => useVoiceSearch());
    expect(result.current.status).toBe("idle");
  });

  it("reports unsupported immediately when no browser API exists", () => {
    delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
    const { result } = renderHook(() => useVoiceSearch());
    expect(result.current.status).toBe("unsupported");
  });

  it("idle -> listening on start()", () => {
    const { result } = renderHook(() => useVoiceSearch());
    act(() => result.current.start());
    expect(result.current.status).toBe("listening");
  });

  it("shows the interim transcript live while listening", () => {
    const { result } = renderHook(() => useVoiceSearch());
    act(() => result.current.start());
    act(() => FakeSpeechRecognition.latest().emitInterim("dino"));
    expect(result.current.status).toBe("listening");
    expect(result.current.interimTranscript).toBe("dino");
  });

  it("listening -> processing with the final transcript on a successful result", () => {
    const { result } = renderHook(() => useVoiceSearch());
    act(() => result.current.start());
    act(() => FakeSpeechRecognition.latest().emitFinal("dinosaur books"));
    expect(result.current.status).toBe("processing");
    expect(result.current.finalTranscript).toBe("dinosaur books");
  });

  it("no-speech: an empty final transcript is treated as no speech captured, not an empty search", () => {
    const { result } = renderHook(() => useVoiceSearch());
    act(() => result.current.start());
    act(() => FakeSpeechRecognition.latest().emitFinal(""));
    expect(result.current.status).toBe("no-speech");
    expect(result.current.finalTranscript).toBeNull();
  });

  it("no-speech: the browser ending the session with no result at all is treated the same way", () => {
    const { result } = renderHook(() => useVoiceSearch());
    act(() => result.current.start());
    act(() => FakeSpeechRecognition.latest().stop());
    expect(result.current.status).toBe("no-speech");
  });

  it("maps 'not-allowed' to permission-denied", () => {
    const { result } = renderHook(() => useVoiceSearch());
    act(() => result.current.start());
    act(() => FakeSpeechRecognition.latest().emitError("not-allowed"));
    expect(result.current.status).toBe("permission-denied");
  });

  it("maps an unrecognized error code to a generic error state", () => {
    const { result } = renderHook(() => useVoiceSearch());
    act(() => result.current.start());
    act(() => FakeSpeechRecognition.latest().emitError("network"));
    expect(result.current.status).toBe("error");
  });

  it("cancel() aborts recognition and returns to idle with no transcript", () => {
    const { result } = renderHook(() => useVoiceSearch());
    act(() => result.current.start());
    act(() => FakeSpeechRecognition.latest().emitInterim("dino"));
    act(() => result.current.cancel());
    expect(result.current.status).toBe("idle");
    expect(result.current.finalTranscript).toBeNull();
  });

  it("reset() returns a settled (non-listening) session to idle", () => {
    const { result } = renderHook(() => useVoiceSearch());
    act(() => result.current.start());
    act(() => FakeSpeechRecognition.latest().emitFinal("dinosaurs"));
    act(() => result.current.reset());
    expect(result.current.status).toBe("idle");
  });

  it("never writes to localStorage during a full listening session — no transcript persistence", () => {
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
    const { result } = renderHook(() => useVoiceSearch());
    act(() => result.current.start());
    act(() => FakeSpeechRecognition.latest().emitInterim("dino"));
    act(() => FakeSpeechRecognition.latest().emitFinal("dinosaur books"));
    expect(setItemSpy).not.toHaveBeenCalled();
    setItemSpy.mockRestore();
  });
});
