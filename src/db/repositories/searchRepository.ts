import { and, arrayOverlaps, eq, inArray, isNotNull, or, sql, type SQL } from "drizzle-orm";
import type { Database } from "../client";
import {
  bookContributors,
  bookLanguages,
  books,
  bookTags,
  contributors,
  physicalCategories,
  publishers,
  tags,
} from "../schema";
import { TEACHER_VISIBLE_REVIEW_STATUS } from "@/lib/catalog/visibility";
import { ageYearsToRepresentativeMonths } from "@/lib/catalog/age";
import { parseSearchIntent } from "@/lib/search/intent";
import { normalizeTitle } from "@/lib/search/normalize";
import { getLanguageName, ISO_639_1_LANGUAGE_NAMES, type LanguageCode } from "@/lib/catalog/languages";
import type { Filters } from "@/lib/search/filters";

/** How many SQL-ranked candidates each retrieval strategy contributes at most —
 * bounded so a search never approaches "load the whole catalog," matching this
 * catalog's expected size (docs/SEARCH.md §1/§7: ~1,500–5,000 books). Deliberately
 * generous relative to the Top-5/Show-More UI: final ranking, thresholding, and
 * pagination all happen in `SearchService` against this bounded set, not the raw
 * catalog. */
const FTS_CANDIDATE_LIMIT = 150;
const TRGM_CANDIDATE_LIMIT = 80;
const VECTOR_CANDIDATE_LIMIT = 60;
const EXACT_CANDIDATE_LIMIT = 30;
const INTENT_CANDIDATE_LIMIT = 150;
/** `pg_trgm` similarity below this is treated as "not actually similar" — a real,
 * if generous, floor, not "return everything." Calibrated against `books.title`
 * (not the full multi-field `search_text` — a short misspelled query compared
 * against a long concatenated document dilutes to a near-zero score even for the
 * right book, verified directly with real seeded titles): a genuine one-word typo
 * in a real title scored 0.35–0.9 in that verification, an unrelated title scored
 * under 0.1. See `tests/integration/db/searchRepository.test.ts`. */
const TRGM_SIMILARITY_FLOOR = 0.2;

export interface CandidateSignals {
  bookId: string;
  /** From `ts_rank(search_vector, plainto_tsquery(...))` — 0 when the row wasn't a
   * full-text candidate at all. */
  ftsRank: number;
  /** From `similarity(search_text, query)` (`pg_trgm`) — 0 when not a trigram
   * candidate. */
  trgmSimilarity: number;
  /** Cosine distance (`embedding <=> queryEmbedding`, 0 = identical) — `null` when
   * there's no query embedding, no stored embedding for this book, or this book
   * wasn't among the nearest vector candidates. Never a fabricated "worst possible"
   * number — absence is absence, per `docs/SEARCH.md` §5. */
  vectorDistance: number | null;
  /** A direct, deterministic hit (exact/prefix title, ISBN, exact contributor or
   * publisher name) — these are guaranteed into the candidate set regardless of how
   * FTS/trgm/vector would have ranked them, so "The Very Hungry Caterpillar" or a
   * bare ISBN can never be missed just because full-text tokenization under-weights
   * short/numeric strings. */
  exactMatch: boolean;
}

export interface FacetCounts {
  categories: { value: string; label: string }[];
  languages: { value: string; label: string }[];
  fictionTypes: { value: string; label: string }[];
  formats: { value: string; label: string }[];
  illustrationStyles: { value: string; label: string }[];
  visualRealism: { value: string; label: string }[];
  durations: { value: string; label: string }[];
  authors: { value: string; label: string }[];
  illustrators: { value: string; label: string }[];
  publishers: { value: string; label: string }[];
}

export interface AutocompleteRow {
  value: string;
  type: "title" | "author" | "illustrator" | "publisher" | "category" | "topic" | "language";
}

function digitsOnly(value: string): string {
  return value.replace(/[^0-9Xx]/g, "");
}

