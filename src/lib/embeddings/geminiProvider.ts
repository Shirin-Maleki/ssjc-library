import {
  EmbeddingProviderConfigError,
  EmbeddingProviderRequestError,
  EmbeddingProviderUnavailableError,
  type EmbeddingProvider,
} from "./provider";
import { EMBEDDING_DIMENSIONS } from "@/db/schema/books";

const MODEL_ID = "gemini-embedding-2";
const API_BASE = "https://generativelanguage.googleapis.com/v1beta";
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
    const response = await fetchWithTimeout(url, {
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
    return this.embedOne(text);
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];
    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE);
      const url = `${API_BASE}/models/${MODEL_ID}:batchEmbedContents?key=${this.apiKey}`;
      const response = await fetchWithTimeout(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requests: batch.map((text) => ({
            model: `models/${MODEL_ID}`,
            content: { parts: [{ text }] },
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
