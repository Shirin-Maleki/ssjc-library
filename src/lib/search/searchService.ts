import "server-only";
import type { Book, IllustrationStyle } from "@/lib/catalog/types";
import type { BookRepository } from "@/db/repositories/bookRepository";
import type { DrizzleSearchRepository, FacetCounts } from "@/db/repositories/searchRepository";
import type { PhysicalCategoryOption } from "@/db/repositories/categoryRepository";
import { getConfiguredEmbeddingProvider } from "@/lib/embeddings";
import {
  FICTION_TYPE_LABELS,
  FORMAT_LABELS,
  ILLUSTRATION_STYLE_LABELS,
  VISUAL_REALISM_LABELS,
} from "@/lib/catalog/labels";
import { DURATION_BAND_LABELS } from "@/lib/catalog/duration";
import { getLanguageName } from "@/lib/catalog/languages";
import type { Filters } from "./filters";
import { buildMatchExplanation } from "./explain";
import { combineScores, rankScoredBooks } from "./hybridScore";
import type { ScoredBook } from "./rank";

const KNOWN_ILLUSTRATION_STYLE_VALUES: ReadonlySet<string> = new Set<IllustrationStyle>(
  Object.keys(ILLUSTRATION_STYLE_LABELS) as IllustrationStyle[]
);

export interface SearchQuery {
  query: string;
  filters: Filters;
  /** How many results the caller wants to display this call — "Show More" is a
   * larger `limit` on a re-run, not client-side slicing of an already-fetched list
   * (docs/SEARCH.md §10). */
  limit: number;
}

export interface SearchResultRow {
  book: Book;
  score: number;
  explanation: string;
}

export interface SearchResultPage {
  results: SearchResultRow[];
  /** How many candidates cleared the relevance threshold in total — not the whole
   * catalog, just this bounded candidate set (see `docs/SEARCH.md` §7 for why that
   * distinction is deliberate and documented, not a shortcut). */
  totalQualifying: number;
  hasMore: boolean;
  facets: FacetCounts;
}

/**
 * The Phase 5 search boundary the Find page (and nothing else) calls — it never sees
 * SQL, Drizzle rows, vector syntax, or score-combination internals
 * (docs/SEARCH.md §1). Orchestrates: optional query embedding (best-effort, never
 * blocking) → bounded SQL candidate retrieval (hard filters + FTS/trgm/vector,
 * already visibility-scoped) → full `Book` projection of just those candidates →
 * hybrid scoring → threshold/sort → pagination → grounded explanations → facets.
 */
export class SearchService {
  constructor(
    private readonly searchRepository: DrizzleSearchRepository,
    private readonly bookRepository: BookRepository,
    private readonly categories: PhysicalCategoryOption[]
  ) {}

  async search({ query, filters, limit }: SearchQuery): Promise<SearchResultPage> {
    const trimmed = query.trim();
    const categoryLabelBySlug = new Map(this.categories.map((c) => [c.slug, c.label]));

    const queryEmbedding = trimmed.length > 0 ? await this.tryEmbedQuery(trimmed) : undefined;

    const signalsById = await this.searchRepository.findCandidates({ query: trimmed, filters, queryEmbedding });
    const candidateIds = [...signalsById.keys()];
    const books = await this.bookRepository.getBooksByIds(candidateIds);

    let scored: ScoredBook[];
    if (trimmed.length === 0) {
      // Queryless filter browsing stays alphabetical and unthresholded — the same
      // rule `rankBooks` (rank.ts) has always applied (docs/SEARCH.md §10).
      scored = [...books]
        .sort((a, b) => a.sortTitle.localeCompare(b.sortTitle))
        .map((book) => ({ book, score: 0, reasons: [] }));
    } else {
      scored = rankScoredBooks(books.map((book) => combineScores(book, trimmed, signalsById.get(book.id))));
    }

    const page = scored.slice(0, limit);
    const facetRows = await this.searchRepository.getVisibleBookFacetRows();

    return {
      results: page.map(({ book, score, reasons }) => ({
        book,
        score,
        explanation: buildMatchExplanation(reasons, categoryLabelBySlug),
      })),
      totalQualifying: scored.length,
      hasMore: scored.length > limit,
      facets: buildFacetsFromRows(facetRows, this.categories),
    };
  }

