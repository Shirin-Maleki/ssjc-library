import type { ReconciliationOutcome } from "./reconciliation";

/**
 * The real enforcement behind §37 of the Phase 7 brief's "practical display
 * strategy" — a provider thumbnail is only ever trusted as a book's display
 * cover when it genuinely corresponds to a *confirmed* identity match, from a
 * genuinely expected provider host, over HTTPS. No new storage/CDN
 * architecture — this validates an already-fetched URL, never fetches or
 * re-hosts anything itself. `undefined` (never a fabricated fallback) leaves
 * `BookCover.tsx` to render its existing typographic placeholder.
 */

/** Real, current thumbnail-serving hosts for the two configured metadata
 * providers (`src/lib/metadataProviders/`) — not a generic "any https URL"
 * allowlist. A provider adapter change that starts serving thumbnails from a
 * different real host would need this list updated deliberately, not
 * silently start working. */
/** Exported for Phase 9's Google Sheets sync — a cover image is only ever rendered
 * via an `IMAGE()` formula in the Sheet when its URL passes this exact same
 * host/scheme trust boundary a second time at write time (never a fabricated
 * formula from arbitrary book metadata text), even though `books.display_cover_url`
 * was already gated through this check once when it was first saved. */
export const TRUSTED_THUMBNAIL_HOSTS = new Set(["books.google.com", "books.googleusercontent.com", "covers.openlibrary.org"]);

export interface DisplayCoverCandidateInput {
  /** Only a *confirmed* identity (`high_confidence`) ever produces a display
   * cover — an ambiguous or unresolved match showing a thumbnail would risk
   * displaying the WRONG book's cover, which is worse than the honest
   * placeholder. */
  reconciliationOutcome: ReconciliationOutcome | null;
  thumbnailUrl: string | undefined | null;
}

export function selectTrustworthyDisplayCoverUrl(input: DisplayCoverCandidateInput): string | undefined {
  if (input.reconciliationOutcome !== "high_confidence") return undefined;
  if (!input.thumbnailUrl) return undefined;

  let url: URL;
  try {
    url = new URL(input.thumbnailUrl);
  } catch {
    return undefined;
  }
  // Google Books' own documented example responses use `http://`, not `https://`,
  // for this exact resource — real, current, not an assumption (re-checked at
  // implementation time). Rather than rejecting a real, legitimate thumbnail over
  // scheme alone, an http URL from a trusted host is upgraded to https (the same
  // static image is genuinely served both ways) — never displayed as plain http
  // from an https-served app.
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
  if (!TRUSTED_THUMBNAIL_HOSTS.has(url.hostname)) return undefined;
  url.protocol = "https:";

  return url.toString();
}