/**
 * Builds an OR-of-lexemes `tsquery` from free text, instead of `plainto_tsquery`'s
 * implicit AND-of-every-word. See the call site's comment for why: a descriptive
 * multi-word query must not require every word to appear verbatim in a single book's
 * document. `tsvector_to_array(to_tsvector(...))` reuses Postgres' own English
 * stemming/stopword removal to produce the lexeme list that gets OR'd together. A
 * query that stems to no lexemes at all (e.g. only stopwords) safely degrades to
 * matching nothing, not an error — verified directly against the dev DB.
 */
function orTsQuery(text: string): SQL {
  return sql`to_tsquery('english', array_to_string(tsvector_to_array(to_tsvector('english', ${text})), ' | '))`;
}

/**
 * Gates the OR-tsquery above: matching only ONE of a multi-word query's lexemes is
 * not a genuine full-text match, just an isolated common word incidentally present
 * somewhere in one book's document — e.g. "something to read please" would otherwise
 * match any book whose description happens to contain the ordinary word "read"
 * (verified directly: two real, unrelated books matched this way with no other
 * signal). Requires at least two of the query's own lexemes to actually appear in
 * the row (or all of them, when the query itself has fewer than two) — real topical
 * queries like "animal books with real photos" satisfy this easily (multiple
 * genuinely relevant books matched 2 of its 4 lexemes in direct verification), while
 * single-incidental-word coincidences never do. Mirrors `TRGM_SIMILARITY_FLOOR`'s
 * role for trigram matching: a real, empirically-checked floor, not "match anything."
 */
function ftsHasMeaningfulOverlap(text: string): SQL {
  return sql`(
    select count(*) from unnest(tsvector_to_array(to_tsvector('english', ${text}))) as lex
    where ${books.searchVector} @@ to_tsquery('english', lex)
  ) >= least(2, (select array_length(tsvector_to_array(to_tsvector('english', ${text})), 1)))`;
}

/**
 * Builds the hard-constraint WHERE conditions shared by candidate retrieval,
 * autocomplete, and facets — SQL enforces these (`docs/SEARCH.md` §2), never an
 * in-application `.filter()` over a fully-loaded catalog. Every condition here
 * mirrors `src/lib/search/filters.ts`'s `matchesFilters` semantics exactly (AND
 * across groups, OR within a group) so the two never disagree.
 */
