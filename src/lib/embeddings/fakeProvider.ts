import { createHash } from "node:crypto";
import { EMBEDDING_DIMENSIONS } from "@/db/schema/books";
import type { EmbeddingProvider } from "./provider";

/**
 * A deterministic, dependency-free stand-in for a real embedding provider — used
 * only by automated tests, never by development/production search
 * (`docs/SEARCH.md` §5: "do not use fake embeddings in results unless an
 * unmistakable test-only mode is explicitly enabled"). The only place this class is
 * ever constructed is test setup code; `src/lib/embeddings/index.ts` (the real
 * provider-selection point the app actually uses) never references it.
 *
 * Same input text always produces the same vector (SHA-256 of the text, expanded
 * deterministically to fill 768 dimensions, L2-normalized) — good enough to
 * exercise storage, retrieval, distance ordering, and staleness detection without
 * a network call or an API key, but carries no real semantic meaning whatsoever.
 * Real semantic-quality evaluation requires the real Gemini provider — see
 * `docs/SEARCH.md` §11.
 */
export class FakeEmbeddingProvider implements EmbeddingProvider {
  readonly modelId = "fake-test-provider";
  readonly dimensions = EMBEDDING_DIMENSIONS;

  private vectorFor(text: string): number[] {
    const values: number[] = [];
    let seed = text;
    while (values.length < this.dimensions) {
      const digest = createHash("sha256").update(seed).digest();
      for (let i = 0; i < digest.length && values.length < this.dimensions; i += 1) {
        // Centered around 0, roughly [-1, 1].
        values.push(digest[i] / 127.5 - 1);
      }
      seed = seed + "#";
    }
    const norm = Math.sqrt(values.reduce((sum, v) => sum + v * v, 0)) || 1;
    return values.map((v) => v / norm);
  }

  async embedQuery(text: string): Promise<number[]> {
    return this.vectorFor(text);
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    return texts.map((text) => this.vectorFor(text));
  }
}
