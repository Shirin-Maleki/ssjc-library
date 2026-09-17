import { describe, expect, it } from "vitest";
import {
  buildEmbeddingDocument,
  buildSearchIndexText,
  EMBEDDING_COMPOSITION_VERSION,
  type EmbeddingDocumentInput,
} from "@/lib/embeddings/document";

const baseInput: EmbeddingDocumentInput = {
  title: "The Very Hungry Caterpillar",
  authors: ["Eric Carle"],
  illustrators: ["Eric Carle"],
  publisher: "Philomel Books",
  categoryLabel: "Animals & Nature",
  tags: ["life cycle", "caterpillars", "insects"],
  languageCode: "en",
  fictionType: "fiction",
  format: "picture_book",
  illustrationStyles: ["collage", "painted"],
  visualRealism: "stylized_illustration",
  ageMinMonths: 24,
  ageMaxMonths: 60,
  readAloudMinutes: 5,
  description: "A very hungry caterpillar eats its way through a week of food.",
};

describe("buildEmbeddingDocument", () => {
  it("is byte-identical across two calls with the same input (determinism)", () => {
    const first = buildEmbeddingDocument(baseInput);
    const second = buildEmbeddingDocument({ ...baseInput });
    expect(first.text).toBe(second.text);
    expect(first.sourceHash).toBe(second.sourceHash);
  });

  it("carries the current composition version", () => {
    expect(buildEmbeddingDocument(baseInput).version).toBe(EMBEDDING_COMPOSITION_VERSION);
  });

  it("sourceHash changes when the underlying data changes", () => {
    const original = buildEmbeddingDocument(baseInput);
    const changed = buildEmbeddingDocument({ ...baseInput, description: "A different description entirely." });
    expect(changed.sourceHash).not.toBe(original.sourceHash);
  });

  it("sorts tags alphabetically regardless of input order — storage/join order carries no meaning", () => {
    const shuffled = buildEmbeddingDocument({ ...baseInput, tags: ["insects", "caterpillars", "life cycle"] });
    expect(shuffled.text).toContain("Topics: caterpillars, insects, life cycle");
  });

  it("omits a field entirely when it is undefined, rather than printing an empty or placeholder line", () => {
    const minimal = buildEmbeddingDocument({
      title: "Book With Incomplete Metadata",
      authors: [],
      tags: [],
      languageCode: "en",
      illustrationStyles: [],
    });
    expect(minimal.text).not.toMatch(/Type:/);
    expect(minimal.text).not.toMatch(/Format:/);
    expect(minimal.text).not.toMatch(/Visual style:/);
    expect(minimal.text).not.toMatch(/Read-aloud length:/);
    // Age is a special case: `formatAgeRange(undefined, undefined)` returns the
    // honest string "Age not specified" rather than omitting the line entirely —
    // still never a fabricated confirmed-looking value.
    expect(minimal.text).toContain("Age: Age not specified");
    expect(minimal.text).not.toMatch(/undefined|null|NaN/);
  });

  it("includes both primary and additional language names", () => {
    const multilingual = buildEmbeddingDocument({ ...baseInput, additionalLanguageCodes: ["sv", "de"] });
    expect(multilingual.text).toMatch(/Languages: English, Swedish, German/);
  });
});

describe("buildSearchIndexText — the label-free text Postgres full-text-indexes", () => {
  it("never contains the generic structural label words that would otherwise collide with real content", () => {
    const text = buildSearchIndexText(baseInput);
    // Regression test for a real bug: the label "Read-aloud length:" put the literal
    // word "Read" into every book's document, so any query containing "read" matched
    // the entire seeded catalog. The label-free index text must not reintroduce this.
    expect(text).not.toMatch(/\bRead-aloud\b/);
    expect(text).not.toMatch(/^Title:/m);
    expect(text).not.toMatch(/^Type:/m);
    expect(text).not.toMatch(/^Format:/m);
  });

  it("still contains every real content value", () => {
    const text = buildSearchIndexText(baseInput);
    expect(text).toContain("The Very Hungry Caterpillar");
    expect(text).toContain("Eric Carle");
    expect(text).toContain("Philomel Books");
    expect(text).toContain("Animals & Nature");
    expect(text).toContain("caterpillars");
    expect(text).toContain("A very hungry caterpillar eats its way through a week of food.");
  });

  it("omits a field entirely when it is undefined, never a placeholder value", () => {
    const minimal = buildSearchIndexText({
      title: "Book With Incomplete Metadata",
      authors: [],
      tags: [],
      languageCode: "en",
      illustrationStyles: [],
    });
    expect(minimal).not.toMatch(/undefined|null|NaN/);
  });

  it("is deterministic across two calls with the same input", () => {
    expect(buildSearchIndexText(baseInput)).toBe(buildSearchIndexText({ ...baseInput }));
  });
});