function buildHardFilterConditions(filters: Filters): SQL[] {
  const conditions: SQL[] = [eq(books.reviewStatus, TEACHER_VISIBLE_REVIEW_STATUS)];

  if (typeof filters.ageYears === "number") {
    const point = ageYearsToRepresentativeMonths(filters.ageYears);
    // A book with both bounds unknown can never confidently satisfy an age filter —
    // excluded, matching `bookMatchesAgeYears` (src/lib/catalog/age.ts).
    conditions.push(
      sql`(${books.ageMinMonths} is not null or ${books.ageMaxMonths} is not null)
          and coalesce(${books.ageMinMonths}, -32768) <= ${point}
          and coalesce(${books.ageMaxMonths}, 32767) >= ${point}`
    );
  }

  if (filters.languages && filters.languages.length > 0) {
    conditions.push(
      sql`(${inArray(books.languageCode, filters.languages)} or exists (
        select 1 from ${bookLanguages}
        where ${bookLanguages.bookId} = ${books.id} and ${inArray(bookLanguages.languageCode, filters.languages)}
      ))`
    );
  }
  if (filters.fictionTypes && filters.fictionTypes.length > 0) {
    conditions.push(inArray(books.fictionStatus, filters.fictionTypes as (typeof books.fictionStatus.enumValues)[number][]));
  }
  if (filters.categories && filters.categories.length > 0) {
    conditions.push(
      sql`exists (select 1 from ${physicalCategories}
        where ${physicalCategories.id} = ${books.physicalCategoryId} and ${inArray(physicalCategories.slug, filters.categories)})`
    );
  }
  if (filters.formats && filters.formats.length > 0) {
    conditions.push(inArray(books.format, filters.formats as (typeof books.format.enumValues)[number][]));
  }
  if (filters.illustrationStyles && filters.illustrationStyles.length > 0) {
    conditions.push(
      arrayOverlaps(books.visualMediaType, filters.illustrationStyles as (typeof books.visualMediaType.enumValues)[number][])
    );
  }
  if (filters.visualRealism && filters.visualRealism.length > 0) {
    conditions.push(inArray(books.visualRealism, filters.visualRealism as (typeof books.visualRealism.enumValues)[number][]));
  }
  if (filters.durations && filters.durations.length > 0) {
    conditions.push(inArray(books.readDurationBand, filters.durations as (typeof books.readDurationBand.enumValues)[number][]));
  }
  if (filters.authors && filters.authors.length > 0) {
    conditions.push(
      sql`exists (select 1 from ${bookContributors}
        inner join ${contributors} on ${contributors.id} = ${bookContributors.contributorId}
        where ${bookContributors.bookId} = ${books.id} and ${bookContributors.role} = 'author'
          and ${inArray(contributors.name, filters.authors)})`
    );
  }
  if (filters.illustrators && filters.illustrators.length > 0) {
    conditions.push(
      sql`exists (select 1 from ${bookContributors}
        inner join ${contributors} on ${contributors.id} = ${bookContributors.contributorId}
        where ${bookContributors.bookId} = ${books.id} and ${bookContributors.role} = 'illustrator'
          and ${inArray(contributors.name, filters.illustrators)})`
    );
  }
  if (filters.publishers && filters.publishers.length > 0) {
    conditions.push(
      sql`exists (select 1 from ${publishers}
        where ${publishers.id} = ${books.publisherId} and ${inArray(publishers.name, filters.publishers)})`
    );
  }

  return conditions;
}

/**
 * Structured signals parsed from free text (age/duration/language/illustration-
 * style/visual-realism phrases, `lib/search/intent.ts` — unchanged from Phase 2–4)
 * are RANKING-only, never a hard filter — but they still need their own bounded SQL
 * candidate query, not just a hope that FTS/trigram happens to also find the same
 * books. A query like "a book for a 4 year old" shares essentially no literal
 * vocabulary with a given age-appropriate book's title/description, so without this,
 * an age-appropriate book with no keyword overlap would never even become a
 * candidate — silently regressing a real Phase 2–4 capability (deterministic intent
 * bonuses working independent of keyword matching) the moment retrieval moved from
 * "score the whole catalog" to "score only SQL-bounded candidates." This mirrors
 * `buildHardFilterConditions` structurally (same age/language/style predicates) but
 * OR's them together (any one recognized signal is enough to make a book a
 * candidate) instead of AND'ing them the way real filters do.
 */
function buildIntentConditions(query: string): SQL | undefined {
  const intent = parseSearchIntent(query);
  const conditions: SQL[] = [];

  if (typeof intent.ageYears === "number") {
    const point = ageYearsToRepresentativeMonths(intent.ageYears);
    conditions.push(
      sql`(${books.ageMinMonths} is not null or ${books.ageMaxMonths} is not null)
          and coalesce(${books.ageMinMonths}, -32768) <= ${point}
          and coalesce(${books.ageMaxMonths}, 32767) >= ${point}`
    );
  }
  if (intent.durationBand) {
    conditions.push(eq(books.readDurationBand, intent.durationBand));
  }
  if (intent.languageCode) {
    conditions.push(
      sql`(${eq(books.languageCode, intent.languageCode)} or exists (
        select 1 from ${bookLanguages}
        where ${bookLanguages.bookId} = ${books.id} and ${eq(bookLanguages.languageCode, intent.languageCode)}
      ))`
    );
  }
  if (intent.illustrationStyle) {
    conditions.push(arrayOverlaps(books.visualMediaType, [intent.illustrationStyle]));
  }
  if (intent.visualRealism && intent.visualRealism.length > 0) {
    conditions.push(inArray(books.visualRealism, intent.visualRealism));
  }

  return conditions.length > 0 ? or(...conditions) : undefined;
}

