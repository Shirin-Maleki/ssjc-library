import { describe, expect, it } from "vitest";
import type { Book } from "@/lib/catalog/types";
import { rankBooks, scoreBook } from "@/lib/search/rank";

function makeBook(overrides: Partial<Book> & { id: string; title: string }): Book {
  return {
    subtitle: undefined,
    authors: ["Fixture Author"],
    illustrators: [],
    publisher: "Fixture Publisher",
    languageCode: "en",
    description: "A fixture description with no special keywords.",
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
    sortTitle: overrides.title,
    ...overrides,
  };
}

describe("scoreBook", () => {
  it("scores an exact title match higher than a tag-only match", () => {
    const exact = makeBook({ id: "a", title: "Dinosaur Adventure" });
    const tagOnly = makeBook({ id: "b", title: "Something Else Entirely", tags: ["dinosaurs"] });

    const exactScore = scoreBook(exact, "dinosaur adventure").score;
    const tagScore = scoreBook(tagOnly, "dinosaur adventure").score;

    expect(exactScore).toBeGreaterThan(tagScore);
  });

  it("gives no score to a book matching nothing", () => {
    const book = makeBook({ id: "a", title: "Totally Unrelated Title" });
    expect(scoreBook(book, "dinosaurs").score).toBe(0);
  });

  it("does not score a book on generic stop words alone", () => {
    const book = makeBook({ id: "a", title: "Totally Unrelated Title" });
    expect(scoreBook(book, "a book please").score).toBe(0);
  });

  it("credits an author match", () => {
    const book = makeBook({ id: "a", title: "Some Title", authors: ["Eric Carle"] });
    const result = scoreBook(book, "books by Eric Carle");
    expect(result.score).toBeGreaterThan(0);
    expect(result.reasons.some((r) => r.type === "author")).toBe(true);
  });

  it("credits an age-intent match only when the book's range covers it", () => {
    const inRange = makeBook({ id: "a", title: "Friendship Story", tags: ["friendship"], ageMinMonths: 36, ageMaxMonths: 72 });
    const outOfRange = makeBook({ id: "b", title: "Friendship Chapter Book", tags: ["friendship"], ageMinMonths: 84, ageMaxMonths: 132 });

    const inRangeResult = scoreBook(inRange, "friendship for age 4");
    const outOfRangeResult = scoreBook(outOfRange, "friendship for age 4");

    expect(inRangeResult.reasons.some((r) => r.type === "age")).toBe(true);
    expect(outOfRangeResult.reasons.some((r) => r.type === "age")).toBe(false);
    expect(inRangeResult.score).toBeGreaterThan(outOfRangeResult.score);
  });

  it("credits a real-photography intent only for a book with that visual realism", () => {
    const photoBook = makeBook({ id: "a", title: "Animal Book", tags: ["animals"], visualRealism: "real_photography" });
    const illustratedBook = makeBook({ id: "b", title: "Animal Story", tags: ["animals"], visualRealism: "cartoon" });

    expect(scoreBook(photoBook, "animal books with real photos").reasons.some((r) => r.type === "visual_realism")).toBe(true);
    expect(scoreBook(illustratedBook, "animal books with real photos").reasons.some((r) => r.type === "visual_realism")).toBe(false);
  });
});

describe("rankBooks", () => {
  it("excludes non-meaningful matches entirely rather than padding results", () => {
    const books = [
      makeBook({ id: "a", title: "Dinosaur Adventure", tags: ["dinosaurs"] }),
      makeBook({ id: "b", title: "Totally Unrelated" }),
    ];
    const results = rankBooks(books, "dinosaurs");
    expect(results).toHaveLength(1);
    expect(results[0].book.id).toBe("a");
  });

  it("returns all books alphabetically by sort title when the query is empty", () => {
    const books = [
      makeBook({ id: "b", title: "Bear Book" }),
      makeBook({ id: "a", title: "Apple Book" }),
    ];
    const results = rankBooks(books, "");
    expect(results.map((r) => r.book.id)).toEqual(["a", "b"]);
  });

  it("breaks equal scores deterministically by sort title", () => {
    const books = [
      makeBook({ id: "z", title: "Zebra Facts", tags: ["animals"] }),
      makeBook({ id: "a", title: "Ant Facts", tags: ["animals"] }),
    ];
    const results = rankBooks(books, "facts");
    expect(results[0].score).toBe(results[1].score);
    expect(results.map((r) => r.book.id)).toEqual(["a", "z"]);
  });
});
