import { describe, expect, it } from "vitest";
import { getReadDurationBand, parseDurationBandFromText } from "@/lib/catalog/duration";

describe("getReadDurationBand", () => {
  it("bands a short read as under 5", () => {
    expect(getReadDurationBand(3)).toBe("under_5");
  });

  it("bands exactly 5 minutes as five_to_ten, not under_5", () => {
    expect(getReadDurationBand(5)).toBe("five_to_ten");
  });

  it("bands exactly 10 minutes as five_to_ten, not ten_plus", () => {
    expect(getReadDurationBand(10)).toBe("five_to_ten");
  });

  it("bands anything over 10 as ten_plus", () => {
    expect(getReadDurationBand(11)).toBe("ten_plus");
  });
});

describe("parseDurationBandFromText", () => {
  it("recognizes 'short'", () => {
    expect(parseDurationBandFromText("a short animal book")).toBe("under_5");
  });

  it("recognizes 'quick'", () => {
    expect(parseDurationBandFromText("something quick before nap time")).toBe("under_5");
  });

  it("resolves an explicit minute count through the same banding function", () => {
    // "5 minute" must agree with getReadDurationBand(5) — both five_to_ten — rather
    // than a separately-maintained, potentially inconsistent keyword threshold.
    expect(parseDurationBandFromText("a 5 minute read about insects")).toBe("five_to_ten");
    expect(parseDurationBandFromText("a 10 minute story")).toBe("five_to_ten");
    expect(parseDurationBandFromText("a 12 minute story")).toBe("ten_plus");
  });

  it("recognizes 'longer' as ten_plus", () => {
    expect(parseDurationBandFromText("something longer for after lunch")).toBe("ten_plus");
  });

  it("returns undefined when no duration is mentioned", () => {
    expect(parseDurationBandFromText("dinosaurs")).toBeUndefined();
  });
});
