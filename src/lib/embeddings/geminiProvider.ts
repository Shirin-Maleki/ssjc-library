import {
  EmbeddingProviderConfigError,
  EmbeddingProviderRequestError,
  EmbeddingProviderUnavailableError,
  type EmbeddingProvider,
} from "./provider";
import { EMBEDDING_DIMENSIONS } from "@/db/schema/books";

const MODEL_ID = "gemini-embedding-2";
const API_BASE = "https://generativelanguage.googleapis.com/v1beta";

/**
 * Asymmetric retrieval input contract (Phase 5 correction pass) — a document
 * embedded for indexing and a query embedded to search against it are not
 * interchangeable inputs: Google's own guidance for retrieval is to format each
 * side differently so the model produces embeddings actually optimized for its
 * role, rather than sending the same unlabeled text through both paths (which is
 * what this adapter did before this pass — `embedQuery` and `embedDocuments` both
 * called the same unlabeled `embedOne`/batch logic).
 *
 * `gemini-embedding-001` (the API's previous generation) exposes this as a
 * discrete `task_type` request field (`RETRIEVAL_DOCUMENT` / `RETRIEVAL_QUERY`).
 * `gemini-embedding-2` — the model this adapter targets — does not accept that
 * field at all; its documented mechanism is a plain-text instruction prefix
 * embedded directly in the content sent to the model:
 *   - a document being indexed: `"title: {title} | text: {content}"` (Google's own
 *     guidance: use `"title: none"` when no separate title exists — which is the
 *     case here, since `buildEmbeddingDocument()`'s output already opens with its
 *     own "Title: …" line as part of the composed text itself).
 *   - a search query: `"task: search result | query: {content}"`.
 * Sourced from ai.google.dev/gemini-api/docs/embeddings and Google's own
 * "Gemini Embedding 2" model announcement (September 2026) — **not independently
 * verified against a live call**, since no `GEMINI_API_KEY` exists in this
 * environment; re-confirm against Google's current documentation before relying on
 * this in a real deployment, and never claim a semantic-quality improvement from
 * this change without real-provider testing (docs/SEARCH.md §5).
 */
function toDocumentInput(text: string): string {
  return `title: none | text: ${text}`;
}
function toQueryInput(text: string): string {
  return `task: search result | query: ${text}`;
}
/** Short and documented (docs/SEARCH.md §5) — a teacher's search must never hang
 * waiting on an external network call; a slow/unresponsive provider degrades to
 * conventional retrieval exactly like a missing key does. */
const REQUEST_TIMEOUT_MS = 3000;
/** The Gemini batch endpoint's own per-request item cap. */
const BATCH_SIZE = 100;

interface EmbedContentResponse {
  embedding?: { values?: number[] };
}
interface BatchEmbedContentsResponse {
  embeddings?: { values?: number[] }[];
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new EmbeddingProviderRequestError(`request timed out after ${REQUEST_TIMEOUT_MS}ms`, error);
    }
    throw new EmbeddingProviderRequestError("network error", error);
  } finally {
    clearTimeout(timer);
  }
}

/** A real, measured finding from live-provider validation testing (2026-09-17), not
 * a speculative addition: rapid successive calls against this key/tier produced a
 * real `HTTP 429` from `batchEmbedContents`, and the adapter previously had no
 * retry at all — a single rate-limit response permanently failed that entire batch
 * of books. `MAX_RETRIES = 2` keeps this bounded (never an unbounded retry loop);
 * respects a numeric `Retry-After` header (seconds) when Google sends one,
 * otherwise a short fixed backoff — long enough to clear a brief rate-limit window,
 * short enough that a live teacher-facing `embedQuery` call (which shares this same
 * retry path) still degrades to conventional-only within a few seconds rather than
 * visibly hanging. Only retries 429 (rate limit) and 503 (transient overload) —
 * every other error (400, 401, 403, …) fails immediately, since retrying a
 * malformed request or a bad key can never succeed. */