  /** Facets alone, without running a search — the initial "no query, no filters
   * yet" Find state needs real facet data for the Filters dialog but must not
   * trigger fetching/projecting any candidate books at all (docs/SEARCH.md §1: "the
   * production Find route must stop retrieving the complete catalog merely to
   * search it" applies just as much to the do-nothing-yet state as to a real
   * search). */
  async getFacets(): Promise<FacetCounts> {
    const facetRows = await this.searchRepository.getVisibleBookFacetRows();
    return buildFacetsFromRows(facetRows, this.categories);
  }

  /** Best-effort — any failure (no key, timeout, malformed response) degrades
   * silently to conventional-only retrieval. Never thrown up to the Find page,
   * never logged with the raw query text (docs/SEARCH.md §5: "do not persist raw
   * teacher queries by default"). */
  private async tryEmbedQuery(query: string): Promise<number[] | undefined> {
    const provider = getConfiguredEmbeddingProvider();
    if (!provider) return undefined;
    try {
      return await provider.embedQuery(query);
    } catch {
      return undefined;
    }
  }
}

/**
 * Builds facet options directly from the lightweight SQL facet rows
 * (`SearchRepository.getVisibleBookFacetRows`) — deliberately not a reuse of
 * `buildFacets` (facets.ts), which expects a full in-memory `Book[]` and derives a
 * duration band from raw minutes; here SQL has already computed the authoritative
 * `read_duration_band` (the single duration-band authority, `docs/DECISIONS.md`),
 * so this reads that directly instead of reconstructing an equivalent `Book` shape
 * just to re-derive something already known. Same option shape, sorting, and
 * "only categories actually in use" rule as the Phase 2–4 behavior it replaces.
 */
function buildFacetsFromRows(
  rows: Awaited<ReturnType<DrizzleSearchRepository["getVisibleBookFacetRows"]>>,
  categories: PhysicalCategoryOption[]
): FacetCounts {
  const distinct = <T,>(values: (T | null | undefined)[]): T[] =>
    Array.from(new Set(values.filter((v): v is T => v != null)));

  const categoriesInUse = new Set(rows.map((r) => r.physicalCategorySlug).filter((v): v is string => v != null));
  const languageCodes = distinct(rows.flatMap((r) => [r.languageCode, ...r.additionalLanguageCodes]));
  const fictionTypes = distinct(rows.map((r) => (r.fictionStatus === "unknown_mixed" ? null : r.fictionStatus)));
  const formats = distinct(rows.map((r) => r.format));
  const illustrationStyles = distinct(
    rows.flatMap((r) => (r.visualMediaType ?? []).filter((v) => KNOWN_ILLUSTRATION_STYLE_VALUES.has(v)))
  );
  const visualRealism = distinct(rows.map((r) => (r.visualRealism === "unknown" ? null : r.visualRealism)));
  const durations = distinct(rows.map((r) => r.readDurationBand));
  const authors = distinct(rows.flatMap((r) => r.authors)).sort();
  const illustrators = distinct(rows.flatMap((r) => r.illustrators)).sort();
  const publisherNames = distinct(rows.map((r) => r.publisherName)).sort();

  return {
    categories: categories
      .filter((c) => categoriesInUse.has(c.slug))
      .map((c) => ({ value: c.slug, label: c.label })),
    languages: languageCodes
      .map((code) => ({ value: code, label: getLanguageName(code as Parameters<typeof getLanguageName>[0]) }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    fictionTypes: (["fiction", "nonfiction"] as const)
      .filter((t) => fictionTypes.includes(t))
      .map((t) => ({ value: t, label: FICTION_TYPE_LABELS[t] })),
    formats: formats
      .map((f) => ({ value: f, label: FORMAT_LABELS[f as keyof typeof FORMAT_LABELS] }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    illustrationStyles: illustrationStyles
      .map((s) => ({ value: s, label: ILLUSTRATION_STYLE_LABELS[s as keyof typeof ILLUSTRATION_STYLE_LABELS] }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    visualRealism: visualRealism
      .map((r) => ({ value: r, label: VISUAL_REALISM_LABELS[r as keyof typeof VISUAL_REALISM_LABELS] }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    durations: (["under_5", "five_to_ten", "ten_plus"] as const)
      .filter((band) => durations.includes(band))
      .map((band) => ({ value: band, label: DURATION_BAND_LABELS[band] })),
    authors: authors.map((a) => ({ value: a, label: a })),
    illustrators: illustrators.map((i) => ({ value: i, label: i })),
    publishers: publisherNames.map((p) => ({ value: p, label: p })),
  };
}
