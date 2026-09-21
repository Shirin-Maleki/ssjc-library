import { describe, expect, it } from "vitest";
import { validateCategorySuggestion } from "@/lib/intake/categorySuggestion";
import type { PhysicalCategoryOption } from "@/db/repositories/categoryRepository";

const ACTIVE_CATEGORIES: PhysicalCategoryOption[] = [
  { slug: "picture-books", label: "Picture Books" },
  { slug: "early-readers", label: "Early Readers" },
];

describe("intake/categorySuggestion — validateCategorySuggestion", () => {
  it("accepts a slug that is genuinely in the active list", () => {
    const result = validateCategorySuggestion(
      { physicalCategorySlug: "picture-books", categoryConfidence: "high", categoryReason: "Clearly a picture book." },
      ACTIVE_CATEGORIES
    );
    expect(result).toEqual({
      slug: "picture-books",
      label: "Picture Books",
      confidence: "high",
      reason: "Clearly a picture book.",
    });
  });

  it("returns undefined for a null suggestion (no invented fallback)", () => {
    const result = validateCategorySuggestion({ physicalCategorySlug: null, categoryConfidence: null, categoryReason: null }, ACTIVE_CATEGORIES);
    expect(result).toBeUndefined();
  });

  it("returns undefined for a slug the model invented that isn't in the active list", () => {
    const result = validateCategorySuggestion(
      { physicalCategorySlug: "board-books", categoryConfidence: "high", categoryReason: "Looks sturdy." },
      ACTIVE_CATEGORIES
    );
    expect(result).toBeUndefined();
  });

  it("returns undefined for a slug that was active when prompted but has since been deactivated", () => {
    const staleSlug = "retired-category";
    const result = validateCategorySuggestion({ physicalCategorySlug: staleSlug, categoryConfidence: "medium", categoryReason: null }, []);
    expect(result).toBeUndefined();
  });

  it("never fabricates a label — the label always comes from the real active category, not the model", () => {
    const result = validateCategorySuggestion(
      { physicalCategorySlug: "picture-books", categoryConfidence: null, categoryReason: null },
      [{ slug: "picture-books", label: "Picture Books (Ages 0-5)" }]
    );
    expect(result?.label).toBe("Picture Books (Ages 0-5)");
  });
});