export class DrizzleSearchRepository {
  constructor(private readonly db: Database) {}

  /**
   * Returns a bounded, deduplicated set of candidate ids with their raw retrieval
   * signals — hard filters (including visibility) already applied in SQL. Exact
   * known-item candidates (title/ISBN/contributor/publisher) are unioned in
   * separately so they're never missed by FTS/trgm/vector alone
   * (docs/SEARCH.md §1/§4/§5). `SearchService` does all scoring/thresholding/
   * pagination on top of this — this method's only job is "don't lose the right
   * books, and don't return the whole catalog."
   */
  async findCandidates(params: {
    query: string;
    filters: Filters;
    queryEmbedding?: number[];
  }): Promise<Map<string, CandidateSignals>> {
    const { query, filters } = params;
    const trimmed = query.trim();
    const where = and(...buildHardFilterConditions(filters));
    const signals = new Map<string, CandidateSignals>();

    const merge = (bookId: string, patch: Partial<CandidateSignals>) => {
      const existing = signals.get(bookId) ?? { bookId, ftsRank: 0, trgmSimilarity: 0, vectorDistance: null, exactMatch: false };
      signals.set(bookId, { ...existing, ...patch });
    };

    if (trimmed.length === 0) {
      // Queryless (filter-only) browsing never goes through this candidate-signal
      // path at all — see `findVisibleBookIdsPage`/`countVisibleBooks` below and
      // `SearchService.search()`, which calls those directly instead. Kept as a
      // defensive fallback, never exercised by real callers.
      const rows = await this.db.select({ id: books.id }).from(books).where(where);
      for (const row of rows) merge(row.id, {});
      return signals;
    }

    const digits = digitsOnly(trimmed);
    const isIsbnLike = digits.length === 10 || digits.length === 13;
    const intentCondition = buildIntentConditions(trimmed);

    // A transaction, not a plain connection query: `SET LOCAL pg_trgm.similarity_
    // threshold` only takes effect for the trigram `%` operator below within the
    // transaction that sets it, and must never leak to any other query sharing this
    // connection afterward. This was a real, measured fix, not a speculative one —
    // EXPLAIN ANALYZE at ~2,500-row scale showed `similarity(title, query) > floor`
    // never uses `books_title_trgm_idx` at all (Postgres only index-accelerates the
    // `%`/`<%`/`%>` trigram operators, not an arbitrary function-call comparison,
    // however numerically equivalent) — a full sequential scan, 6.7ms for a single
    // matching row in the 2,551-row test. Switching to `title % query` under a
    // `pg_trgm.similarity_threshold` matching `TRGM_SIMILARITY_FLOOR` let the planner
    // use the index automatically: 0.16ms for the identical query, a ~40x
    // improvement that will only matter more as the catalog grows toward its
    // ~5,000-book target. See docs/SEARCH.md §3.
    const [exactRows, ftsRows, titleTrgmRows, contributorTrgmRows, intentRows] = await this.db.transaction(async (tx) => {
      // `SET LOCAL` does not accept a bind parameter for its value (Postgres syntax
      // error) — `sql.raw()` is safe here specifically because `TRGM_SIMILARITY_FLOOR`
      // is a hardcoded module constant, never user input.
      await tx.execute(sql.raw(`SET LOCAL pg_trgm.similarity_threshold = ${TRGM_SIMILARITY_FLOOR}`));
      return Promise.all([
        // Exact/near-exact known-item hits — title equality/prefix, ISBN, exact
        // contributor/publisher name. Guaranteed candidates regardless of FTS/trgm.
        tx
          .select({ id: books.id })
          .from(books)
          .where(
            and(
              where,
              or(
                // The exact same canonical normalizer used to write `normalized_title`
                // at seed/backfill time (`normalizeTitle`, `lib/search/normalize.ts`) —
                // not a second, subtly different implementation. Phase 5 correction
                // pass: this previously compared against a bare `trimmed.toLowerCase()`,
                // so a query still carrying its leading article ("The Very Hungry
                // Caterpillar") failed to exact-match the stored, article-stripped
                // `normalized_title` ("very hungry caterpillar").
                eq(books.normalizedTitle, normalizeTitle(trimmed)),
                sql`${books.title} ilike ${trimmed + "%"}`,
                isIsbnLike ? eq(books.isbn13, digits) : sql`false`,
                isIsbnLike ? eq(books.isbn10, digits) : sql`false`,
                sql`exists (select 1 from ${bookContributors}
                  inner join ${contributors} on ${contributors.id} = ${bookContributors.contributorId}
                  where ${bookContributors.bookId} = ${books.id} and lower(${contributors.name}) = ${trimmed.toLowerCase()})`,
                sql`exists (select 1 from ${publishers}
                  where ${publishers.id} = ${books.publisherId} and lower(${publishers.name}) = ${trimmed.toLowerCase()})`
              )
            )
          )
          .limit(EXACT_CANDIDATE_LIMIT),
        // Full-text candidates, ranked by Postgres' own relevance score.
        //
        // Deliberately OR (`|`), not `plainto_tsquery`'s implicit AND: a teacher's
        // free-text query like "animal books with real photos" is a description, not a
        // set of mandatory keywords, and no single book's `search_text` need contain
        // every one of those words verbatim (e.g. the literal word "book" appears in no
        // book's own document). An AND query was verified directly against the dev DB to
        // return zero rows for this exact phrase even though multiple real-photography
        // animal books exist; rebuilding the tsquery as an OR of the same stemmed
        // lexemes surfaces them correctly, with `ts_rank` (which rewards matching more
        // of the query's terms) still ranking a book matching all five words above one
        // matching only one. `tsvector_to_array(to_tsvector(...))` reuses Postgres' own
        // English stemming/stopword removal to build the lexeme list, so "photos" and
        // "photo" and "photography" still align the way FTS normally aligns them.
        tx
          .select({ id: books.id, rank: sql<number>`ts_rank(${books.searchVector}, ${orTsQuery(trimmed)})` })
          .from(books)
          .where(and(where, sql`${books.searchVector} @@ ${orTsQuery(trimmed)}`, ftsHasMeaningfulOverlap(trimmed)))
          .orderBy(sql`ts_rank(${books.searchVector}, ${orTsQuery(trimmed)}) desc`)
          .limit(FTS_CANDIDATE_LIMIT),
        // Trigram candidates — typo/fuzzy tolerance FTS' exact-lexeme matching misses.
        // Compared against `title` (and, separately, contributor names below), never
        // the full `search_text` — a short misspelled word diluted against a long
        // multi-field document scores near zero even for the correct book (verified
        // directly; see the constant's own comment above). The `%` operator (not
        // `similarity() > floor`) is what actually lets the planner use
        // `books_title_trgm_idx` — see this method's own comment above.
        tx
          .select({ id: books.id, sim: sql<number>`similarity(${books.title}, ${trimmed})` })
          .from(books)
          .where(and(where, sql`${books.title} % ${trimmed}`))
          .orderBy(sql`similarity(${books.title}, ${trimmed}) desc`)
          .limit(TRGM_CANDIDATE_LIMIT),
        tx
          .select({ id: bookContributors.bookId, sim: sql<number>`similarity(${contributors.name}, ${trimmed})` })
          .from(bookContributors)
          .innerJoin(contributors, eq(contributors.id, bookContributors.contributorId))
          .innerJoin(books, eq(books.id, bookContributors.bookId))
          .where(and(where, sql`${contributors.name} % ${trimmed}`))
          .orderBy(sql`similarity(${contributors.name}, ${trimmed}) desc`)
          .limit(TRGM_CANDIDATE_LIMIT),
        // Structured free-text intent (age/duration/language/illustration-style/visual-
        // realism phrases) — a real Phase 2–4 capability that must keep working even
        // when a query shares no literal vocabulary with a matching book (see
        // `buildIntentConditions`'s own comment for the regression this fixes).
        intentCondition
          ? tx.select({ id: books.id }).from(books).where(and(where, intentCondition)).limit(INTENT_CANDIDATE_LIMIT)
          : Promise.resolve([]),
      ]);
    });

    for (const row of exactRows) merge(row.id, { exactMatch: true });
    for (const row of ftsRows) merge(row.id, { ftsRank: Number(row.rank) });
    for (const row of titleTrgmRows) merge(row.id, { trgmSimilarity: Number(row.sim) });
    for (const row of contributorTrgmRows) {
      const existing = signals.get(row.id);
      const sim = Number(row.sim);
      if (!existing || sim > existing.trgmSimilarity) merge(row.id, { trgmSimilarity: sim });
    }
    // Intent candidates contribute no retrieval signal of their own (no exact/FTS/
    // trgm/vector bump) — merely membership in the candidate set, so the unchanged
    // deterministic `scoreBook()` intent bonus (rank.ts) is what actually scores them.
    for (const row of intentRows) merge(row.id, {});

    if (params.queryEmbedding) {
      const vectorLiteral = `[${params.queryEmbedding.join(",")}]`;
      const vectorRows = await this.db
        .select({ id: books.id, distance: sql<number>`${books.embedding} <=> ${vectorLiteral}::vector` })
        .from(books)
        .where(and(where, isNotNull(books.embedding)))
        .orderBy(sql`${books.embedding} <=> ${vectorLiteral}::vector asc`)
        .limit(VECTOR_CANDIDATE_LIMIT);
      for (const row of vectorRows) merge(row.id, { vectorDistance: Number(row.distance) });
    }

    return signals;
  }

