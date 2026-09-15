import { describe, expect, it } from "vitest";
import { meaningfulTokens, normalizeSearchText, stripDiacritics } from "@/lib/search/normalize";

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
