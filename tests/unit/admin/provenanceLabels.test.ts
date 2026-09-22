import { describe, expect, it } from "vitest";
import { describeConfidence, describeProvenanceSource, describeProvider, describeReconciliationOutcome } from "@/lib/admin/provenanceLabels";

describe("admin/provenanceLabels — describeProvenanceSource", () => {
  it("maps every source type to a calm, human-readable label", () => {
    expect(describeProvenanceSource("cover_visible")).toBe("From cover");
    expect(describeProvenanceSource("ai_inferred")).toBe("AI suggested");
    expect(describeProvenanceSource("human_corrected")).toBe("Corrected by staff");
    expect(describeProvenanceSource("human_verified")).toBe("Verified by staff");
  });

  it("defaults external_provider to Open Library when no specific label is recorded", () => {
    expect(describeProvenanceSource("external_provider")).toBe("From Open Library");
    expect(describeProvenanceSource("external_provider", null)).toBe("From Open Library");
  });

  it("prefers a specific recorded sourceLabel over the generic default", () => {
    expect(describeProvenanceSource("external_provider", "Google Books")).toBe("From Google Books");
  });

  it("never returns a raw table/enum-looking string with underscores", () => {
    const labels = (["external_provider", "ai_inferred", "cover_visible", "human_corrected", "human_verified"] as const).map((s) => describeProvenanceSource(s));
    for (const label of labels) expect(label).not.toMatch(/_/);
  });
});

describe("admin/provenanceLabels — describeConfidence", () => {
  it("maps high/medium to their plain labels", () => {
    expect(describeConfidence("high")).toBe("High");
    expect(describeConfidence("medium")).toBe("Medium");
  });

  it("maps low confidence and a missing confidence level both to 'Needs review', never a raw decimal", () => {
    expect(describeConfidence("low")).toBe("Needs review");
    expect(describeConfidence(null)).toBe("Needs review");
  });
});

describe("admin/provenanceLabels — describeProvider", () => {
  it("maps known provider ids to their real names", () => {
    expect(describeProvider("open_library")).toBe("Open Library");
    expect(describeProvider("google_books")).toBe("Google Books");
  });

  it("falls back to the raw value for an unrecognized provider rather than hiding it", () => {
    expect(describeProvider("some_future_provider")).toBe("some_future_provider");
  });
});

describe("admin/provenanceLabels — describeReconciliationOutcome", () => {
  it("maps every reconciliation outcome to plain language", () => {
    expect(describeReconciliationOutcome("high_confidence")).toBe("Confirmed match");
    expect(describeReconciliationOutcome("ambiguous")).toBe("Possible match, not confirmed");
    expect(describeReconciliationOutcome("unresolved")).toBe("Not confirmed");
  });

  it("treats a missing outcome as not confirmed", () => {
    expect(describeReconciliationOutcome(null)).toBe("Not confirmed");
  });
});