  /**
   * Queryless (filter-only) browsing — Phase 5 correction pass. Previously,
   * `SearchService` called `findCandidates()` for an empty query (which selected
   * every matching book id, unbounded), projected all of them into full `Book`
   * objects, sorted the entire set in memory, and only then sliced to the requested
   * `limit` — a filter-only search, and every "Show More" click on one, silently
   * re-did that full retrieval/projection every time. This method does the
   * ordering and limiting in SQL instead: `ORDER BY sort_title LIMIT (limit + 1)` —
   * one extra row, never fetched into the final page, just enough to answer
   * `hasMore` without a separate count-vs-limit comparison. No `OFFSET`: `limit`
   * here is always "how many total to show so far" (5, then 15, then 25, …, via
   * `RESULT_LIMIT_STEP`), matching exactly how the with-query path's
   * `.slice(0, limit)` already behaves — an increasing bounded limit, not
   * page-by-page offset pagination, is a deliberate, documented choice at this
   * catalog's target scale (docs/SEARCH.md §7).
   */
  async findVisibleBookIdsPage(params: { filters: Filters; limit: number }): Promise<{ ids: string[]; hasMore: boolean }> {
    const where = and(...buildHardFilterConditions(params.filters));
    const rows = await this.db
      .select({ id: books.id })
      .from(books)
      .where(where)
      .orderBy(books.sortTitle)
      .limit(params.limit + 1);
    const hasMore = rows.length > params.limit;
    return { ids: rows.slice(0, params.limit).map((r) => r.id), hasMore };
  }

