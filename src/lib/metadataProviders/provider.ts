/**
 * The seam between the intake pipeline and external bibliographic lookup (Phase 7,
 * §13 of the phase brief) — nothing outside this file and its two concrete adapters
 * (`googleBooksProvider.ts`, `openLibraryProvider.ts`) sees a raw Google Books or
 * Open Library JSON shape. Every provider normalizes into the one
 * `NormalizedMetadataCandidate` shape below before returning.
 */

export type MetadataProviderName = "google_books" | "open_library";

export type MetadataErrorCategory =
  | "configuration_missing"
  | "rate_limited"
  | "transient_provider_failure"
  | "timeout"
  | "invalid_response"
  | "unexpected_provider_failure";

export class MetadataProviderError extends Error {
  constructor(readonly provider: MetadataProviderName, readonly category: MetadataErrorCategory, message: string, readonly cause?: unknown) {
    super(message);
    this.name = "MetadataProviderError";
  }
}

/**
 * One provider's candidate result, normalized. Everything optional except `provider`
 * and `providerIdentifier` — a real provider response frequently omits fields, and
 * this shape must represent that honestly rather than inventing a value (§13: "Do
 * not let Google Books or Open Library JSON shapes spread through the domain").
 */
export interface NormalizedMetadataCandidate {
  provider: MetadataProviderName;
  /** The provider's own durable id for this exact record (a Google Books volume id,
   * an Open Library work/edition key) — never re-derived from title text. */
  providerIdentifier: string;
  title?: string;
  subtitle?: string;
  authors?: string[];
  publisher?: string;
  /** As supplied by the provider — a bare year ("2005"), a full date
   * ("2005-03-01"), or absent. Never parsed/coerced here; a caller that needs a
   * specific shape does that itself. */
  publishedDate?: string;
  /** The provider's own language value (an ISO code, a bare language name, or
   * absent) — reconciled against the app's ISO 639-1 registry by
   * `src/lib/intake/reconciliation.ts`, not here. */
  language?: string;
  isbn10?: string;
  isbn13?: string;
  editionOrVolumeHint?: string;
  pageCount?: number;
  description?: string;
  subjects?: string[];
  thumbnailUrl?: string;
}

export interface MetadataSearchQuery {
  isbn?: string;
  title?: string;
  authors?: string[];
  language?: string;
  publisher?: string;
}

/** One adapter's bounded search — never more than a small, targeted result set (see
 * each adapter's own `MAX_RESULTS`). Real work: build one or two strong, evidenced
 * queries (§14: "prefer strong targeted queries based on evidence... never treat
 * result #1 as automatically correct... do not call arbitrary dozens of
 * searches"). */
export interface BookMetadataProvider {
  readonly name: MetadataProviderName;
  search(query: MetadataSearchQuery): Promise<NormalizedMetadataCandidate[]>;
}