const MAX_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 1500;
const RETRYABLE_STATUS_CODES = new Set([429, 503]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  let lastResponse: Response | undefined;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const response = await fetchWithTimeout(url, init);
    if (response.ok || !RETRYABLE_STATUS_CODES.has(response.status) || attempt === MAX_RETRIES) {
      return response;
    }
    lastResponse = response;
    const retryAfterHeader = Number(response.headers.get("Retry-After"));
    const delayMs = Number.isFinite(retryAfterHeader) && retryAfterHeader > 0 ? retryAfterHeader * 1000 : DEFAULT_RETRY_DELAY_MS;
    await sleep(delayMs);
  }
  // Unreachable in practice (the loop always returns by the final attempt), but
  // keeps the function's return type honest without a non-null assertion.
  return lastResponse!;
}

/**
 * Production embedding adapter — Google's Gemini embedding API
 * (`gemini-embedding-2`, 768-dimension output), behind the same
 * `EmbeddingProvider` interface `FakeEmbeddingProvider` (tests) implements. Never
 * imported by anything that isn't explicitly building a real provider instance —
 * see `src/lib/embeddings/index.ts` for the one place that decides which
 * implementation to construct, based on whether `GEMINI_API_KEY` is actually set.
 *
 * Requires the key never to reach the browser: this module is only ever imported
 * from server-only code (the embedding-generation script, and `SearchService`'s
 * server-side query-embedding step) — never from a Client Component.
 */
export class GeminiEmbeddingProvider implements EmbeddingProvider {
  readonly modelId = MODEL_ID;
  readonly dimensions = EMBEDDING_DIMENSIONS;

  constructor(private readonly apiKey: string) {
    if (!apiKey) {
      throw new EmbeddingProviderUnavailableError("GEMINI_API_KEY is not set");
    }
  }

  private async embedOne(text: string): Promise<number[]> {
    const url = `${API_BASE}/models/${MODEL_ID}:embedContent?key=${this.apiKey}`;
    const response = await fetchWithRetry(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: `models/${MODEL_ID}`,
        content: { parts: [{ text }] },
        outputDimensionality: EMBEDDING_DIMENSIONS,
      }),
    });
    if (!response.ok) {
      throw new EmbeddingProviderRequestError(`HTTP ${response.status} from Gemini embedContent`);
    }
    const body = (await response.json()) as EmbedContentResponse;
    const values = body.embedding?.values;
    if (!values || values.length !== EMBEDDING_DIMENSIONS) {
      throw new EmbeddingProviderConfigError(
        `expected a ${EMBEDDING_DIMENSIONS}-dimension embedding, got ${values?.length ?? "none"}`
      );
    }
    return values;
  }

  async embedQuery(text: string): Promise<number[]> {
    return this.embedOne(toQueryInput(text));
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];
    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE);
      const url = `${API_BASE}/models/${MODEL_ID}:batchEmbedContents?key=${this.apiKey}`;
      const response = await fetchWithRetry(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requests: batch.map((text) => ({
            model: `models/${MODEL_ID}`,
            content: { parts: [{ text: toDocumentInput(text) }] },
            outputDimensionality: EMBEDDING_DIMENSIONS,
          })),
        }),
      });
      if (!response.ok) {
        throw new EmbeddingProviderRequestError(`HTTP ${response.status} from Gemini batchEmbedContents`);
      }
      const body = (await response.json()) as BatchEmbedContentsResponse;
      const embeddings = body.embeddings ?? [];
      if (embeddings.length !== batch.length) {
        throw new EmbeddingProviderConfigError(`expected ${batch.length} embeddings, got ${embeddings.length}`);
      }
      for (const item of embeddings) {
        if (!item.values || item.values.length !== EMBEDDING_DIMENSIONS) {
          throw new EmbeddingProviderConfigError(
            `expected a ${EMBEDDING_DIMENSIONS}-dimension embedding, got ${item.values?.length ?? "none"}`
          );
        }
        results.push(item.values);
      }
    }
    return results;
  }
}
