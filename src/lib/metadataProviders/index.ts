import "server-only";
import { GoogleBooksMetadataProvider } from "./googleBooksProvider";
import { OpenLibraryMetadataProvider } from "./openLibraryProvider";
import type { BookMetadataProvider } from "./provider";
import { isE2EFakeProvidersEnabled } from "@/lib/e2eTestFlags";

export type {
  BookMetadataProvider,
  MetadataSearchQuery,
  NormalizedMetadataCandidate,
  MetadataErrorCategory,
  MetadataProviderName,
} from "./provider";
export { MetadataProviderError } from "./provider";

/**
 * The one place production code decides which bibliographic providers are
 * configured — never imported by a Client Component. Mirrors
 * `src/lib/embeddings/index.ts`/`src/lib/googleDrive/index.ts`/`src/lib/ai/index.ts`.
 * Returns providers in preference order (§14 of the phase brief): Google Books
 * first, when `GOOGLE_BOOKS_API_KEY` is configured; Open Library always (it needs no
 * key). The actual chaining/caching/early-stop logic lives in
 * `src/lib/intake/metadataLookup.ts` — a domain concern, not a provider-construction
 * one.
 */
export function getConfiguredMetadataProviders(): BookMetadataProvider[] {
  // E2E fixture path (§49 of the phase brief: "never live APIs in ordinary CI") —
  // see src/lib/intake/e2eFixtures.ts's own doc comment. Open Library needs no key
  // and would otherwise always be included below.
  if (isE2EFakeProvidersEnabled()) return [];

  const providers: BookMetadataProvider[] = [];
  const googleBooksApiKey = process.env.GOOGLE_BOOKS_API_KEY;
  if (googleBooksApiKey) {
    try {
      providers.push(new GoogleBooksMetadataProvider(googleBooksApiKey));
    } catch {
      // Configuration error constructing the adapter — degrade to Open Library only.
    }
  }
  providers.push(new OpenLibraryMetadataProvider());
  return providers;
}
