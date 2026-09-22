import { describe, expect, it } from "vitest";
import { generateUniqueCategorySlug, slugify } from "@/lib/admin/categorySlug";

describe("admin/categorySlug — slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("Animals & Nature")).toBe("animals-nature");
  });

  it("strips diacritics rather than dropping the letter entirely", () => {
    expect(slugify("Café Stories")).toBe("cafe-stories");
  });

  it("collapses repeated separators and trims leading/trailing hyphens", () => {
    expect(slugify("  Science -- & Tech!!  ")).toBe("science-tech");
  });
});

describe("admin/categorySlug — generateUniqueCategorySlug", () => {
  it("a brand-new label with no collision gets the clean slug, no suffix", () => {
    const slug = generateUniqueCategorySlug("Graphic Novels", new Set(["animals-nature", "picture-books"]));
    expect(slug).toBe("graphic-novels");
  });

  it("a colliding slug gets a -2 suffix", () => {
    const slug = generateUniqueCategorySlug("Picture Books", new Set(["picture-books"]));
    expect(slug).toBe("picture-books-2");
  });

  it("increments the suffix past multiple existing collisions", () => {
    const slug = generateUniqueCategorySlug("Picture Books", new Set(["picture-books", "picture-books-2", "picture-books-3"]));
    expect(slug).toBe("picture-books-4");
  });

  it("a deactivated category's slug still counts as a collision — slugs are never reused", () => {
    // existingSlugs is expected to include every category regardless of active state
    const slug = generateUniqueCategorySlug("Old Category", new Set(["old-category"]));
    expect(slug).toBe("old-category-2");
  });
});
