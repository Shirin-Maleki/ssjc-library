import { describe, expect, it } from "vitest";
import { ageYearsToRepresentativeMonths, bookMatchesAgeYears, formatAgeRange, parseAgeYearsFromText } from "@/lib/catalog/age";

describe("formatAgeRange", () => {
  it("formats a typical preschool range", () => {
    expect(formatAgeRange(24, 60)).toBe("2–5 years");
  });

  it("formats an exact-year range without a dash", () => {
    expect(formatAgeRange(36, 36)).toBe("3 years");
  });

  it("rounds a partial final year up", () => {
    expect(formatAgeRange(36, 47)).toBe("3–4 years");
  });
});

describe("bookMatchesAgeYears", () => {
  const book = { ageMinMonths: 36, ageMaxMonths: 72 };

  it("matches when the representative point falls inside the range", () => {
    expect(bookMatchesAgeYears(book, 4)).toBe(true);
  });

  it("does not match an age well outside the range", () => {
    expect(bookMatchesAgeYears(book, 10)).toBe(false);
  });

  it("uses the midpoint of the requested year, not just its start", () => {
    // Year 6 spans months 72-83; the book's range ends at 72, so only the very start
    // of year 6 overlaps — the representative point (78) should NOT match.
    expect(ageYearsToRepresentativeMonths(6)).toBe(78);
    expect(bookMatchesAgeYears(book, 6)).toBe(false);
  });
});

describe("parseAgeYearsFromText", () => {
  it("recognizes 'age N'", () => {
    expect(parseAgeYearsFromText("friendship for age 4")).toBe(4);
  });

  it("recognizes 'N year old'", () => {
    expect(parseAgeYearsFromText("something for a 3 year old")).toBe(3);
  });

  it("recognizes a hyphenated digit form", () => {
    expect(parseAgeYearsFromText("a book for a 4-year-old")).toBe(4);
  });

  it("recognizes a hyphenated word form", () => {
    expect(parseAgeYearsFromText("four-year-old dinosaur fan")).toBe(4);
  });

  it("returns undefined when no age is mentioned", () => {
    expect(parseAgeYearsFromText("dinosaurs")).toBeUndefined();
  });
});
