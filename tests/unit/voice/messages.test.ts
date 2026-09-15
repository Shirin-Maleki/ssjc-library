import { describe, expect, it } from "vitest";
import {
  getVoiceButtonLabel,
  getVoicePrivacyNoteText,
  getVoiceStatusMessage,
  getVoiceUnsupportedMessage,
  shouldShowVoicePrivacyNote,
} from "@/lib/voice/messages";

describe("voice messages", () => {
  it("has nothing to say when idle or unsupported", () => {
    expect(getVoiceStatusMessage("idle", "")).toBeNull();
    expect(getVoiceStatusMessage("unsupported", "")).toBeNull();
  });

  it("shows a calm listening message, with the interim transcript when present", () => {
    expect(getVoiceStatusMessage("listening", "")).toBe("Listening…");
    expect(getVoiceStatusMessage("listening", "dinosaur books")).toContain("dinosaur books");
  });

  it("shows calm, non-technical recovery copy for every error-like status", () => {
    expect(getVoiceStatusMessage("no-speech", "")).toMatch(/didn't catch anything/i);
    expect(getVoiceStatusMessage("permission-denied", "")).toMatch(/microphone access is blocked/i);
    expect(getVoiceStatusMessage("error", "")).toMatch(/keep typing/i);
  });

  it("shows the privacy note only while actually engaging the microphone", () => {
    expect(shouldShowVoicePrivacyNote("listening")).toBe(true);
    expect(shouldShowVoicePrivacyNote("processing")).toBe(true);
    expect(shouldShowVoicePrivacyNote("idle")).toBe(false);
    expect(shouldShowVoicePrivacyNote("no-speech")).toBe(false);
  });

  it("the privacy note never claims on-device-only processing and never mentions saving audio", () => {
    const note = getVoicePrivacyNoteText();
    expect(note).toMatch(/doesn't save audio/i);
    expect(note.toLowerCase()).not.toContain("on-device");
    expect(note.toLowerCase()).not.toContain("on device");
  });

  it("the unsupported message never implies a broken feature", () => {
    expect(getVoiceUnsupportedMessage()).toMatch(/still type your search/i);
  });

  it("the button's accessible name changes between idle and listening", () => {
    expect(getVoiceButtonLabel("idle")).toBe("Search by voice");
    expect(getVoiceButtonLabel("listening")).toBe("Stop voice search");
  });
});
