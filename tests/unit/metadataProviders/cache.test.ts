import { describe, expect, it } from "vitest";
import { buildCacheKey } from "@/lib/metadataProviders/cache";

describe("metadataProviders/cache — buildCacheKey", () => {
  it("builds an ISBN-based key, normalizing punctuation and case", () => {
    expect(buildCacheKey({ isbn: "978-0-14-036621-7" })).toBe("isbn:9780140366217");
    expect(buildCacheKey({ isbn: "014036621x" })).toBe("isbn:014036621X");
  });

  it("prefers the ISBN key even when title/author are also present", () => {
    const key = buildCacheKey({ isbn: "9780140366217", title: "The Gruffalo", authors: ["Julia Donaldson"] });
    expect(key).toBe("isbn:9780140366217");
  });

  it("builds a distinct title+author+language key when there is no ISBN", () => {
    const key = buildCacheKey({ title: "The Gruffalo", authors: ["Julia Donaldson"], language: "en" });
    expect(key).toBe("title_author_lang:the gruffalo|julia donaldson|en");
  });

  it("produces genuinely different keys for ISBN vs title+author searches of the same real book", () => {
    const isbnKey = buildCacheKey({ isbn: "9780140366217" });
    const titleKey = buildCacheKey({ title: "The Gruffalo", authors: ["Julia Donaldson"] });
    expect(isbnKey).not.toBe(titleKey);
  });

  it("sorts multiple authors so key order doesn't depend on input order", () => {
    const a = buildCacheKey({ title: "X", authors: ["Beta Author", "Alpha Author"] });
    const b = buildCacheKey({ title: "X", authors: ["Alpha Author", "Beta Author"] });
    expect(a).toBe(b);
  });

  it("produces a stable key even with no title/author/language at all", () => {
    expect(buildCacheKey({})).toBe("title_author_lang:||");
  });
});
