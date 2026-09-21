import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GoogleBooksMetadataProvider } from "@/lib/metadataProviders/googleBooksProvider";
import { MetadataProviderError } from "@/lib/metadataProviders/provider";

describe("metadataProviders/googleBooksProvider", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });
  afterEach(() => {
    global.fetch = originalFetch;
    vi.useRealTimers();
  });

  it("throws configuration_missing when constructed without an API key", () => {
    expect(() => new GoogleBooksMetadataProvider("")).toThrow(MetadataProviderError);
  });

  it("returns an empty array without calling fetch when the query has no usable signal", async () => {
    const provider = new GoogleBooksMetadataProvider("fake-key");
    const result = await provider.search({});
    expect(result).toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("prefers an ISBN query over title/author when both are present", async () => {
    vi.mocked(global.fetch).mockResolvedValue(new Response(JSON.stringify({ items: [] }), { status: 200 }));
    const provider = new GoogleBooksMetadataProvider("fake-key");
    await provider.search({ isbn: "9780140366217", title: "The Gruffalo", authors: ["Julia Donaldson"] });
    const url = vi.mocked(global.fetch).mock.calls[0][0] as string;
    expect(url).toContain("q=isbn%3A9780140366217");
    expect(url).not.toContain("intitle");
  });

  it("normalizes a real-shaped volume result, including split ISBN-10/ISBN-13 identifiers", async () => {
    const body = {
      items: [
        {
          id: "vol-1",
          volumeInfo: {
            title: "The Gruffalo",
            subtitle: "A modern classic",
            authors: ["Julia Donaldson"],
            publisher: "Macmillan",
            publishedDate: "1999",
            language: "en",
            pageCount: 32,
            description: "A mouse takes a walk in the woods.",
            categories: ["Juvenile Fiction"],
            industryIdentifiers: [
              { type: "ISBN_10", identifier: "0333710935" },
              { type: "ISBN_13", identifier: "9780333710937" },
            ],
            imageLinks: { thumbnail: "https://books.example/thumb.jpg" },
          },
        },
      ],
    };
    vi.mocked(global.fetch).mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
    const provider = new GoogleBooksMetadataProvider("fake-key");
    const [result] = await provider.search({ title: "The Gruffalo" });

    expect(result).toMatchObject({
      provider: "google_books",
      providerIdentifier: "vol-1",
      title: "The Gruffalo",
      isbn10: "0333710935",
      isbn13: "9780333710937",
      thumbnailUrl: "https://books.example/thumb.jpg",
    });
  });

  it("returns an empty array when the response has no items, never a fabricated candidate", async () => {
    vi.mocked(global.fetch).mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));
    const provider = new GoogleBooksMetadataProvider("fake-key");
    const result = await provider.search({ title: "Something Obscure" });
    expect(result).toEqual([]);
  });

  it("maps a genuine 403 to unexpected_provider_failure, never silently swallowed", async () => {
    vi.mocked(global.fetch).mockResolvedValue(new Response("forbidden", { status: 403 }));
    const provider = new GoogleBooksMetadataProvider("fake-key");
    await expect(provider.search({ title: "x" })).rejects.toMatchObject({ category: "unexpected_provider_failure" });
  });

  it("maps malformed JSON to invalid_response", async () => {
    vi.mocked(global.fetch).mockResolvedValue(new Response("not json", { status: 200 }));
    const provider = new GoogleBooksMetadataProvider("fake-key");
    await expect(provider.search({ title: "x" })).rejects.toMatchObject({ category: "invalid_response" });
  });

  it("maps a request abort/timeout to the timeout category", async () => {
    vi.useFakeTimers();
    vi.mocked(global.fetch).mockImplementation(() => {
      const error = new Error("aborted");
      error.name = "AbortError";
      return Promise.reject(error);
    });
    const provider = new GoogleBooksMetadataProvider("fake-key");
    const promise = provider.search({ title: "x" });
    promise.catch(() => {});
    await vi.runAllTimersAsync();
    await expect(promise).rejects.toMatchObject({ category: "timeout" });
  });
});
