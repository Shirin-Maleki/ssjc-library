import { check, customType, index, numeric, pgTable, smallint, text, timestamp, uniqueIndex, uuid, vector } from "drizzle-orm/pg-core";
import { sql, type SQL } from "drizzle-orm";
import {
  coverSourceTypeEnum,
  displayCoverSourceEnum,
  fictionStatusEnum,
  formatEnum,
  physicalSizeExceptionEnum,
  readDurationBandEnum,
  reviewStatusEnum,
  visualMediaTypeEnum,
  visualRealismEnum,
} from "./enums";
import { publishers } from "./publishers";
import { physicalCategories } from "./categories";

/** Postgres' native full-text-search type — Drizzle has no built-in `tsvector`
 * column, so this is a thin `customType` wrapper (Phase 5, `docs/SEARCH.md` §3).
 * Application code never reads this column's value back into JS (`data: string` is
 * never actually exercised) — it exists purely so SQL can `@@`/`ts_rank` against it. */
const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

/** The embedding-dimension storage contract (Phase 5, `docs/SEARCH.md` §5 /
 * `docs/DECISIONS.md`) — 768, matching Gemini's `gemini-embedding-2` output.
 * Changing this to an incompatible model/dimension requires re-embedding the entire
 * catalog (`npm run embeddings:generate -- --all`), never a silent reinterpretation
 * of existing vectors. */
export const EMBEDDING_DIMENSIONS = 768;

/**
 * The bibliographic/edition-level catalog record (docs/DATA_MODEL.md §2) — one row per
 * distinct edition, regardless of how many physical copies the school owns (see
 * `book_copies` in `ingestion.ts`, kept deliberately separate — never add a copy
 * counter or location column back here).
 *
 * Three intentional, documented deviations from the original Phase 0 draft (all in
 * docs/DECISIONS.md):
 * 1. `visual_media_type` is an ARRAY of the enum, not a single value (Phase 4).
 * 2. `embedding`/`embedding_*` columns (Phase 5, below) — deferred through Phase 4,
 *    implemented now with a real, documented 768-dimension contract.
 * 3. `search_text` / `search_vector` / trigram indexing (Phase 5) — the searchable
 *    representation for PostgreSQL full-text and fuzzy retrieval (`docs/SEARCH.md`).
 */
