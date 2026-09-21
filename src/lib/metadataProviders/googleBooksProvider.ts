import { fetchWithRetry } from "@/lib/googleDrive/retry";
import { MetadataProviderError, type BookMetadataProvider, type MetadataSearchQuery, type NormalizedMetadataCandidate } from "./provider";

/**
 * Google Books `volumes` search (Phase 7, §14 of the phase brief) — the preferred
 * adapter, used only when `GOOGLE_BOOKS_API_KEY` is configured. Re-confirmed against
 * current official docs 2026-09-20 (`docs/DECISIONS.md`): a request without an OAuth
 * token needs an API key for reliable/production use; standard quota is free,
 * ~10,000 requests/day per key — comfortably enough for a low-volume single-book
 * intake workflow (§43).
 *
 * Reuses `src/lib/googleDrive/retry.ts`'s generic `fetchWithRetry` directly rather
 * than writing a fourth near-identical retry helper — that module is already a pure,
 * Drive-independent "retry a fetch call on 429/5xx" utility with zero coupling to
 * Drive concepts, so importing it here is reuse, not a layering violation.
 */

const API_BASE = "https://www.googleapis.com/books/v1/volumes";
const MAX_RESULTS = 5;
const REQUEST_TIMEOUT_MS = 5000;

interface GoogleBooksVolume {
  id: string;
  volumeInfo?: {
    title?: string;
    subtitle?: string;
    authors?: string[];
    publisher?: string;
    publishedDate?: string;
    language?: string;
    pageCount?: number;
    description?: string;
    categories?: string[];
    industryIdentifiers?: { type?: string; identifier?: string }[];
    imageLinks?: { thumbnail?: string; smallThumbnail?: string };
  };
}

interface GoogleBooksResponse {
  items?: GoogleBooksVolume[];
}

function buildQueryString(query: MetadataSearchQuery): string | undefined {
  // Strongest signal first — an ISBN, when genuinely supplied, is unambiguous.
  if (query.isbn) return `isbn:${query.isbn}`;

  const parts: string[] = [];
  if (query.title) parts.push(`intitle:${query.title}`);
  if (query.authors && query.authors.length > 0) parts.push(`inauthor:${query.authors[0]}`);
  if (query.publisher) parts.push(`inpublisher:${query.publisher}`);
  return parts.length > 0 ? parts.join("+") : undefined;
}

function normalizeVolume(volume: GoogleBooksVolume): NormalizedMetadataCandidate {
  const info = volume.volumeInfo ?? {};
  const identifiers = info.industryIdentifiers ?? [];
  const isbn10 = identifiers.find((i) => i.type === "ISBN_10")?.identifier;
  const isbn13 = identifiers.find((i) => i.type === "ISBN_13")?.identifier;

  return {
    provider: "google_books",
    providerIdentifier: volume.id,
    title: info.title,
    subtitle: info.subtitle,
    authors: info.authors,
    publisher: info.publisher,
    publishedDate: info.publishedDate,
    language: info.language,
    isbn10,
    isbn13,
    pageCount: info.pageCount,
    description: info.description,
    subjects: info.categories,
    thumbnailUrl: info.imageLinks?.thumbnail ?? info.imageLinks?.smallThumbnail,
  };
}

export class GoogleBooksMetadataProvider implements BookMetadataProvider {
  readonly name = "google_books" as const;

  constructor(private readonly apiKey: string) {
    if (!apiKey) {
      throw new MetadataProviderError("google_books", "configuration_missing", "GOOGLE_BOOKS_API_KEY is not set.");
    }
  }

  async search(query: MetadataSearchQuery): Promise<NormalizedMetadataCandidate[]> {
    const q = buildQueryString(query);
    if (!q) return [];

    const url = `${API_BASE}?q=${encodeURIComponent(q)}&maxResults=${MAX_RESULTS}&key=${this.apiKey}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetchWithRetry(url, { signal: controller.signal });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new MetadataProviderError("google_books", "timeout", `Google Books request timed out after ${REQUEST_TIMEOUT_MS}ms.`);
      }
      throw new MetadataProviderError("google_books", "transient_provider_failure", "Google Books request failed (network).", error);
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      if (response.status === 429) throw new MetadataProviderError("google_books", "rate_limited", "Google Books rate-limited this request.");
      if (response.status >= 500) {
        throw new MetadataProviderError("google_books", "transient_provider_failure", `Google Books returned HTTP ${response.status}.`);
      }
      throw new MetadataProviderError("google_books", "unexpected_provider_failure", `Google Books returned HTTP ${response.status}.`);
    }

    let body: GoogleBooksResponse;
    try {
      body = (await response.json()) as GoogleBooksResponse;
    } catch (error) {
      throw new MetadataProviderError("google_books", "invalid_response", "Google Books returned a malformed response.", error);
    }

    return (body.items ?? []).map(normalizeVolume);
  }
}
