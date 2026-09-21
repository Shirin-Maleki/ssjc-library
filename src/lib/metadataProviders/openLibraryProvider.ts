import { fetchWithRetry } from "@/lib/googleDrive/retry";
import { MetadataProviderError, type BookMetadataProvider, type MetadataSearchQuery, type NormalizedMetadataCandidate } from "./provider";

/**
 * Open Library Search API fallback adapter (Phase 7, §14 of the phase brief) — used
 * when Google Books is unconfigured or unresolved. Re-confirmed against current
 * official guidance 2026-09-20 (`docs/DECISIONS.md`): uses `/search.json` (the
 * current Search API), not the legacy `/api/books` endpoint; sends a descriptive
 * `User-Agent` identifying this application, per Open Library's own guidance for any
 * client making regular calls; kept low-volume and cached
 * (`src/lib/metadataProviders/cache.ts`) — never a hidden bulk backend (Phase 10
 * will need its own bulk-provider strategy, not this adapter reused at scale).
 *
 * Reuses `src/lib/googleDrive/retry.ts`'s generic `fetchWithRetry`, same reasoning
 * as `googleBooksProvider.ts`.
 */

const API_BASE = "https://openlibrary.org/search.json";
const MAX_RESULTS = 5;
const REQUEST_TIMEOUT_MS = 5000;
/** Identifies this application per Open Library's own request — a real, public repo
 * URL, not a fabricated contact address this codebase has no authority to invent. */
const USER_AGENT = "SSJC-Library-Intake/1.0 (+https://github.com/Shirin-Maleki/ssjc-library)";

const RESPONSE_FIELDS = "key,title,subtitle,author_name,first_publish_year,isbn,publisher,language,subject,cover_i";

interface OpenLibraryDoc {
  key?: string;
  title?: string;
  subtitle?: string;
  author_name?: string[];
  first_publish_year?: number;
  isbn?: string[];
  publisher?: string[];
  language?: string[];
  subject?: string[];
  cover_i?: number;
}

interface OpenLibraryResponse {
  docs?: OpenLibraryDoc[];
}

function buildParams(query: MetadataSearchQuery): URLSearchParams | undefined {
  const params = new URLSearchParams();
  if (query.isbn) {
    params.set("isbn", query.isbn);
  } else if (query.title) {
    params.set("title", query.title);
    if (query.authors && query.authors.length > 0) params.set("author", query.authors[0]);
  } else {
    return undefined;
  }
  params.set("fields", RESPONSE_FIELDS);
  params.set("limit", String(MAX_RESULTS));
  return params;
}

function pickIsbn(isbns: string[] | undefined, length: 10 | 13): string | undefined {
  return isbns?.find((code) => code.replace(/[^0-9Xx]/g, "").length === length);
}

function coverUrl(coverId: number | undefined): string | undefined {
  return coverId ? `https://covers.openlibrary.org/b/id/${coverId}-M.jpg` : undefined;
}

function normalizeDoc(doc: OpenLibraryDoc): NormalizedMetadataCandidate {
  return {
    provider: "open_library",
    providerIdentifier: doc.key ?? "",
    title: doc.title,
    subtitle: doc.subtitle,
    authors: doc.author_name,
    publisher: doc.publisher?.[0],
    publishedDate: doc.first_publish_year ? String(doc.first_publish_year) : undefined,
    // Open Library's `language` values are 3-letter MARC codes (e.g. "eng"), not
    // ISO 639-1 — passed through as-is; reconciliation
    // (`src/lib/intake/reconciliation.ts`) is responsible for mapping the small set
    // of common codes it can confidently map, never guessing at the rest.
    language: doc.language?.[0],
    isbn10: pickIsbn(doc.isbn, 10),
    isbn13: pickIsbn(doc.isbn, 13),
    subjects: doc.subject?.slice(0, 10),
    thumbnailUrl: coverUrl(doc.cover_i),
  };
}

export class OpenLibraryMetadataProvider implements BookMetadataProvider {
  readonly name = "open_library" as const;

  async search(query: MetadataSearchQuery): Promise<NormalizedMetadataCandidate[]> {
    const params = buildParams(query);
    if (!params) return [];

    const url = `${API_BASE}?${params.toString()}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetchWithRetry(url, { signal: controller.signal, headers: { "User-Agent": USER_AGENT } });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new MetadataProviderError("open_library", "timeout", `Open Library request timed out after ${REQUEST_TIMEOUT_MS}ms.`);
      }
      throw new MetadataProviderError("open_library", "transient_provider_failure", "Open Library request failed (network).", error);
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      if (response.status === 429) throw new MetadataProviderError("open_library", "rate_limited", "Open Library rate-limited this request.");
      if (response.status >= 500) {
        throw new MetadataProviderError("open_library", "transient_provider_failure", `Open Library returned HTTP ${response.status}.`);
      }
      throw new MetadataProviderError("open_library", "unexpected_provider_failure", `Open Library returned HTTP ${response.status}.`);
    }

    let body: OpenLibraryResponse;
    try {
      body = (await response.json()) as OpenLibraryResponse;
    } catch (error) {
      throw new MetadataProviderError("open_library", "invalid_response", "Open Library returned a malformed response.", error);
    }

    return (body.docs ?? []).map(normalizeDoc);
  }
}
