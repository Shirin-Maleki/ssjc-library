import { check, index, numeric, pgTable, smallint, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
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

/**
 * The bibliographic/edition-level catalog record (docs/DATA_MODEL.md §2) — one row per
 * distinct edition, regardless of how many physical copies the school owns (see
 * `book_copies` in `ingestion.ts`, kept deliberately separate — never add a copy
 * counter or location column back here).
 *
 * Two intentional, documented deviations from the original Phase 0 draft (both in
 * docs/DECISIONS.md):
 * 1. `visual_media_type` is an ARRAY of the enum, not a single value — a book's
 *    illustration style has always genuinely been multi-valued in the real fixture
 *    catalog (e.g. "collage" + "painted"), and Phase 2's search/UI already depends on
 *    that. This is a persistence-representation correction only; the domain
 *    projection (`src/db/repositories/bookRepository.ts`) reconstructs the exact same
 *    `illustrationStyles: IllustrationStyle[]` shape the search engine already expects,
 *    so no search code changes.
 * 2. The `embedding`/`embedding_source_hash`/`embedding_generated_at` columns from the
 *    Phase 0 draft are NOT created here — the embedding provider and dimension remain
 *    genuinely undecided (Phase 5), and a placeholder dimension would misrepresent a
 *    real decision as already made. This is an intentional, additive Phase 5 migration,
 *    not an oversight — see docs/DATA_MODEL.md's changelog.
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
     * `src/lib/constants/languages.ts` — deliberately no FK/reference table, per
     * docs/DATA_MODEL.md §3 (the Phase 0 review's removal of the `languages` table). */
    languageCode: text("language_code").notNull(),

    fictionStatus: fictionStatusEnum("fiction_status").notNull().default("unknown_mixed"),

    /** Whole months; nullable independently in either direction — see §4/§17 and
     * `src/lib/catalog/age.ts`. Never displayed to a teacher directly. */
    ageMinMonths: smallint("age_min_months"),
    ageMaxMonths: smallint("age_max_months"),

    readAloudMinutesEstimate: numeric("read_aloud_minutes_estimate", { precision: 4, scale: 1 }),
    readDurationBand: readDurationBandEnum("read_duration_band"),

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
  ]
);
