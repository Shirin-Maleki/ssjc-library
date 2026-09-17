import { describe, expect, it } from "vitest";
import { FakeEmbeddingProvider } from "@/lib/embeddings/fakeProvider";
import { EMBEDDING_DIMENSIONS } from "@/db/schema/books";

describe("FakeEmbeddingProvider — test-only deterministic provider", () => {
  const provider = new FakeEmbeddingProvider();

  it("produces a vector of the contract dimensionality", async () => {
    const vector = await provider.embedQuery("dinosaurs");
    expect(vector).toHaveLength(EMBEDDING_DIMENSIONS);
  });

  it("is deterministic — the same text always produces the same vector", async () => {
    const a = await provider.embedQuery("The Very Hungry Caterpillar");
    const b = await provider.embedQuery("The Very Hungry Caterpillar");
    expect(a).toEqual(b);
  });

  it("produces a different vector for different text", async () => {
    const a = await provider.embedQuery("dinosaurs");
    const b = await provider.embedQuery("bedtime stories");
    expect(a).not.toEqual(b);
  });

  it("is L2-normalized (unit length)", async () => {
    const vector = await provider.embedQuery("caterpillar");
    const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    expect(norm).toBeCloseTo(1, 5);
  });

  it("embedDocuments batches independently — matches embedQuery for the same text", async () => {
    const [batched] = await provider.embedDocuments(["dinosaurs"]);
    const single = await provider.embedQuery("dinosaurs");
    expect(batched).toEqual(single);
  });
});
