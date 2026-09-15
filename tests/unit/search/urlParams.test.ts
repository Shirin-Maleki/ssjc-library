import { describe, expect, it } from "vitest";
import { buildSearchParamsString, parseSearchParams } from "@/lib/search/urlParams";

describe("URL search-state round trip", () => {
  it("round-trips a query with multiple filter groups", () => {
    const query = "dinosaurs";
    const filters = {
      ageYears: 4,
      languages: ["sv", "no"],
      visualRealism: ["real_photography"],
      authors: ["Eric Carle"],
    };

    const search = buildSearchParamsString(query, filters);
    const parsed = parseSearchParams(new URLSearchParams(search));

    expect(parsed.query).toBe(query);
    expect(parsed.filters.ageYears).toBe(4);
    expect(parsed.filters.languages).toEqual(["sv", "no"]);
    expect(parsed.filters.visualRealism).toEqual(["real_photography"]);
    expect(parsed.filters.authors).toEqual(["Eric Carle"]);
  });

  it("produces an empty string for an empty search", () => {
    expect(buildSearchParamsString("", {})).toBe("");
  });

  it("parses an empty params object into an empty query and empty filters", () => {
    const parsed = parseSearchParams({});
    expect(parsed.query).toBe("");
    expect(parsed.filters.languages).toBeUndefined();
    expect(parsed.filters.ageYears).toBeUndefined();
  });

  it("reads from a plain Next.js searchParams-shaped object", () => {
    const parsed = parseSearchParams({ q: "friendship", age: "4", lang: "sv,no" });
    expect(parsed.query).toBe("friendship");
    expect(parsed.filters.ageYears).toBe(4);
    expect(parsed.filters.languages).toEqual(["sv", "no"]);
  });
});
