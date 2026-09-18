import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchWithRetry } from "@/lib/googleDrive/retry";

function jsonResponse(status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({}), { status, headers });
}

describe("googleDrive/retry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("returns immediately on a successful first response, no retry", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(200));
    const response = await fetchWithRetry("https://example.test", {});
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries a 429 then succeeds", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(429))
      .mockResolvedValueOnce(jsonResponse(200));

    const promise = fetchWithRetry("https://example.test", {});
    await vi.runAllTimersAsync();
    const response = await promise;

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries a transient 503 then succeeds", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(503))
      .mockResolvedValueOnce(jsonResponse(200));

    const promise = fetchWithRetry("https://example.test", {});
    await vi.runAllTimersAsync();
    await promise;

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("honors a numeric Retry-After header", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(429, { "Retry-After": "2" }))
      .mockResolvedValueOnce(jsonResponse(200));

    const promise = fetchWithRetry("https://example.test", {});
    // Before 2000ms, the second call must not have happened yet.
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1500);
    await promise;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after the bounded maximum retry count and returns the last real response", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(503));

    const promise = fetchWithRetry("https://example.test", {});
    await vi.runAllTimersAsync();
    const response = await promise;

    expect(response.status).toBe(503);
    // 1 initial attempt + 3 retries = 4 total calls.
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("never retries a permanent client error (400)", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(400));
    const response = await fetchWithRetry("https://example.test", {});
    expect(response.status).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never retries an auth error (401) or permission error (403)", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse(401)).mockResolvedValueOnce(jsonResponse(403));
    await fetchWithRetry("https://example.test", {});
    await fetchWithRetry("https://example.test", {});
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("never retries a 404", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(404));
    await fetchWithRetry("https://example.test", {});
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries a network-level failure, then succeeds", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new TypeError("network error"))
      .mockResolvedValueOnce(jsonResponse(200));

    const promise = fetchWithRetry("https://example.test", {});
    await vi.runAllTimersAsync();
    const response = await promise;

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rethrows a network-level failure after exhausting retries", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("persistent network error"));
    const promise = fetchWithRetry("https://example.test", {});
    const expectation = expect(promise).rejects.toThrow("persistent network error");
    await vi.runAllTimersAsync();
    await expectation;
  });
});
