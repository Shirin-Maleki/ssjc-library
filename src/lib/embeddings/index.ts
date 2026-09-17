import "server-only";
import { GeminiEmbeddingProvider } from "./geminiProvider";
import type { EmbeddingProvider } from "./provider";

export type { EmbeddingProvider } from "./provider";
export {
  EmbeddingProviderConfigError,
  EmbeddingProviderRequestError,
  EmbeddingProviderUnavailableError,
} from "./provider";

/**
 * The one place production code decides which embedding provider to use — never
 * imported by a Client Component (`import "server-only"` makes that a build error).
 * Returns `undefined`, never throws, when nothing is configured: "no provider" is a
 * normal, expected state this whole search architecture is built to degrade through
 * gracefully (docs/SEARCH.md §5), not an error condition. A ChatGPT/Claude/Gemini
 * *subscription* is not an API credential — only a real `GEMINI_API_KEY` counts.
 */
export function getConfiguredEmbeddingProvider(): EmbeddingProvider | undefined {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return undefined;
  try {
    return new GeminiEmbeddingProvider(apiKey);
  } catch {
    return undefined;
  }
}
