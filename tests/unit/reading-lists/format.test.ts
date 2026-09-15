import { describe, expect, it } from "vitest";
import { formatBookCount, formatCreatedBy, formatListDate, isBookInList } from "@/lib/reading-lists/format";
import type { ReadingList } from "@/lib/reading-lists/types";

describe("formatCreatedBy", () => {
  it("shows Anonymous for undefined", () => {
    expect(formatCreatedBy(undefined)).toBe("Anonymous");
  });

  it("shows Anonymous for a whitespace-only value", () => {
    expect(formatCreatedBy("   ")).toBe("Anonymous");
  });

  it("shows the trimmed name otherwise", () => {
    expect(formatCreatedBy("  Ms. Ellis  ")).toBe("Ms. Ellis");
  });
});

describe("formatBookCount", () => {
  it("uses singular for exactly one book", () => {
    expect(formatBookCount(1)).toBe("1 book");
  });

  it("uses plural for zero and for more than one", () => {
    expect(formatBookCount(0)).toBe("0 books");
    expect(formatBookCount(2)).toBe("2 books");
  });
});

describe("formatListDate", () => {
  it("formats a valid ISO date", () => {
    expect(formatListDate("2026-09-14T12:00:00.000Z")).toContain("2026");
  });

  it("returns an empty string for an unparseable date rather than 'Invalid Date'", () => {
    expect(formatListDate("not-a-date")).toBe("");
  });
});

describe("isBookInList", () => {
  const list: ReadingList = {
    id: "l1",
    name: "Insects",
    createdAt: "2026-09-14T00:00:00.000Z",
    updatedAt: "2026-09-14T00:00:00.000Z",
    items: [{ bookId: "book-1", addedAt: "2026-09-14T00:00:00.000Z" }],
  };

  it("is true for a book already on the list", () => {
    expect(isBookInList(list, "book-1")).toBe(true);
  });

  it("is false for a book not on the list", () => {
    expect(isBookInList(list, "book-2")).toBe(false);
  });
});
