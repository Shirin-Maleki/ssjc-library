// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SearchInput } from "@/components/find/SearchInput";
import { EMPTY_FILTERS } from "@/lib/search/filters";
import { FakeSpeechRecognition } from "../voice/fakeSpeechRecognition";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

/**
 * Component-level coverage for the Phase 3 acceptance criterion that a spoken
 * transcript must reuse the exact same navigation path typed search already uses
 * (docs/DECISIONS.md) — this renders the real `SearchInput`, not a stand-in, against a
 * scripted fake `SpeechRecognition` (the same shape the E2E suite installs via
 * `page.addInitScript`, per docs/TESTING.md).
 */
describe("SearchInput — voice integration", () => {
  beforeEach(() => {
    pushMock.mockClear();
    FakeSpeechRecognition.reset();
    (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = FakeSpeechRecognition;
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
    vi.useRealTimers();
  });

  it("a final transcript navigates through buildFindHref, the same path typed Enter uses", () => {
    render(<SearchInput initialQuery="" filters={EMPTY_FILTERS} />);
    const micButton = screen.getByRole("button", { name: "Search by voice" });

    act(() => micButton.click());
    act(() => FakeSpeechRecognition.latest().emitFinal("dinosaurs"));
    act(() => vi.advanceTimersByTime(500));

    expect(pushMock).toHaveBeenCalledTimes(1);
    expect(pushMock.mock.calls[0][0]).toBe("/find?q=dinosaurs");
  });

  it("existing filters survive a voice search exactly as they survive a typed one", () => {
    render(<SearchInput initialQuery="" filters={{ ...EMPTY_FILTERS, languages: ["sv"], ageYears: 4 }} />);
    const micButton = screen.getByRole("button", { name: "Search by voice" });

    act(() => micButton.click());
    act(() => FakeSpeechRecognition.latest().emitFinal("bedtime stories"));
    act(() => vi.advanceTimersByTime(500));

    const url = pushMock.mock.calls[0][0] as string;
    expect(url).toContain("q=bedtime");
    expect(url).toContain("lang=sv");
    expect(url).toContain("age=4");
  });

  it("the transcript is visible in the search field before the search runs", () => {
    render(<SearchInput initialQuery="" filters={EMPTY_FILTERS} />);
    const micButton = screen.getByRole("button", { name: "Search by voice" });
    const input = screen.getByRole("combobox") as HTMLInputElement;

    act(() => micButton.click());
    act(() => FakeSpeechRecognition.latest().emitFinal("Eric Carle"));

    expect(input.value).toBe("Eric Carle");
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("cancel restores the pre-voice query and does not navigate", () => {
    render(<SearchInput initialQuery="eric carle" filters={EMPTY_FILTERS} />);
    const input = screen.getByRole("combobox") as HTMLInputElement;
    expect(input.value).toBe("eric carle");

    const micButton = screen.getByRole("button", { name: "Search by voice" });
    act(() => micButton.click());
    act(() => FakeSpeechRecognition.latest().emitInterim("dino books"));
    expect(input.value).toBe("dino books");

    const cancelButton = screen.getByRole("button", { name: "Cancel voice search" });
    act(() => cancelButton.click());

    expect(input.value).toBe("eric carle");
    act(() => vi.advanceTimersByTime(500));
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("no-speech shows calm recovery copy and never navigates to an empty search", () => {
    render(<SearchInput initialQuery="" filters={EMPTY_FILTERS} />);
    const micButton = screen.getByRole("button", { name: "Search by voice" });
    act(() => micButton.click());
    act(() => FakeSpeechRecognition.latest().emitFinal(""));

    // The message is rendered twice by design: once in a visually-hidden aria-live
    // region for screen readers, once as visible text for sighted users.
    expect(screen.getAllByText(/didn't catch anything/i).length).toBeGreaterThan(0);
    act(() => vi.advanceTimersByTime(500));
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("permission denied shows calm recovery copy and typed search remains available", () => {
    render(<SearchInput initialQuery="" filters={EMPTY_FILTERS} />);
    const micButton = screen.getByRole("button", { name: "Search by voice" });
    act(() => micButton.click());
    act(() => FakeSpeechRecognition.latest().emitError("not-allowed"));

    expect(screen.getAllByText(/microphone access is blocked/i).length).toBeGreaterThan(0);
    const input = screen.getByRole("combobox") as HTMLInputElement;
    expect(input).not.toHaveProperty("readOnly", true);
  });

  it("renders no mic control and an honest fallback when the browser has no SpeechRecognition", () => {
    delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
    render(<SearchInput initialQuery="" filters={EMPTY_FILTERS} />);

    expect(screen.queryByRole("button", { name: "Search by voice" })).toBeNull();
    expect(screen.getByText(/voice search isn't supported in this browser/i)).toBeTruthy();
    // Typed search is still fully present and usable.
    expect(screen.getByRole("combobox")).toBeTruthy();
  });
});
