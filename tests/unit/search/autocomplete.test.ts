import { describe, expect, it } from "vitest";
import { books } from "@/lib/catalog/fixtures";
import { PHYSICAL_CATEGORIES } from "@/lib/catalog/categories";
import { deriveAutocompleteOptions } from "@/lib/search/autocomplete";

const categoryLabelBySlug = new Map(PHYSICAL_CATEGORIES.map((c) => [c.id, c.label]));

describe("deriveAutocompleteOptions", () => {
  it("returns nothing for a single character", () => {
    expect(deriveAutocompleteOptions(books, "e", categoryLabelBySlug)).toEqual([]);
  });

  it("suggests an author derived from the catalog, not a hard-coded list", () => {
    const results = deriveAutocompleteOptions(books, "eric ca", categoryLabelBySlug);
    expect(results.some((r) => r.type === "author" && r.value === "Eric Carle")).toBe(true);
  });

  it("labels a category suggestion distinctly from a topic suggestion", () => {
    const results = deriveAutocompleteOptions(books, "anim", categoryLabelBySlug);
    const category = results.find((r) => r.value === "Animals & Nature");
    expect(category?.type).toBe("category");
  });

  it("prioritizes prefix matches over substring-only matches", () => {
    const results = deriveAutocompleteOptions(books, "water", categoryLabelBySlug);
    // "Watercolor" (prefix match) should appear before any suggestion that merely
    // contains "water" elsewhere in the string.
    const index = results.findIndex((r) => r.value === "Watercolor");
    expect(index).toBeGreaterThanOrEqual(0);
    expect(index).toBe(0);
  });

  it("deduplicates identical values of the same type", () => {
    const results = deriveAutocompleteOptions(books, "watercolor", categoryLabelBySlug, 20);
    const watercolorEntries = results.filter((r) => r.value === "Watercolor" && r.type === "illustration_style");
    expect(watercolorEntries).toHaveLength(1);
  });

  it("caps the number of suggestions even when many entities match", () => {
    const results = deriveAutocompleteOptions(books, "an", categoryLabelBySlug, 3);
    expect(results.length).toBeLessThanOrEqual(3);
  });

  it("omits a category suggestion when no label is known for its slug (no silent second taxonomy list)", () => {
    const results = deriveAutocompleteOptions(books, "anim", new Map());
    expect(results.some((r) => r.type === "category")).toBe(false);
  });
});
