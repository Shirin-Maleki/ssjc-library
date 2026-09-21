import { describe, expect, it } from "vitest";
import { selectTrustworthyDisplayCoverUrl } from "@/lib/intake/displayCover";

describe("intake/displayCover — selectTrustworthyDisplayCoverUrl", () => {
  it("accepts a real Google Books thumbnail URL and upgrades http to https", () => {
    const result = selectTrustworthyDisplayCoverUrl({
      reconciliationOutcome: "high_confidence",
      thumbnailUrl: "http://books.google.com/books/content?id=abc123&printsec=frontcover",
    });
    expect(result).toBe("https://books.google.com/books/content?id=abc123&printsec=frontcover");
  });

  it("accepts a real Open Library cover URL as-is (already https)", () => {
    const result = selectTrustworthyDisplayCoverUrl({
      reconciliationOutcome: "high_confidence",
      thumbnailUrl: "https://covers.openlibrary.org/b/id/12345-M.jpg",
    });
    expect(result).toBe("https://covers.openlibrary.org/b/id/12345-M.jpg");
  });

  it("rejects a candidate whose identity was only ambiguous, never a confirmed match", () => {
    expect(
      selectTrustworthyDisplayCoverUrl({ reconciliationOutcome: "ambiguous", thumbnailUrl: "https://covers.openlibrary.org/b/id/1-M.jpg" })
    ).toBeUndefined();
  });

  it("rejects a candidate whose identity was unresolved", () => {
    expect(
      selectTrustworthyDisplayCoverUrl({ reconciliationOutcome: "unresolved", thumbnailUrl: "https://covers.openlibrary.org/b/id/1-M.jpg" })
    ).toBeUndefined();
  });

  it("rejects a null reconciliation outcome (no reconciliation ever ran)", () => {
    expect(selectTrustworthyDisplayCoverUrl({ reconciliationOutcome: null, thumbnailUrl: "https://covers.openlibrary.org/b/id/1-M.jpg" })).toBeUndefined();
  });

  it("rejects a missing thumbnail URL", () => {
    expect(selectTrustworthyDisplayCoverUrl({ reconciliationOutcome: "high_confidence", thumbnailUrl: null })).toBeUndefined();
    expect(selectTrustworthyDisplayCoverUrl({ reconciliationOutcome: "high_confidence", thumbnailUrl: undefined })).toBeUndefined();
  });

  it("rejects a URL from an untrusted host, even with a confirmed identity", () => {
    expect(
      selectTrustworthyDisplayCoverUrl({ reconciliationOutcome: "high_confidence", thumbnailUrl: "https://evil.example.com/fake-cover.jpg" })
    ).toBeUndefined();
  });

  it("rejects a non-http(s) protocol", () => {
    expect(
      selectTrustworthyDisplayCoverUrl({ reconciliationOutcome: "high_confidence", thumbnailUrl: "javascript:alert(1)" })
    ).toBeUndefined();
    expect(
      selectTrustworthyDisplayCoverUrl({ reconciliationOutcome: "high_confidence", thumbnailUrl: "ftp://books.google.com/cover.jpg" })
    ).toBeUndefined();
  });

  it("rejects a genuinely malformed URL", () => {
    expect(selectTrustworthyDisplayCoverUrl({ reconciliationOutcome: "high_confidence", thumbnailUrl: "not a url" })).toBeUndefined();
  });
});
