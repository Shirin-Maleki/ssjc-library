import { describe, expect, it } from "vitest";
import { books } from "@/lib/catalog/fixtures";
import { deriveAutocompleteOptions } from "@/lib/search/autocomplete";

describe("deriveAutocompleteOptions", () => {
  it("returns nothing for a single character", () => {
    expect(deriveAutocompleteOptions(books, "e")).toEqual([]);
  });

  it("suggests an author derived from the catalog, not a hard-coded list", () => {
    const results = deriveAutocompleteOptions(books, "eric ca");
    expect(results.some((r) => r.type === "author" && r.value === "Eric Carle")).toBe(true);
  });

  it("labels a category suggestion distinctly from a topic suggestion", () => {
    const results = deriveAutocompleteOptions(books, "anim");
    const category = results.find((r) => r.value === "Animals & Nature");
    expect(category?.type).toBe("category");
  });

  it("prioritizes prefix matches over substring-only matches", () => {
    const results = deriveAutocompleteOptions(books, "water");
    // "Watercolor" (prefix match) should appear before any suggestion that merely
    // contains "water" elsewhere in the string.
    const index = results.findIndex((r) => r.value === "Watercolor");
    expect(index).toBeGreaterThanOrEqual(0);
    expect(index).toBe(0);
  });

  it("deduplicates identical values of the same type", () => {
    const results = deriveAutocompleteOptions(books, "watercolor", 20);
    const watercolorEntries = results.filter((r) => r.value === "Watercolor" && r.type === "illustration_style");
    expect(watercolorEntries).toHaveLength(1);
  });

  it("caps the number of suggestions even when many entities match", () => {
    const results = deriveAutocompleteOptions(books, "an", 3);
    expect(results.length).toBeLessThanOrEqual(3);
  });
});
