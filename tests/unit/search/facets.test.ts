import { describe, expect, it } from "vitest";
import type { Book } from "@/lib/catalog/types";
import { buildFacets } from "@/lib/search/facets";

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

const noCategories: { slug: string; label: string }[] = [];

describe("buildFacets — language facet (Phase 4 correction pass)", () => {
  it("includes a multilingual book's additional languages as real facet options, not just its primary", () => {
    const english = makeBook({ id: "a", languageCode: "en" });
    const bilingual = makeBook({ id: "b", languageCode: "en", additionalLanguageCodes: ["sv"] });
    const facets = buildFacets([english, bilingual], noCategories);

    const values = facets.languages.map((option) => option.value);
    expect(values).toContain("en");
    expect(values).toContain("sv");
  });

  it("never lists a language twice even if several books share it as primary/additional", () => {
    const primary = makeBook({ id: "a", languageCode: "sv" });
    const additional = makeBook({ id: "b", languageCode: "en", additionalLanguageCodes: ["sv"] });
    const facets = buildFacets([primary, additional], noCategories);

    const swedishEntries = facets.languages.filter((option) => option.value === "sv");
    expect(swedishEntries).toHaveLength(1);
  });

  it("a catalog with no multilingual books lists only primary languages, unaffected", () => {
    const english = makeBook({ id: "a", languageCode: "en" });
    const norwegian = makeBook({ id: "b", languageCode: "no" });
    const facets = buildFacets([english, norwegian], noCategories);

    expect(facets.languages.map((o) => o.value).sort()).toEqual(["en", "no"]);
  });
});
