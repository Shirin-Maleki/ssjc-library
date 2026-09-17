/**
 * The seam between search/embedding-generation code and any specific embedding
 * vendor (Phase 5, `docs/SEARCH.md` §5 / `docs/DECISIONS.md`) — nothing outside this
 * file and its concrete implementations (`geminiProvider.ts`, `fakeProvider.ts`)
 * knows which vendor SDK, if any, is in use. Swapping to a different 768-dimension
 * provider later means writing one new class implementing this interface; nothing
 * else changes.
 */
export interface EmbeddingProvider {
  /** A short, stable identifier stored alongside every embedding
   * (`books.embedding_model`) — e.g. `"gemini-embedding-2"`, `"fake-test-provider"`. */
  readonly modelId: string;
  /** The fixed output width this provider produces — must equal
   * `EMBEDDING_DIMENSIONS` (`src/db/schema/books.ts`) for every real production
   * provider; enforced at construction, not silently truncated/padded. */
  readonly dimensions: number;

  /** Embeds catalog document text (the deterministic output of
   * `src/lib/embeddings/document.ts`) — batched where the provider supports it. */
  embedDocuments(texts: string[]): Promise<number[][]>;

  /** Embeds a single teacher search query — kept separate from `embedDocuments`
   * because some real providers use a different task type/instruction for queries
   * vs. documents, even at the same output dimension. */
  embedQuery(text: string): Promise<number[]>;
}

/** Thrown when no provider is configured at all (e.g. no `GEMINI_API_KEY`) — the
 * caller's job is to catch this specific case and continue with conventional
 * retrieval only, never to fail the teacher's search (docs/SEARCH.md §5). */
export class EmbeddingProviderUnavailableError extends Error {
  constructor(reason: string) {
    super(`Embedding provider unavailable: ${reason}`);
    this.name = "EmbeddingProviderUnavailableError";
  }
}

/** A configuration problem distinct from a transient provider failure — e.g. an
 * API key present but rejected, or a provider returning the wrong dimension. */
export class EmbeddingProviderConfigError extends Error {
  constructor(reason: string) {
    super(`Embedding provider misconfigured: ${reason}`);
    this.name = "EmbeddingProviderConfigError";
  }
}

/** A real request to the provider failed (network, rate limit, 5xx, timeout) — the
 * caller degrades to conventional retrieval exactly as it would for "unavailable";
 * kept as a distinct type only so logs/tests can tell "never configured" apart from
 * "configured, but this one call failed". */
export class EmbeddingProviderRequestError extends Error {
  constructor(reason: string, readonly cause?: unknown) {
    super(`Embedding provider request failed: ${reason}`);
    this.name = "EmbeddingProviderRequestError";
  }
}
