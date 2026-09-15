import { describe, expect, it } from "vitest";
import type { Book } from "@/lib/catalog/types";
import { countActiveFilters, matchesFilters } from "@/lib/search/filters";

function makeBook(overrides: Partial<Book> & { id: string }): Book {
  return {
    title: "Fixture Title",
    sortTitle: "Fixture Title",
    authors: ["Fixture Author"],
    illustrators: [],
    publisher: "Fixture Publisher",
    languageCode: "en",
    description: "Fixture description.",
    ageMinMonths: 36,
    ageMaxMonths: 72,
    fictionType: "fiction",
    format: "picture_book",
    physicalCategory: "stories-imagination",
    tags: [],
    illustrationStyles: ["watercolor"],
    visualRealism: "stylized_illustration",
    readAloudMinutes: 5,
    cover: { variant: 0 },
    ...overrides,
  };
}

describe("matchesFilters", () => {
  it("passes every book when no filters are set", () => {
    expect(matchesFilters(makeBook({ id: "a" }), {})).toBe(true);
  });

  it("applies OR logic within a single multi-select group (language)", () => {
    const swedish = makeBook({ id: "a", languageCode: "sv" });
    const norwegian = makeBook({ id: "b", languageCode: "no" });
    const english = makeBook({ id: "c", languageCode: "en" });
    const filters = { languages: ["sv", "no"] };

    expect(matchesFilters(swedish, filters)).toBe(true);
    expect(matchesFilters(norwegian, filters)).toBe(true);
    expect(matchesFilters(english, filters)).toBe(false);
  });

  it("applies AND logic across different filter groups", () => {
    const matches = makeBook({ id: "a", languageCode: "sv", visualRealism: "real_photography" });
    const wrongLanguage = makeBook({ id: "b", languageCode: "en", visualRealism: "real_photography" });
    const wrongRealism = makeBook({ id: "c", languageCode: "sv", visualRealism: "cartoon" });

    const filters = { languages: ["sv"], visualRealism: ["real_photography"] };

    expect(matchesFilters(matches, filters)).toBe(true);
    expect(matchesFilters(wrongLanguage, filters)).toBe(false);
    expect(matchesFilters(wrongRealism, filters)).toBe(false);
  });

  it("matches an age filter against a book's month range", () => {
    const book = makeBook({ id: "a", ageMinMonths: 36, ageMaxMonths: 72 });
    expect(matchesFilters(book, { ageYears: 4 })).toBe(true);
    expect(matchesFilters(book, { ageYears: 10 })).toBe(false);
  });

  it("matches a duration filter against the book's computed band", () => {
    const shortBook = makeBook({ id: "a", readAloudMinutes: 3 });
    const longBook = makeBook({ id: "b", readAloudMinutes: 12 });
    expect(matchesFilters(shortBook, { durations: ["under_5"] })).toBe(true);
    expect(matchesFilters(longBook, { durations: ["under_5"] })).toBe(false);
  });

  it("matches illustration-style filters against any of a book's several styles", () => {
    const book = makeBook({ id: "a", illustrationStyles: ["watercolor", "ink"] });
    expect(matchesFilters(book, { illustrationStyles: ["ink"] })).toBe(true);
    expect(matchesFilters(book, { illustrationStyles: ["photography"] })).toBe(false);
  });
});

describe("countActiveFilters", () => {
  it("counts zero for empty filters", () => {
    expect(countActiveFilters({})).toBe(0);
  });

  it("counts an age selection and each multi-select entry", () => {
    expect(countActiveFilters({ ageYears: 4, languages: ["sv", "no"] })).toBe(3);
  });
});
