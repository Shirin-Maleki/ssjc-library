import { describe, expect, it } from "vitest";
import { meaningfulTokens, normalizeSearchText, normalizeTitle, stripDiacritics } from "@/lib/search/normalize";

describe("normalizeSearchText", () => {
  it("lowercases, strips punctuation, and collapses whitespace", () => {
    expect(normalizeSearchText("  The Very Hungry Caterpillar!!  ")).toBe("the very hungry caterpillar");
  });

  it("strips diacritics so accented titles are matchable unaccented", () => {
    expect(normalizeSearchText("Frøet")).toBe("froet");
    expect(normalizeSearchText("Bestefars Båt")).toBe("bestefars bat");
  });
});

describe("stripDiacritics", () => {
  it("folds common Scandinavian and Spanish accented letters", () => {
    expect(stripDiacritics("día")).toBe("dia");
    expect(stripDiacritics("Skoven")).toBe("Skoven");
  });
});

describe("normalizeTitle — the one canonical title normalizer for both storage and query sides", () => {
  it("strips a leading article", () => {
    expect(normalizeTitle("The Very Hungry Caterpillar")).toBe("very hungry caterpillar");
    expect(normalizeTitle("A Little Bit of Music and Movement")).toBe("little bit of music and movement");
  });

  it("a query retyped WITH the leading article still normalizes to the same value as the stored title", () => {
    // Regression test: the exact-match query previously compared a bare
    // `trimmed.toLowerCase()` against `normalized_title`, so "The Very Hungry
    // Caterpillar" (with its article) never matched the stored, article-stripped
    // value — both sides must go through this same function.
    expect(normalizeTitle("The Very Hungry Caterpillar")).toBe(normalizeTitle("Very Hungry Caterpillar"));
  });

  it("strips diacritics and collapses punctuation", () => {
    expect(normalizeTitle("Bestefars Båt")).toBe("bestefars bat");
    expect(normalizeTitle("Frøet som ville blomstre")).toBe("froet som ville blomstre");
    expect(normalizeTitle("Guess How Much I Love You?")).toBe("guess how much i love you");
  });
});

describe("meaningfulTokens", () => {
  it("drops stop words", () => {
    expect(meaningfulTokens("I want a book about dinosaurs please")).toEqual(["dinosaurs"]);
  });

  it("drops 'by' so an author name is the only meaningful token set", () => {
    expect(meaningfulTokens("books by Eric Carle")).toEqual(["eric", "carle"]);
  });

  it("returns an empty array for a purely generic query", () => {
    expect(meaningfulTokens("something to read")).toEqual([]);
  });
});
