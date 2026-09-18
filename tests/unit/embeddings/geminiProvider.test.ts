import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GeminiEmbeddingProvider } from "@/lib/embeddings/geminiProvider";
import { EMBEDDING_DIMENSIONS } from "@/db/schema/books";

function fakeEmbedContentResponse() {
  return { embedding: { values: Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.01) } };
}
function fakeBatchResponse(count: number) {
  return { embeddings: Array.from({ length: count }, () => ({ values: Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.01) })) };
}

/**
 * Phase 5 correction pass — proves the asymmetric retrieval input contract
 * actually reaches the network request, not just that it exists as a helper
 * function somewhere. No real network call is made (fetch is mocked); this cannot
 * prove real semantic-quality improvement — only that the documented
 * document/query formatting distinction is genuinely applied. See
 * `geminiProvider.ts`'s own comment for where this contract was sourced from and
 * its explicit "not independently verified against a live call" caveat.
 */
describe("GeminiEmbeddingProvider — asymmetric retrieval input contract", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("embedQuery wraps the input as a retrieval query, not the raw text", async () => {
    const fetchMock = vi.mocked(global.fetch);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(fakeEmbedContentResponse()), { status: 200 }));

    const provider = new GeminiEmbeddingProvider("fake-key");
    await provider.embedQuery("caterpillar");

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init!.body as string);
    expect(body.content.parts[0].text).toBe("task: search result | query: caterpillar");
  });

  it("embedDocuments wraps each input as a retrieval document, not the raw text", async () => {
    const fetchMock = vi.mocked(global.fetch);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(fakeBatchResponse(2)), { status: 200 }));

    const provider = new GeminiEmbeddingProvider("fake-key");
    await provider.embedDocuments(["Title: The Very Hungry Caterpillar", "Title: The Gruffalo"]);

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init!.body as string);
    expect(body.requests[0].content.parts[0].text).toBe("title: none | text: Title: The Very Hungry Caterpillar");
    expect(body.requests[1].content.parts[0].text).toBe("title: none | text: Title: The Gruffalo");
  });

  it("a document and a query built from the identical underlying text are sent as genuinely different inputs", async () => {
    const fetchMock = vi.mocked(global.fetch);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(fakeEmbedContentResponse()), { status: 200 }));
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(fakeBatchResponse(1)), { status: 200 }));

    const provider = new GeminiEmbeddingProvider("fake-key");
    const sharedText = "dinosaurs";
    await provider.embedQuery(sharedText);
    await provider.embedDocuments([sharedText]);

    const queryBody = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
    const documentBody = JSON.parse(fetchMock.mock.calls[1][1]!.body as string);
    expect(queryBody.content.parts[0].text).not.toBe(documentBody.requests[0].content.parts[0].text);
  });
});

/**
 * Real-provider validation finding (2026-09-17): rapid successive calls in live
 * testing produced a genuine `HTTP 429` from Gemini's `batchEmbedContents`, and the
 * adapter had no retry at all — a single rate-limit response permanently failed an
 * entire batch. These tests use fake timers so the retry backoff never actually
 * delays the test suite.
 */
describe("GeminiEmbeddingProvider — retry on rate limit / transient overload", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
    vi.useFakeTimers();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.useRealTimers();
  });

  it("retries once after an HTTP 429 and succeeds on the second attempt", async () => {
    const fetchMock = vi.mocked(global.fetch);
    fetchMock
      .mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(fakeEmbedContentResponse()), { status: 200 }));

    const provider = new GeminiEmbeddingProvider("fake-key");
    const resultPromise = provider.embedQuery("caterpillar");
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("respects a numeric Retry-After header instead of the default backoff", async () => {
    const fetchMock = vi.mocked(global.fetch);
    fetchMock
      .mockResolvedValueOnce(new Response("rate limited", { status: 429, headers: { "Retry-After": "5" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify(fakeEmbedContentResponse()), { status: 200 }));

    const provider = new GeminiEmbeddingProvider("fake-key");
    const resultPromise = provider.embedQuery("caterpillar");
    await vi.advanceTimersByTimeAsync(4999);
    expect(fetchMock).toHaveBeenCalledTimes(1); // hasn't retried yet — still waiting out Retry-After
    await vi.advanceTimersByTimeAsync(2);
    await resultPromise;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after MAX_RETRIES and surfaces the real HTTP error", async () => {
    const fetchMock = vi.mocked(global.fetch);
    fetchMock.mockResolvedValue(new Response("rate limited", { status: 429 }));

    const provider = new GeminiEmbeddingProvider("fake-key");
    const resultPromise = provider.embedQuery("caterpillar").catch((e) => e);
    await vi.runAllTimersAsync();
    const error = await resultPromise;

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("HTTP 429");
    // 1 initial attempt + MAX_RETRIES (2) retries = 3 total calls, never unbounded.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("never retries a non-retryable error (e.g. 400 bad request)", async () => {
    const fetchMock = vi.mocked(global.fetch);
    fetchMock.mockResolvedValueOnce(new Response("bad request", { status: 400 }));

    const provider = new GeminiEmbeddingProvider("fake-key");
    await expect(provider.embedQuery("caterpillar")).rejects.toThrow("HTTP 400");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
