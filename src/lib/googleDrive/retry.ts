/**
 * Bounded retry-with-backoff for Drive/OAuth REST calls (Phase 6). Deliberately separate
 * from `embeddings/geminiProvider.ts`'s own retry helper — that one is scoped to Gemini's
 * two retryable codes (429/503) with a short fixed delay tuned for a live search request
 * that must still degrade quickly; Drive operations (uploads, listings, token refresh) are
 * not on a teacher-facing request's critical path in the same way, so a slightly longer,
 * jittered exponential backoff is more appropriate here. Two similar-but-distinct retry
 * helpers is the right call, not a shared one forced to serve both call sites' different
 * timing needs.
 */

/** 429 (rate limit), 500/502/503/504 (transient server-side failure) — never a client
 * error (400/401/403/404), which retrying can never fix. */
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 8000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Honors a numeric `Retry-After` (seconds) when Google sends one; otherwise exponential
 * backoff (`BASE_DELAY_MS * 2^attempt`, capped at `MAX_DELAY_MS`) with up to 30% jitter so
 * concurrent callers don't all retry in lockstep. */
function computeDelayMs(response: Response, attempt: number): number {
  const retryAfterHeader = Number(response.headers.get("Retry-After"));
  if (Number.isFinite(retryAfterHeader) && retryAfterHeader > 0) {
    return retryAfterHeader * 1000;
  }
  const exponential = Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS);
  const jitter = exponential * 0.3 * Math.random();
  return exponential + jitter;
}

/**
 * A network-level failure (DNS, connection reset, timeout) is treated the same as a
 * transient server error — retried up to `MAX_RETRIES` times, then rethrown. A malformed
 * request or an auth/permission error never reaches this function's retry loop at all: it
 * always returns a real `Response`, and the caller's own status-code handling (never this
 * module) decides whether 400/401/403/404 should fail immediately.
 */
export async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, init);
    } catch (error) {
      lastError = error;
      if (attempt === MAX_RETRIES) throw error;
      await sleep(Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS));
      continue;
    }
    if (response.ok || !RETRYABLE_STATUS_CODES.has(response.status) || attempt === MAX_RETRIES) {
      return response;
    }
    const delayMs = computeDelayMs(response, attempt);
    await sleep(delayMs);
  }
  // Unreachable — the loop above always returns or throws by the final attempt.
  throw lastError ?? new Error("fetchWithRetry: exhausted retries with no response or error");
}