  /** The exact total count of visible books matching the current hard filters —
   * a real `COUNT(*)`, not a candidate-pool size. Only meaningful (and only ever
   * called) for queryless/filter-only browsing: a free-text query's "how many
   * qualify" figure is intentionally the size of its bounded, scored candidate
   * pool instead (docs/SEARCH.md §7 — computing a literal catalog-wide count for a
   * ranked free-text query would require scoring the whole catalog, exactly what
   * this architecture exists to avoid). */
  async countVisibleBooks(filters: Filters): Promise<number> {
    const where = and(...buildHardFilterConditions(filters));
    const [row] = await this.db.select({ count: sql<number>`count(*)::int` }).from(books).where(where);
    return row?.count ?? 0;
  }

  /** Facet options + counts over the full active/visible catalog, independent of
   * the current search's other active filters (docs/SEARCH.md §8 — "the simplest
   * behavior that's useful and predictable": the same choice Phase 2–4 already
   * made, just computed in SQL now instead of over a fully-loaded in-memory array). */
  async getVisibleBookFacetRows(): Promise<
    {
      languageCode: string;
      additionalLanguageCodes: string[];
      fictionStatus: string;
      format: string | null;
      visualMediaType: string[] | null;
      visualRealism: string | null;
      readDurationBand: string | null;
      physicalCategorySlug: string | null;
      authors: string[];
      illustrators: string[];
      publisherName: string | null;
    }[]
  > {
    const visible = eq(books.reviewStatus, TEACHER_VISIBLE_REVIEW_STATUS);
    const rows = await this.db
      .select({
        id: books.id,
        languageCode: books.languageCode,
        fictionStatus: books.fictionStatus,
        format: books.format,
        visualMediaType: books.visualMediaType,
        visualRealism: books.visualRealism,
        readDurationBand: books.readDurationBand,
        physicalCategorySlug: physicalCategories.slug,
        publisherName: publishers.name,
      })
      .from(books)
      .leftJoin(physicalCategories, eq(physicalCategories.id, books.physicalCategoryId))
      .leftJoin(publishers, eq(publishers.id, books.publisherId))
      .where(visible);

    const ids = rows.map((r) => r.id);
    const [languageRows, contributorRows] = await Promise.all([
      ids.length > 0
        ? this.db.select({ bookId: bookLanguages.bookId, languageCode: bookLanguages.languageCode }).from(bookLanguages).where(inArray(bookLanguages.bookId, ids))
        : Promise.resolve([]),
      ids.length > 0
        ? this.db
            .select({ bookId: bookContributors.bookId, role: bookContributors.role, name: contributors.name })
            .from(bookContributors)
            .innerJoin(contributors, eq(contributors.id, bookContributors.contributorId))
            .where(inArray(bookContributors.bookId, ids))
        : Promise.resolve([]),
    ]);

    const additionalLangsByBook = new Map<string, string[]>();
    for (const row of languageRows) {
      const list = additionalLangsByBook.get(row.bookId) ?? [];
      list.push(row.languageCode);
      additionalLangsByBook.set(row.bookId, list);
    }
    const authorsByBook = new Map<string, string[]>();
    const illustratorsByBook = new Map<string, string[]>();
    for (const row of contributorRows) {
      const target = row.role === "author" ? authorsByBook : row.role === "illustrator" ? illustratorsByBook : null;
      if (!target) continue;
      const list = target.get(row.bookId) ?? [];
      list.push(row.name);
      target.set(row.bookId, list);
    }

    return rows.map((row) => ({
      languageCode: row.languageCode,
      additionalLanguageCodes: additionalLangsByBook.get(row.id) ?? [],
      fictionStatus: row.fictionStatus,
      format: row.format,
      visualMediaType: row.visualMediaType,
      visualRealism: row.visualRealism,
      readDurationBand: row.readDurationBand,
      physicalCategorySlug: row.physicalCategorySlug,
      authors: authorsByBook.get(row.id) ?? [],
      illustrators: illustratorsByBook.get(row.id) ?? [],
      publisherName: row.publisherName,
    }));
  }

