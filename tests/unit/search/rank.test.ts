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

  it("credits a literal 'fiction'/'nonfiction' keyword — a soft preference, never a hard filter", () => {
    const fictionBook = makeBook({ id: "a", title: "Dragon Tale", tags: ["dragons"], fictionType: "fiction" });
    const nonfictionBook = makeBook({ id: "b", title: "Real Dragons of History", tags: ["dragons"], fictionType: "nonfiction" });

    expect(scoreBook(fictionBook, "dragons fiction").reasons.some((r) => r.type === "fiction_type")).toBe(true);
    expect(scoreBook(nonfictionBook, "dragons fiction").reasons.some((r) => r.type === "fiction_type")).toBe(false);
    expect(scoreBook(nonfictionBook, "dragons nonfiction").reasons.some((r) => r.type === "fiction_type")).toBe(true);
  });

  it("credits a format-name keyword (e.g. 'picture book', 'board book') — a soft preference", () => {
    const pictureBook = makeBook({ id: "a", title: "Bear Tale", tags: ["bears"], format: "picture_book" });
    const boardBook = makeBook({ id: "b", title: "Bear Tale Two", tags: ["bears"], format: "board_book" });

    expect(scoreBook(pictureBook, "bears picture book").reasons.some((r) => r.type === "format")).toBe(true);
    expect(scoreBook(boardBook, "bears picture book").reasons.some((r) => r.type === "format")).toBe(false);
    expect(scoreBook(boardBook, "bears board book").reasons.some((r) => r.type === "format")).toBe(true);
  });

  it("credits a category-name keyword — a soft/strong structured fit, never a hard filter", () => {
    const natureBook = makeBook({ id: "a", title: "Forest Walk", tags: [], physicalCategory: "animals-nature" });
    expect(scoreBook(natureBook, "animals books").reasons.some((r) => r.type === "category")).toBe(true);
    // Ranking-only: a book NOT in the mentioned category still isn't excluded by
    // scoreBook itself (only an explicit UI category Filter hard-excludes) — it
    // simply doesn't receive this particular bonus.
    const otherCategoryBook = makeBook({ id: "b", title: "Forest Walk Two", tags: [], physicalCategory: "stem-discovery" });
    expect(scoreBook(otherCategoryBook, "animals books").reasons.some((r) => r.type === "category")).toBe(false);
    expect(scoreBook(otherCategoryBook, "animals books").score).not.toBeLessThan(0);
  });

  it("never credits a category/format match from a query word that is merely a SUBSTRING of a category/format word (real-provider validation finding)", () => {
    // A live manual product check with real Gemini embeddings found "day" (from a
    // real exploratory query, "...for the day") falsely matching the
    // "everyday-life-play" category via plain substring containment — "day" is
    // literally inside "everyday". The exact same class of bug as "age" inside
    // "courage" (docs/SEARCH.md), in a new field. Category/format matching must
    // require a whole-word match, not a substring one.
    const everydayBook = makeBook({ id: "a", title: "Music Time", tags: [], physicalCategory: "everyday-life-play" });
    const result = scoreBook(everydayBook, "a story for the day");
    expect(result.reasons.some((r) => r.type === "category")).toBe(false);

    // Format matching has the identical risk (e.g. a query token that's a
    // substring of a format label like "board book" or "early reader") — verified
    // with a word that genuinely IS one of the format label's own words, to prove
    // the fix didn't also break real whole-word format matches.
    const boardBook = makeBook({ id: "b", title: "Counting Blocks", tags: [], format: "board_book" });
    expect(scoreBook(boardBook, "a board book about counting").reasons.some((r) => r.type === "format")).toBe(true);
  });

  it("does not credit 'very' as a meaningful token — it's a substring of 'every'/'everyday' (real-provider validation finding)", () => {
    // A live evaluation run found the known-item query "The Very Hungry
    // Caterpillar" falsely boosting an unrelated book via its "everyday life" tag
    // and via description text containing "every" — "very" is literally embedded
    // in both words, and tag/description matching intentionally stays
    // substring-based (docs/SEARCH.md, for real plural/typo tolerance like
    // "animal" -> "animals"). The fix is stop-wording "very" itself (like "age"),
    // not narrowing tag/description matching.
    const book = makeBook({
      id: "a",
      title: "Mi Familia y Yo",
      tags: ["family", "love", "everyday life"],
      description: "A toddler introduces every member of a warm household.",
    });
    const result = scoreBook(book, "The Very Hungry Caterpillar");
    expect(result.reasons.some((r) => r.type === "tag")).toBe(false);
    expect(result.reasons.some((r) => r.type === "description")).toBe(false);
    expect(result.score).toBe(0);
  });

  it("an unrecorded format/fiction status never fabricates a match", () => {
    const unknownFormatBook = makeBook({ id: "a", title: "Mystery Book", tags: ["mystery"], format: undefined, fictionType: undefined });
    const result = scoreBook(unknownFormatBook, "mystery picture book fiction");
    expect(result.reasons.some((r) => r.type === "format")).toBe(false);
    expect(result.reasons.some((r) => r.type === "fiction_type")).toBe(false);
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