export const books = pgTable(
  "books",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    subtitle: text("subtitle"),
    normalizedTitle: text("normalized_title").notNull(),
    sortTitle: text("sort_title").notNull(),
    shortDescription: text("short_description"),

    /** ISO 639-1, validated at the application layer against
     * `src/lib/catalog/languages.ts` — deliberately no FK/reference table, per
     * docs/DATA_MODEL.md §3 (the Phase 0 review's removal of the `languages` table). */
    languageCode: text("language_code").notNull(),

    fictionStatus: fictionStatusEnum("fiction_status").notNull().default("unknown_mixed"),

    /** Whole months; nullable independently in either direction — see §4/§17 and
     * `src/lib/catalog/age.ts`. Never displayed to a teacher directly. */
    ageMinMonths: smallint("age_min_months"),
    ageMaxMonths: smallint("age_max_months"),

    readAloudMinutesEstimate: numeric("read_aloud_minutes_estimate", { precision: 4, scale: 1 }),
    /** Phase 5 correction: a GENERATED column derived from
     * `read_aloud_minutes_estimate`, not an independently-writable value — this is
     * the single duration-band authority (`docs/DECISIONS.md`, "One duration-band
     * authority"). `src/lib/catalog/duration.ts`'s `getReadDurationBand()` must
     * produce identical results for any in-memory (non-DB) `Book`; an integration
     * test asserts the two never disagree. NULL when the estimate itself is NULL —
     * never silently banded as "under_5". */
    readDurationBand: readDurationBandEnum("read_duration_band").generatedAlwaysAs(
      // Each branch casts its own literal to the enum type — Postgres rejects a
      // single cast wrapped around the whole CASE as "not immutable" (verified
      // directly; see docs/DECISIONS.md, "One duration-band authority").
      (): SQL =>
        sql`case
          when ${books.readAloudMinutesEstimate} is null then null
          when ${books.readAloudMinutesEstimate} < 5 then 'under_5'::read_duration_band
          when ${books.readAloudMinutesEstimate} <= 10 then 'five_to_ten'::read_duration_band
          else 'ten_plus'::read_duration_band
        end`
    ),

    format: formatEnum("format"),
    physicalSizeException: physicalSizeExceptionEnum("physical_size_exception").notNull().default("regular"),

    visualMediaType: visualMediaTypeEnum("visual_media_type").array(),
    visualRealism: visualRealismEnum("visual_realism"),

    publisherId: uuid("publisher_id").references(() => publishers.id),
    imprint: text("imprint"),
    publicationYear: smallint("publication_year"),
    isbn10: text("isbn_10"),
    isbn13: text("isbn_13"),
    edition: text("edition"),

    physicalCategoryId: uuid("physical_category_id").references(() => physicalCategories.id),

    // Original capture — see docs/DATA_MODEL.md §5. Never rendered directly to a
    // browser; Phase 6+ concern, columns exist now per the approved schema.
    coverDriveFileId: text("cover_drive_file_id"),
    coverDriveFolderId: text("cover_drive_folder_id"),
    coverFilename: text("cover_filename"),
    coverMimeType: text("cover_mime_type"),
    coverSourceType: coverSourceTypeEnum("cover_source_type"),

    // Display cover — deliberately distinct from the original capture above.
    displayCoverUrl: text("display_cover_url"),
    displayCoverSource: displayCoverSourceEnum("display_cover_source"),

    reviewStatus: reviewStatusEnum("review_status").notNull().default("pending_review"),

    /** Phase 5: the deterministic, denormalized searchable-text representation
     * (`docs/SEARCH.md` §3) — includes joined data (contributors, tags, publisher,
     * category label, language names) a Postgres GENERATED column cannot reach, so
     * this is maintained by the seed script / a future admin-edit hook, not the
     * database itself. `search_vector` below IS a real generated column, derived
     * from this single-row text. */
    searchText: text("search_text"),
    searchVector: tsvector("search_vector").generatedAlwaysAs(
      (): SQL => sql`to_tsvector('english', coalesce(${books.searchText}, ''))`
    ),

    /** Phase 5 semantic retrieval (`docs/SEARCH.md` §5, `docs/DECISIONS.md`) — all
     * nullable: a book with no embedding yet (or ever, if no provider is configured)
     * simply never contributes a semantic signal, never a fabricated one. */
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }),
    embeddingModel: text("embedding_model"),
    embeddingDimension: smallint("embedding_dimension"),
    /** Bumped whenever `src/lib/embeddings/document.ts`'s composition changes what
     * text actually gets embedded — lets the backfill script detect "stale", not
     * just "missing". */
    embeddingCompositionVersion: smallint("embedding_composition_version"),
    /** A hash of the exact composed document text last embedded — the precise
     * "would re-generating produce a different input" check, independent of the
     * composition version bump above. */
    embeddingSourceHash: text("embedding_source_hash"),
    embeddingGeneratedAt: timestamp("embedding_generated_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
  },
  (table) => [
    // Real invariants only — never block a legitimately incomplete imported record.
    check("age_min_months_non_negative", sql`${table.ageMinMonths} is null or ${table.ageMinMonths} >= 0`),
    check("age_max_months_upper_bound", sql`${table.ageMaxMonths} is null or ${table.ageMaxMonths} <= 216`),
    check(
      "age_min_le_max",
      sql`${table.ageMinMonths} is null or ${table.ageMaxMonths} is null or ${table.ageMinMonths} <= ${table.ageMaxMonths}`
    ),
    // Partial unique index: only enforced when an ISBN-13 is actually present —
    // imported records without one must not collide with each other on NULL.
    uniqueIndex("books_isbn13_unique").on(table.isbn13).where(sql`${table.isbn13} is not null`),
    index("books_normalized_title_idx").on(table.normalizedTitle),
    index("books_physical_category_idx").on(table.physicalCategoryId),
    index("books_publisher_idx").on(table.publisherId),
    index("books_review_status_idx").on(table.reviewStatus),
    // Phase 5 retrieval indexes — see docs/SEARCH.md §3/§7 for what queries each
    // supports and why no ANN (ivfflat/hnsw) index exists yet for `embedding`.
    index("books_search_vector_idx").using("gin", table.searchVector),
    // Trigram fuzzy matching (searchRepository.ts) compares against `title`
    // directly, not `search_text` — see `TRGM_SIMILARITY_FLOOR`'s own comment for
    // why. The index must therefore be on `title`, not `search_text`: a real,
    // EXPLAIN-ANALYZE-verified gap found at ~2,500-row scale (Phase 5's own
    // due-diligence testing, not the 48-row dev seed) — the trigram query was doing
    // a full sequential scan (~12ms and rising linearly with catalog size) because
    // the only trigram index that existed indexed the wrong column. See
    // docs/SEARCH.md §3.
    index("books_title_trgm_idx").using("gin", sql`${table.title} gin_trgm_ops`),
  ]
);
