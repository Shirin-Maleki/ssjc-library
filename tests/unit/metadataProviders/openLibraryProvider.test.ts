import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenLibraryMetadataProvider } from "@/lib/metadataProviders/openLibraryProvider";

describe("metadataProviders/openLibraryProvider", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });
  afterEach(() => {
    global.fetch = originalFetch;
    vi.useRealTimers();
  });

  it("returns an empty array without calling fetch when the query has no usable signal", async () => {
    const provider = new OpenLibraryMetadataProvider();
    const result = await provider.search({});
    expect(result).toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("sends a descriptive User-Agent header, per Open Library's own guidance", async () => {
    vi.mocked(global.fetch).mockResolvedValue(new Response(JSON.stringify({ docs: [] }), { status: 200 }));
    const provider = new OpenLibraryMetadataProvider();
    await provider.search({ title: "The Gruffalo" });
    const [, init] = vi.mocked(global.fetch).mock.calls[0];
    const headers = new Headers((init as RequestInit).headers);
    expect(headers.get("User-Agent")).toMatch(/SSJC-Library-Intake/);
  });

  it("uses the current Search API (/search.json), never the legacy /api/books endpoint", async () => {
    vi.mocked(global.fetch).mockResolvedValue(new Response(JSON.stringify({ docs: [] }), { status: 200 }));
    const provider = new OpenLibraryMetadataProvider();
    await provider.search({ title: "The Gruffalo" });
    const url = vi.mocked(global.fetch).mock.calls[0][0] as string;
    expect(url).toContain("openlibrary.org/search.json");
    expect(url).not.toContain("/api/books");
  });

  it("normalizes a real-shaped doc result, passing the MARC language code through unchanged", async () => {
    const body = {
      docs: [
        {
          key: "/works/OL123W",
          title: "The Gruffalo",
          author_name: ["Julia Donaldson"],
          first_publish_year: 1999,
          isbn: ["0333710935", "9780333710937"],
          publisher: ["Macmillan"],
          language: ["eng"],
          subject: ["Juvenile Fiction"],
          cover_i: 12345,
        },
      ],
    };
    vi.mocked(global.fetch).mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
    const provider = new OpenLibraryMetadataProvider();
    const [result] = await provider.search({ title: "The Gruffalo" });

    expect(result).toMatchObject({
      provider: "open_library",
      providerIdentifier: "/works/OL123W",
      title: "The Gruffalo",
      isbn10: "0333710935",
      isbn13: "9780333710937",
      language: "eng", // not reconciled to ISO 639-1 here — reconciliation.ts's job
      thumbnailUrl: "https://covers.openlibrary.org/b/id/12345-M.jpg",
    });
  });

  it("returns an empty array when there is no cover id, never a fabricated placeholder URL", async () => {
    const body = { docs: [{ key: "/works/OL1W", title: "No Cover Book" }] };
    vi.mocked(global.fetch).mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
    const provider = new OpenLibraryMetadataProvider();
    const [result] = await provider.search({ title: "No Cover Book" });
    expect(result.thumbnailUrl).toBeUndefined();
  });

  it("maps a genuine 404 to unexpected_provider_failure", async () => {
    vi.mocked(global.fetch).mockResolvedValue(new Response("not found", { status: 404 }));
    const provider = new OpenLibraryMetadataProvider();
    await expect(provider.search({ title: "x" })).rejects.toMatchObject({ category: "unexpected_provider_failure" });
  });

  it("maps malformed JSON to invalid_response", async () => {
    vi.mocked(global.fetch).mockResolvedValue(new Response("not json", { status: 200 }));
    const provider = new OpenLibraryMetadataProvider();
    await expect(provider.search({ title: "x" })).rejects.toMatchObject({ category: "invalid_response" });
  });

  it("maps a genuine 503 to transient_provider_failure after internal retries exhaust", async () => {
    vi.useFakeTimers();
    vi.mocked(global.fetch).mockResolvedValue(new Response("unavailable", { status: 503 }));
    const provider = new OpenLibraryMetadataProvider();
    const promise = provider.search({ title: "x" });
    promise.catch(() => {});
    await vi.runAllTimersAsync();
    await expect(promise).rejects.toMatchObject({ category: "transient_provider_failure" });
  });
});