  /**
   * Bounded, server-side autocomplete over the active/visible catalog only
   * (docs/SEARCH.md §6) — never the full catalog shipped to the browser. Prefix
   * matches are asked for first and given priority by the caller; this method just
   * returns real distinct catalog values matching the query as a prefix or substring.
   *
   * Phase 5 correction pass: this previously queried only title/author/illustrator/
   * publisher/category — `AutocompleteRow`'s own type always declared "topic" and
   * "language" as real suggestion types, but nothing ever produced them. Added here:
   * tag/topic values (from `tags`, scoped to visible books via `book_tags`) and
   * language display names (from the centralized ISO 639-1 registry, scoped to
   * whichever codes — primary via `books.language_code` OR additional via
   * `book_languages` — actually appear on a visible book). A tag or language used
   * only by a pending/archived book must never surface here; an additional-language-
   * only value (never any visible book's primary language) must still surface.
   */
  async autocomplete(query: string, limit: number): Promise<AutocompleteRow[]> {
    const trimmed = query.trim();
    if (trimmed.length < 2) return [];
    const pattern = `%${trimmed}%`;
    const visible = eq(books.reviewStatus, TEACHER_VISIBLE_REVIEW_STATUS);

    const [titleRows, authorRows, illustratorRows, publisherRows, categoryRows, tagRows, visibleLanguageCodeRows] =
      await Promise.all([
        this.db
          .select({ value: books.title })
          .from(books)
          .where(and(visible, sql`${books.title} ilike ${pattern}`))
          .limit(limit),
        this.db
          .select({ value: contributors.name })
          .from(bookContributors)
          .innerJoin(contributors, eq(contributors.id, bookContributors.contributorId))
          .innerJoin(books, eq(books.id, bookContributors.bookId))
          .where(and(visible, eq(bookContributors.role, "author"), sql`${contributors.name} ilike ${pattern}`))
          .limit(limit),
        this.db
          .select({ value: contributors.name })
          .from(bookContributors)
          .innerJoin(contributors, eq(contributors.id, bookContributors.contributorId))
          .innerJoin(books, eq(books.id, bookContributors.bookId))
          .where(and(visible, eq(bookContributors.role, "illustrator"), sql`${contributors.name} ilike ${pattern}`))
          .limit(limit),
        this.db
          .select({ value: publishers.name })
          .from(publishers)
          .innerJoin(books, eq(books.publisherId, publishers.id))
          .where(and(visible, sql`${publishers.name} ilike ${pattern}`))
          .limit(limit),
        this.db
          .select({ value: physicalCategories.label })
          .from(physicalCategories)
          .innerJoin(books, eq(books.physicalCategoryId, physicalCategories.id))
          .where(and(visible, sql`${physicalCategories.label} ilike ${pattern}`))
          .limit(limit),
        this.db
          .selectDistinct({ value: tags.name })
          .from(tags)
          .innerJoin(bookTags, eq(bookTags.tagId, tags.id))
          .innerJoin(books, eq(books.id, bookTags.bookId))
          .where(and(visible, sql`${tags.name} ilike ${pattern}`))
          .limit(limit),
        // Language display names live only in the TS registry, not the database, so
        // matching by name has to happen in application code — but the *set* of
        // codes to check is still a small, SQL-bounded, visibility-scoped query
        // (distinct primary language codes UNION distinct additional-language codes
        // actually used by a visible book), never a full catalog scan.
        this.db
          .select({ code: books.languageCode })
          .from(books)
          .where(visible)
          .groupBy(books.languageCode)
          .union(
            this.db
              .selectDistinct({ code: bookLanguages.languageCode })
              .from(bookLanguages)
              .innerJoin(books, eq(books.id, bookLanguages.bookId))
              .where(visible)
          ),
      ]);

    const languageRows = Array.from(new Set(visibleLanguageCodeRows.map((r) => r.code)))
      .filter((code): code is LanguageCode => code in ISO_639_1_LANGUAGE_NAMES)
      .map((code) => ({ value: getLanguageName(code) }))
      .filter((row) => row.value.toLowerCase().includes(trimmed.toLowerCase()));

    const seen = new Set<string>();
    const results: AutocompleteRow[] = [];
    const add = (rows: { value: string }[], type: AutocompleteRow["type"]) => {
      for (const row of rows) {
        const key = `${type}:${row.value.toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        results.push({ value: row.value, type });
      }
    };
    add(titleRows, "title");
    add(authorRows, "author");
    add(illustratorRows, "illustrator");
    add(publisherRows, "publisher");
    add(categoryRows, "category");
    add(tagRows, "topic");
    add(languageRows, "language");
    return results;
  }
}
