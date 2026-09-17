import { afterEach, describe, expect, it, vi } from "vitest";

// `src/lib/embeddings/index.ts` is `import "server-only"` — Vite's module resolution
// treats that as a browser-context error even under Vitest's `node` environment, so
// it's stubbed to a no-op here purely to make the module importable in a test
// process; the real guarantee ("never importable from a Client Component") is
// enforced by Next.js' own build, not by this test.
vi.mock("server-only", () => ({}));

const { getConfiguredEmbeddingProvider } = await import("@/lib/embeddings/index");

describe("getConfiguredEmbeddingProvider", () => {
  const originalKey = process.env.GEMINI_API_KEY;

  afterEach(() => {
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
    vi.unstubAllEnvs();
  });

  it("returns undefined, never throws, when GEMINI_API_KEY is unset", () => {
    delete process.env.GEMINI_API_KEY;
    expect(() => getConfiguredEmbeddingProvider()).not.toThrow();
    expect(getConfiguredEmbeddingProvider()).toBeUndefined();
  });

  it("returns a provider when a key is present", () => {
    process.env.GEMINI_API_KEY = "test-key-not-real";
    const provider = getConfiguredEmbeddingProvider();
    expect(provider).toBeDefined();
    expect(provider?.modelId).toBe("gemini-embedding-2");
    expect(provider?.dimensions).toBe(768);
  });
});
