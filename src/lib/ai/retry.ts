/**
 * Bounded retry-with-backoff for Gemini SDK calls (Phase 7). A third, deliberately
 * separate retry helper alongside `src/lib/embeddings/geminiProvider.ts`'s own
 * (tuned for a live search request that must degrade fast) and
 * `src/lib/googleDrive/retry.ts`'s (tuned for upload/listing operations) — this one
 * wraps an `@google/genai` SDK call directly (catching the SDK's own thrown
 * `ApiError`, which carries a `.status` field) rather than a raw `fetch`, since the
 * SDK owns the HTTP layer here and doesn't expose a way to inject a custom fetch
 * wrapper.
 *
 * **Real, tested finding (2026-09-20)**: live calls against `gemini-3.8-flash`'s
 * structured-output path reproducibly returned `HTTP 503` ("This model is currently
 * experiencing high demand") on the first attempt several times during
 * implementation, succeeding on an immediate retry every time — not a hypothetical
 * concern. Plain (non-structured-output) calls succeeded reliably on the first try
 * in the same session, suggesting the schema-constrained-decoding code path has its
 * own, more constrained capacity — retry-with-backoff is the correct response to a
 * transient capacity issue like this, not a change to the request itself.
 */
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
const MAX_RETRIES = 2;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 6000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function statusOf(error: unknown): number | undefined {
  if (error && typeof error === "object" && "status" in error) {
    const status = (error as { status: unknown }).status;
    return typeof status === "number" ? status : undefined;
  }
  return undefined;
}

/** Runs `action`, retrying up to `MAX_RETRIES` times (3 attempts total) on a
 * retryable status code, with exponential backoff and jitter. A non-retryable
 * error (a genuine `400`, an auth failure, a schema-validation failure a caller
 * throws itself) propagates immediately on the first attempt. */
export async function withGeminiRetry<T>(action: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await action();
    } catch (error) {
      lastError = error;
      const status = statusOf(error);
      if (!status || !RETRYABLE_STATUS_CODES.has(status) || attempt === MAX_RETRIES) {
        throw error;
      }
      const delay = Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS) + Math.random() * 300;
      await sleep(delay);
    }
  }
  throw lastError;
}
