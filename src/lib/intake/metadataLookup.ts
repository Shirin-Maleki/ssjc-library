import type { Database } from "@/db/client";
import type { BookMetadataProvider, MetadataSearchQuery, NormalizedMetadataCandidate } from "@/lib/metadataProviders";
import { getCachedCandidates, setCachedCandidates } from "@/lib/metadataProviders/cache";

/**
 * Chains the configured bibliographic providers with caching and an early-stop
 * heuristic (Phase 7, §14 of the phase brief). A domain concern, not a provider
 * concern — `src/lib/metadataProviders/index.ts` only decides *which* providers are
 * configured; this decides *how* to use them together for one search.
 *
 * Provider order: Google Books first (when configured) → Open Library. A provider
 * failure never fails the whole lookup — it's logged internally (via the returned
 * `providerErrors` list, for observability) and the chain simply continues to the
 * next provider, per §40's "do not fail the entire intake merely because Google
 * Books is unavailable."
 */

export interface MetadataLookupResult {
  candidates: NormalizedMetadataCandidate[];
  /** Which providers were actually queried this call, in order — useful for
   * `docs/AI_PIPELINE.md`-style validation reporting, never shown to a teacher. */
  providersQueried: string[];
  /** Safe, provider-labeled failure summaries — never a raw provider error message
   * reaching a teacher; this is for the intake draft's own internal record only. */
  providerErrors: { provider: string; category: string }[];
}

/** True only when the ISBN we searched for is genuinely confirmed by a provider's
 * own returned ISBN — the "highly convincing" case §14 says should stop the chain
 * before trying a second provider unnecessarily. */
function hasConfirmedIsbnMatch(query: MetadataSearchQuery, candidates: NormalizedMetadataCandidate[]): boolean {
  if (!query.isbn) return false;
  const normalizedQueryIsbn = query.isbn.replace(/[^0-9Xx]/g, "").toUpperCase();
  return candidates.some((candidate) => {
    const candidateIsbns = [candidate.isbn10, candidate.isbn13].filter((v): v is string => Boolean(v));
    return candidateIsbns.some((isbn) => isbn.replace(/[^0-9Xx]/g, "").toUpperCase() === normalizedQueryIsbn);
  });
}

export async function lookupMetadataCandidates(
  db: Database,
  providers: BookMetadataProvider[],
  query: MetadataSearchQuery
): Promise<MetadataLookupResult> {
  const candidates: NormalizedMetadataCandidate[] = [];
  const providersQueried: string[] = [];
  const providerErrors: { provider: string; category: string }[] = [];

  for (const provider of providers) {
    providersQueried.push(provider.name);
    let providerCandidates: NormalizedMetadataCandidate[];

    const cached = await getCachedCandidates(db, provider.name, query);
    if (cached) {
      providerCandidates = cached;
    } else {
      try {
        providerCandidates = await provider.search(query);
        await setCachedCandidates(db, provider.name, query, providerCandidates);
      } catch (error) {
        const category = error && typeof error === "object" && "category" in error ? String((error as { category: unknown }).category) : "unexpected_provider_failure";
        providerErrors.push({ provider: provider.name, category });
        continue;
      }
    }

    candidates.push(...providerCandidates);

    if (hasConfirmedIsbnMatch(query, providerCandidates)) {
      break;
    }
  }

  return { candidates, providersQueried, providerErrors };
}
