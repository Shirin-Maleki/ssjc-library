import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withGeminiRetry } from "@/lib/ai/retry";

function apiError(status: number): Error & { status: number } {
  const error = new Error(`HTTP ${status}`) as Error & { status: number };
  error.status = status;
  return error;
}

/** The real backoff sleeps 1-6+ real seconds per retry — fake timers keep this file
 * fast without changing the retry logic itself. */
async function runWithFakeTimers<T>(action: () => Promise<T>): Promise<T> {
  const promise = action();
  // Attach a no-op handler immediately so Node doesn't flag this as an unhandled
  // rejection while `vi.runAllTimersAsync()` is still pending below — the real
  // rejection is still observed by whoever awaits the returned promise.
  promise.catch(() => {});
  await vi.runAllTimersAsync();
  return promise;
}

describe("ai/retry — withGeminiRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the result immediately on first-try success", async () => {
    const action = vi.fn().mockResolvedValue("ok");
    const result = await runWithFakeTimers(() => withGeminiRetry(action));
    expect(result).toBe("ok");
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("retries on a real observed 503 and succeeds on the next attempt", async () => {
    const action = vi.fn().mockRejectedValueOnce(apiError(503)).mockResolvedValueOnce("recovered");
    const result = await runWithFakeTimers(() => withGeminiRetry(action));
    expect(result).toBe("recovered");
    expect(action).toHaveBeenCalledTimes(2);
  });

  it("retries on 429 (rate limited)", async () => {
    const action = vi.fn().mockRejectedValueOnce(apiError(429)).mockResolvedValueOnce("ok");
    const result = await runWithFakeTimers(() => withGeminiRetry(action));
    expect(result).toBe("ok");
    expect(action).toHaveBeenCalledTimes(2);
  });

  it("gives up after MAX_RETRIES and throws the last error", async () => {
    const action = vi.fn().mockRejectedValue(apiError(503));
    await expect(runWithFakeTimers(() => withGeminiRetry(action))).rejects.toThrow("HTTP 503");
    // 1 initial attempt + 2 retries = 3 total calls.
    expect(action).toHaveBeenCalledTimes(3);
  });

  it("never retries a non-retryable status (e.g. 400 — a genuine bad request)", async () => {
    const action = vi.fn().mockRejectedValue(apiError(400));
    await expect(runWithFakeTimers(() => withGeminiRetry(action))).rejects.toThrow("HTTP 400");
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("never retries an error with no status at all (e.g. a schema-validation error a caller throws)", async () => {
    const action = vi.fn().mockRejectedValue(new Error("not valid JSON"));
    await expect(runWithFakeTimers(() => withGeminiRetry(action))).rejects.toThrow("not valid JSON");
    expect(action).toHaveBeenCalledTimes(1);
  });
});
