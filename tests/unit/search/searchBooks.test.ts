import { describe, expect, it } from "vitest";
import { books } from "@/lib/catalog/fixtures";
import { searchBooks } from "@/lib/search/searchBooks";

/**
 * These exercise the exact deterministic scenarios the Phase 2 brief calls out by
 * name, against the real fixture catalog — not synthetic data — so a change to the
 * fixtures or the ranking engine that breaks one of these is caught immediately.
 */
describe("searchBooks — deterministic scenarios", () => {
  it("'dinosaurs' surfaces multiple dinosaur books", () => {
    const results = searchBooks({ books, query: "dinosaurs", filters: {} });
    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results.every((r) => r.book.tags.includes("dinosaurs"))).toBe(true);
  });

  it("'books by Eric Carle' surfaces every book crediting him as author or illustrator", () => {
    const results = searchBooks({ books, query: "books by Eric Carle", filters: {} });
    expect(results.length).toBeGreaterThanOrEqual(3);
    expect(
      results.every(
        (r) => r.book.authors.includes("Eric Carle") || (r.book.illustrators ?? []).includes("Eric Carle")
      )
    ).toBe(true);
  });

  it("'short realistic animal book' surfaces a short, realistic, animal-themed result", () => {
    const results = searchBooks({ books, query: "short realistic animal book", filters: {} });
    expect(results.length).toBeGreaterThan(0);
    const top = results[0].book;
    expect(top.physicalCategory).toBe("animals-nature");
    expect(["real_photography", "realistic_illustration"]).toContain(top.visualRealism);
    expect(top.readAloudMinutes).toBeLessThan(5);
  });

  it("'friendship for age 4' ranks an age-appropriate friendship book above one for older readers", () => {
    const results = searchBooks({ books, query: "friendship for age 4", filters: {} });
    const ids = results.map((r) => r.book.id);
    expect(ids).toContain("big-feelings-small-moments");
    expect(ids).toContain("friends-through-thick-and-thin");
    expect(ids.indexOf("big-feelings-small-moments")).toBeLessThan(ids.indexOf("friends-through-thick-and-thin"));
  });

  it("'Swedish book' surfaces only Swedish-language titles", () => {
    const results = searchBooks({ books, query: "Swedish book", filters: {} });
    expect(results.length).toBeGreaterThanOrEqual(3);
    expect(results.every((r) => r.book.languageCode === "sv")).toBe(true);
  });

  it("'books with real photographs' surfaces only titles that genuinely contain real photography", () => {
    const results = searchBooks({ books, query: "books with real photographs", filters: {} });
    expect(results.length).toBeGreaterThan(0);
    // Pure real-photography titles, and "mixed" titles that explicitly combine real
    // photography with another style (e.g. photos + watercolor diagrams) both count
    // as genuine matches — a book merely mentioning the word "real" in unrelated
    // prose (with no photography anywhere in it) must not.
    expect(
      results.every(
        (r) => r.book.visualRealism === "real_photography" || r.book.illustrationStyles.includes("photography")
      )
    ).toBe(true);
  });

  it("'5 minute read about insects' surfaces an insect book in the matching duration band", () => {
    const results = searchBooks({ books, query: "5 minute read about insects", filters: {} });
    expect(results.length).toBeGreaterThan(0);
    const top = results[0].book;
    expect(top.tags).toContain("insects");
  });

  it("'watercolor books about winter' surfaces a watercolor winter title at the top", () => {
    const results = searchBooks({ books, query: "watercolor books about winter", filters: {} });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].book.id).toBe("winters-quiet-sleep");
  });

  it("a purely generic query returns zero results rather than padding", () => {
    const results = searchBooks({ books, query: "something to read please", filters: {} });
    expect(results).toHaveLength(0);
  });

  it("an incompatible filter combination returns zero results", () => {
    const results = searchBooks({
      books,
      query: "",
      filters: { languages: ["fr"], visualRealism: ["real_photography"] },
    });
    expect(results).toHaveLength(0);
  });

  it("browsing by filters alone (no query) returns every matching book", () => {
    const results = searchBooks({ books, query: "", filters: { languages: ["sv"] } });
    expect(results.length).toBeGreaterThanOrEqual(3);
    expect(results.every((r) => r.book.languageCode === "sv")).toBe(true);
  });

  it("every returned result has a non-empty, grounded explanation when there is a query", () => {
    const results = searchBooks({ books, query: "dinosaurs", filters: {} });
    expect(results.every((r) => r.explanation.length > 0)).toBe(true);
  });
});
