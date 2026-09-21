import { and, eq, gt, isNull, or } from "drizzle-orm";
import type { Database } from "@/db/client";
import { metadataProviderCache } from "@/db/schema";
import { normalizeSearchText } from "@/lib/search/normalize";
import type { MetadataProviderName, MetadataSearchQuery, NormalizedMetadataCandidate } from "./provider";

/**
 * Read/write access to the existing `metadata_provider_cache` table (Phase 7, §15 of
 * the phase brief) — reused, not duplicated: retries of the same intake normally hit
 * this cache rather than repeatedly calling Google Books/Open Library. Never caches
 * Gemini vision/enrichment output (only bibliographic provider search results) —
 * that boundary is intentional (§15: "Do not cache Gemini raw vision responses in
 * this provider-cache table").
 */

/** How long a cached provider search result is trusted before a retry re-fetches it
 * — bounded so a genuinely wrong identity (a bad match cached once) doesn't live
 * forever (§15: "Do not let a stale wrong identity live forever"). 30 days is ample
 * for a low-volume single-add workflow (most retries of the same intake happen
 * within minutes, not weeks) while still self-correcting eventually. */
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Normalizes the actual search evidence into one stable cache key string — ISBN
 * search and title+author+language search intentionally produce different keys even
 * for "the same" book, since they represent genuinely different evidence (§15's own
 * two examples). Never includes provider-internal ids or anything not present in
 * the query itself.
 */
export function buildCacheKey(query: MetadataSearchQuery): string {
  if (query.isbn) {
    return `isbn:${query.isbn.replace(/[^0-9Xx]/g, "").toUpperCase()}`;
  }
  const titlePart = query.title ? normalizeSearchText(query.title) : "";
  const authorPart = (query.authors ?? []).map((a) => normalizeSearchText(a)).sort().join(",");
  const languagePart = query.language ? normalizeSearchText(query.language) : "";
  return `title_author_lang:${titlePart}|${authorPart}|${languagePart}`;
}

interface CachedPayload {
  candidates: NormalizedMetadataCandidate[];
}

export async function getCachedCandidates(
  db: Database,
  provider: MetadataProviderName,
  query: MetadataSearchQuery
): Promise<NormalizedMetadataCandidate[] | undefined> {
  const key = buildCacheKey(query);
  const now = new Date();
  const [row] = await db
    .select({ response: metadataProviderCache.response })
    .from(metadataProviderCache)
    .where(
      and(
        eq(metadataProviderCache.provider, provider),
        eq(metadataProviderCache.normalizedQuery, key),
        or(isNull(metadataProviderCache.expiresAt), gt(metadataProviderCache.expiresAt, now))
      )
    )
    .limit(1);
  if (!row) return undefined;
  const payload = row.response as CachedPayload;
  return payload.candidates;
}

export async function setCachedCandidates(
  db: Database,
  provider: MetadataProviderName,
  query: MetadataSearchQuery,
  candidates: NormalizedMetadataCandidate[]
): Promise<void> {
  const key = buildCacheKey(query);
  const payload: CachedPayload = { candidates };
  await db
    .insert(metadataProviderCache)
    .values({
      provider,
      normalizedQuery: key,
      response: payload,
      expiresAt: new Date(Date.now() + CACHE_TTL_MS),
    })
    .onConflictDoUpdate({
      target: [metadataProviderCache.provider, metadataProviderCache.normalizedQuery],
      set: { response: payload, expiresAt: new Date(Date.now() + CACHE_TTL_MS), createdAt: new Date() },
    });
}
