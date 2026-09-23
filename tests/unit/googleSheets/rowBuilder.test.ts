import { describe, expect, it } from "vitest";
import { buildCatalogRow, buildCoverCell, CATALOG_HEADER_ROW, VISIBLE_COLUMN_COUNT } from "@/lib/googleSheets/rowBuilder";
import type { Book } from "@/lib/catalog/types";

function book(overrides: Partial<Book> = {}): Book {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    title: "A Real Book",
    sortTitle: "A Real Book",
    authors: ["Jane Author"],
    publisher: "A Publisher",
    languageCode: "en",
    description: "A short description.",
    physicalCategory: "stories-imagination",
    tags: ["adventure"],
    illustrationStyles: ["watercolor"],
    cover: { variant: 0 },
    ...overrides,
  };
}

describe("googleSheets/rowBuilder — buildCoverCell", () => {
  it("builds a real IMAGE() formula for a trusted https cover URL", () => {
    expect(buildCoverCell("https://covers.openlibrary.org/b/id/123-M.jpg")).toBe('=IMAGE("https://covers.openlibrary.org/b/id/123-M.jpg")');
  });

  it("returns empty for an untrusted host, never a formula from an arbitrary URL", () => {
    expect(buildCoverCell("https://evil.example.com/cover.jpg")).toBe("");
  });

  it("returns empty for a non-https URL even on a trusted host", () => {
    expect(buildCoverCell("http://covers.openlibrary.org/b/id/123-M.jpg")).toBe("");
  });

  it("returns empty when no display URL exists", () => {
    expect(buildCoverCell(undefined)).toBe("");
  });

  it("returns empty for a malformed URL rather than throwing", () => {
    expect(buildCoverCell("not a url")).toBe("");
  });

  it("never lets a raw double quote from the input URL survive into the formula string (the URL class itself percent-encodes it)", () => {
    const cell = buildCoverCell('https://covers.openlibrary.org/b/id/123".jpg');
    const innerUrl = cell.slice('=IMAGE("'.length, -'")'.length);
    expect(innerUrl).not.toContain('"');
  });
});

describe("googleSheets/rowBuilder — buildCatalogRow header/shape", () => {
  it("has exactly 16 columns: 15 visible teacher-facing columns plus one trailing hidden id column", () => {
    expect(CATALOG_HEADER_ROW.length).toBe(16);
    expect(VISIBLE_COLUMN_COUNT).toBe(15);
    expect(CATALOG_HEADER_ROW[CATALOG_HEADER_ROW.length - 1]).toMatch(/hidden/i);
  });

  it("never exposes a UUID, provenance, or internal field name in the visible header row", () => {
    const visibleHeaders = CATALOG_HEADER_ROW.slice(0, VISIBLE_COLUMN_COUNT).join(" ").toLowerCase();
    expect(visibleHeaders).not.toMatch(/uuid|provenance|ingestion|embedding|confidence/);
  });
});

describe("googleSheets/rowBuilder — buildCatalogRow formula-injection safety", () => {
  it("escapes a title/author/description that begins with =, +, -, or @ so it never becomes a live formula", () => {
    for (const dangerous of ["=1+1", "+SUM(A1:A10)", "-2+2", "@import"]) {
      const row = buildCatalogRow(book({ title: dangerous, description: dangerous }), "Stories & Imagination");
      expect(row[1]).toBe(`'${dangerous}`); // Title column
      expect(row[6]).toBe(`'${dangerous}`); // Short Description column
    }
  });

  it("escapes ordinary safe text too, unconditionally, not only text that looks dangerous", () => {
    const row = buildCatalogRow(book({ title: "A Perfectly Normal Title" }), "Stories & Imagination");
    expect(row[1]).toBe("'A Perfectly Normal Title");
  });

  it("never turns book metadata into the one legitimate formula cell (the cover column stays formula-only for a trusted cover URL)", () => {
    const row = buildCatalogRow(book({ title: "=HYPERLINK(\"http://evil.com\")" }), "Stories & Imagination");
    expect(row[0]).toBe(""); // no display cover set on this fixture — never derived from the title
  });

  it("sends the copy count as a real number, never a string subject to formula interpretation", () => {
    const row = buildCatalogRow(book({ copyCount: 3 }), "Stories & Imagination");
    expect(row[14]).toBe(3);
    expect(typeof row[14]).toBe("number");
  });
});

describe("googleSheets/rowBuilder — buildCatalogRow teacher-friendly formatting", () => {
  it("uses the category display label, never the raw slug", () => {
    const row = buildCatalogRow(book(), "Stories & Imagination");
    expect(row[13]).toBe("'Stories & Imagination");
  });

  it("uses a friendly language name, not a raw ISO code", () => {
    const row = buildCatalogRow(book({ languageCode: "en" }), "x");
    expect(row[8]).toBe("'English");
  });

  it("formats a real age range using the same formatter Find uses", () => {
    const row = buildCatalogRow(book({ ageMinMonths: 24, ageMaxMonths: 60 }), "x");
    expect(row[5]).toBe("'2–5 years");
  });

  it("falls back to 'Not specified' for genuinely unrecorded fiction/illustration/visual-realism fields, never fabricating a value", () => {
    const row = buildCatalogRow(book({ fictionType: undefined, illustrationStyles: [], visualRealism: undefined }), "x");
    expect(row[9]).toBe("'Not specified");
    expect(row[10]).toBe("'Not specified");
    expect(row[11]).toBe("'Not specified");
  });

  it("joins multiple authors/illustrators/tags with commas", () => {
    const row = buildCatalogRow(book({ authors: ["A", "B"], illustrators: ["C", "D"], tags: ["x", "y"] }), "cat");
    expect(row[2]).toBe("'A, B");
    expect(row[3]).toBe("'C, D");
    expect(row[7]).toBe("'x, y");
  });

  it("uses a readable read-time band, never a raw minutes number", () => {
    const row = buildCatalogRow(book({ readAloudMinutes: 3 }), "cat");
    expect(row[12]).toBe("'Under 5 minutes");
  });

  it("defaults copy count to 0 rather than leaving it blank when unrecorded", () => {
    const row = buildCatalogRow(book({ copyCount: undefined }), "cat");
    expect(row[14]).toBe(0);
  });

  it("includes the real book id in the trailing hidden column for stable identification", () => {
    const row = buildCatalogRow(book({ id: "abc-123" }), "cat");
    expect(row[15]).toBe("'abc-123");
  });
});
