import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import {
  availabilityStatusEnum,
  ingestionItemStatusEnum,
  ingestionJobStatusEnum,
  ingestionJobTypeEnum,
  ingestionSourceEnum,
} from "./enums";
import { books } from "./books";

/**
 * `book_copies` and the ingestion tables live in one file specifically because they
 * mutually reference each other (`book_copies.source_ingestion_item_id` ↔
 * `ingestion_items.resulting_copy_id`, docs/DATA_MODEL.md §2/§10) — keeping both sides
 * of a genuine circular FK in the same module avoids a circular file import while
 * preserving both approved columns (each captures a slightly different direction of
 * provenance: which item produced this copy vs. which copy this item's processing
 * resulted in). Both use the lazy `AnyPgColumn` thunk form Drizzle requires for
 * forward/circular references.
 */

/** Physical instances the school owns of a given book/edition — see `books.ts` for why
 * this is a separate table from `books` (never add a copy counter or location column
 * back there; "Copies: N" is always `count(*)` on this table). */
export const bookCopies = pgTable(
  "book_copies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookId: uuid("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    homeLocation: text("home_location"),
    currentLocation: text("current_location"),
    availabilityStatus: availabilityStatusEnum("availability_status").notNull().default("on_shelf"),
    acquiredAt: timestamp("acquired_at", { withTimezone: true }),
    sourceIngestionItemId: uuid("source_ingestion_item_id").references(
      (): AnyPgColumn => ingestionItems.id
    ),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("book_copies_book_idx").on(table.bookId)]
);

export const ingestionJobs = pgTable("ingestion_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  jobType: ingestionJobTypeEnum("job_type").notNull(),
  status: ingestionJobStatusEnum("status").notNull().default("pending"),
  source: ingestionSourceEnum("source").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  totalItems: integer("total_items").notNull().default(0),
  processedItems: integer("processed_items").notNull().default(0),
  failedItems: integer("failed_items").notNull().default(0),
  skippedItems: integer("skipped_items").notNull().default(0),
  config: jsonb("config"),
  createdBy: text("created_by"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** One row per image processed within a job. `resultingCopyId` replaces an earlier
 * `resulting_book_id` (docs/DATA_MODEL.md §10) — an ingestion event fundamentally
 * registers one physical copy encounter; the bibliographic record is reachable via
 * `book_copies.book_id`. */
export const ingestionItems = pgTable(
  "ingestion_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => ingestionJobs.id, { onDelete: "cascade" }),
    driveFileId: text("drive_file_id").notNull(),
    contentHash: text("content_hash"),
    perceptualHash: text("perceptual_hash"),
    status: ingestionItemStatusEnum("status").notNull().default("pending"),
    reviewReason: text("review_reason"),
    /**
     * The versioned, validated Phase 7 intake draft (`docs/AI_PIPELINE.md` §"Review
     * Later persistence") — everything needed to RESUME a single-book intake without
     * re-uploading or re-running provider calls: confirmed Drive source metadata,
     * validated cover-identification evidence, normalized metadata candidates, the
     * reconciliation result, duplicate-candidate outcome, enrichment suggestions,
     * category suggestion, and any teacher edits already made. Shaped by
     * `src/lib/intake/draft.ts`'s `IntakeDraftSchema` (Zod-validated on every write,
     * never an arbitrary raw AI response dump) — `schemaVersion` inside the object
     * lets a future reader detect an old shape. Never contains: secrets, image
     * bytes, a resumable upload session URI, or verbose raw model prose — see that
     * schema's own doc comment for the exact boundary.
     */
    intakeDraft: jsonb("intake_draft"),
    resultingCopyId: uuid("resulting_copy_id").references((): AnyPgColumn => bookCopies.id),
    errorMessage: text("error_message"),
    retryCount: smallint("retry_count").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("ingestion_items_job_idx").on(table.jobId), index("ingestion_items_status_idx").on(table.status)]
);

/** Every metadata-provider candidate considered for a given ingestion item, retained
 * for audit (docs/DATA_MODEL.md §10) — "reconcile candidates, don't blindly take the
 * first result." Column shape is this project's own reasonable design: the Phase 0
 * document itself says this table is "unchanged from the first draft" without
 * reproducing that draft's exact columns, so these are filled in consistently with its
 * stated purpose and the schema's general conventions — see docs/DECISIONS.md. */
export const bookIdentityCandidates = pgTable(
  "book_identity_candidates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ingestionItemId: uuid("ingestion_item_id")
      .notNull()
      .references(() => ingestionItems.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    providerIdentifier: text("provider_identifier"),
    rawResponse: jsonb("raw_response"),
    matchConfidence: numeric("match_confidence", { precision: 3, scale: 2 }),
    wasSelected: boolean("was_selected").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("book_identity_candidates_item_idx").on(table.ingestionItemId)]
);

/** Provider responses cached by normalized query, for cost/rate-limit control during
 * bulk import (docs/DATA_MODEL.md §10). Same "unchanged from first draft, columns
 * filled in reasonably" note as `book_identity_candidates` above. */
export const metadataProviderCache = pgTable(
  "metadata_provider_cache",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").notNull(),
    normalizedQuery: text("normalized_query").notNull(),
    response: jsonb("response").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (table) => [unique("metadata_provider_cache_provider_query_unique").on(table.provider, table.normalizedQuery)]
);
