CREATE TYPE "public"."availability_status" AS ENUM('on_shelf', 'in_classroom', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."confidence_level" AS ENUM('high', 'medium', 'low');--> statement-breakpoint
CREATE TYPE "public"."contributor_role" AS ENUM('author', 'illustrator', 'photographer', 'translator');--> statement-breakpoint
CREATE TYPE "public"."cover_source_type" AS ENUM('teacher_upload', 'bulk_import', 'external_thumbnail');--> statement-breakpoint
CREATE TYPE "public"."display_cover_source" AS ENUM('derived_from_drive', 'external_provider_thumbnail', 'drive_proxy_fallback');--> statement-breakpoint
CREATE TYPE "public"."duplicate_detected_by" AS ENUM('image_hash', 'isbn_match', 'title_author_match', 'admin_manual');--> statement-breakpoint
CREATE TYPE "public"."duplicate_relationship_type" AS ENUM('exact_copy_same_edition', 'same_title_different_edition', 'same_work_different_language', 'false_match', 'unresolved');--> statement-breakpoint
CREATE TYPE "public"."duplicate_status" AS ENUM('pending', 'confirmed', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."fiction_status" AS ENUM('fiction', 'nonfiction', 'unknown_mixed');--> statement-breakpoint
CREATE TYPE "public"."format" AS ENUM('board_book', 'picture_book', 'early_reader', 'chapter_book', 'informational_reference', 'activity_book', 'other');--> statement-breakpoint
CREATE TYPE "public"."ingestion_item_status" AS ENUM('pending', 'processing', 'completed', 'needs_review', 'failed', 'skipped_duplicate');--> statement-breakpoint
CREATE TYPE "public"."ingestion_job_status" AS ENUM('pending', 'running', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."ingestion_job_type" AS ENUM('single_add', 'bulk_import', 'reimport');--> statement-breakpoint
CREATE TYPE "public"."ingestion_source" AS ENUM('teacher_capture', 'admin_bulk_drive');--> statement-breakpoint
CREATE TYPE "public"."physical_size_exception" AS ENUM('regular', 'board_small', 'oversized_big');--> statement-breakpoint
CREATE TYPE "public"."provenance_source_type" AS ENUM('external_provider', 'ai_inferred', 'human_corrected', 'human_verified');--> statement-breakpoint
CREATE TYPE "public"."read_duration_band" AS ENUM('under_5', 'five_to_ten', 'ten_plus');--> statement-breakpoint
CREATE TYPE "public"."review_flag_status" AS ENUM('open', 'resolved', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."review_flag_type" AS ENUM('user_flagged', 'low_identification_confidence', 'duplicate_uncertain', 'metadata_conflict', 'category_uncertain', 'missing_metadata', 'visual_style_uncertain', 'import_error', 'teacher_requested_review');--> statement-breakpoint
CREATE TYPE "public"."review_status" AS ENUM('pending_review', 'active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."sheet_sync_status" AS ENUM('pending', 'synced', 'failed');--> statement-breakpoint
CREATE TYPE "public"."tag_family" AS ENUM('topic', 'theme', 'social_emotional', 'curriculum', 'concept', 'visual_subject', 'seasonal', 'featured');--> statement-breakpoint
CREATE TYPE "public"."taxonomy_suggestion_status" AS ENUM('pending', 'approved', 'rejected', 'merged', 'postponed');--> statement-breakpoint
CREATE TYPE "public"."visual_media_type" AS ENUM('photography', 'watercolor', 'collage', 'digital_illustration', 'pencil', 'ink', 'painted', 'mixed_media', 'graphic_vector', 'other', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."visual_realism" AS ENUM('real_photography', 'realistic_illustration', 'stylized_illustration', 'cartoon', 'abstract', 'mixed', 'unknown');--> statement-breakpoint
CREATE TABLE "publishers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "publishers_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "physical_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"label" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "physical_categories_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "books" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"subtitle" text,
	"normalized_title" text NOT NULL,
	"sort_title" text NOT NULL,
	"short_description" text,
	"language_code" text NOT NULL,
	"fiction_status" "fiction_status" DEFAULT 'unknown_mixed' NOT NULL,
	"age_min_months" smallint,
	"age_max_months" smallint,
	"read_aloud_minutes_estimate" numeric(4, 1),
	"read_duration_band" "read_duration_band",
	"format" "format",
	"physical_size_exception" "physical_size_exception" DEFAULT 'regular' NOT NULL,
	"visual_media_type" "visual_media_type"[],
	"visual_realism" "visual_realism",
	"publisher_id" uuid,
	"imprint" text,
	"publication_year" smallint,
	"isbn_10" text,
	"isbn_13" text,
	"edition" text,
	"physical_category_id" uuid,
	"cover_drive_file_id" text,
	"cover_drive_folder_id" text,
	"cover_filename" text,
	"cover_mime_type" text,
	"cover_source_type" "cover_source_type",
	"display_cover_url" text,
	"display_cover_source" "display_cover_source",
	"review_status" "review_status" DEFAULT 'pending_review' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"verified_at" timestamp with time zone,
	CONSTRAINT "age_min_months_non_negative" CHECK ("books"."age_min_months" is null or "books"."age_min_months" >= 0),
	CONSTRAINT "age_max_months_upper_bound" CHECK ("books"."age_max_months" is null or "books"."age_max_months" <= 216),
	CONSTRAINT "age_min_le_max" CHECK ("books"."age_min_months" is null or "books"."age_max_months" is null or "books"."age_min_months" <= "books"."age_max_months")
);
--> statement-breakpoint
CREATE TABLE "book_contributors" (
	"book_id" uuid NOT NULL,
	"contributor_id" uuid NOT NULL,
	"role" "contributor_role" NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	CONSTRAINT "book_contributors_book_id_contributor_id_role_pk" PRIMARY KEY("book_id","contributor_id","role")
);
--> statement-breakpoint
CREATE TABLE "contributors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contributors_normalized_name_unique" UNIQUE("normalized_name")
);
--> statement-breakpoint
CREATE TABLE "book_languages" (
	"book_id" uuid NOT NULL,
	"language_code" text NOT NULL,
	CONSTRAINT "book_languages_book_id_language_code_pk" PRIMARY KEY("book_id","language_code")
);
--> statement-breakpoint
CREATE TABLE "book_tags" (
	"book_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	CONSTRAINT "book_tags_book_id_tag_id_pk" PRIMARY KEY("book_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"family" "tag_family",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tags_normalized_name_unique" UNIQUE("normalized_name")
);
--> statement-breakpoint
CREATE TABLE "book_field_provenance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" uuid NOT NULL,
	"field_key" text NOT NULL,
	"source_type" "provenance_source_type" NOT NULL,
	"source_label" text,
	"confidence" numeric(3, 2),
	"confidence_level" "confidence_level",
	"notes" text,
	"is_current" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "book_duplicates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id_a" uuid NOT NULL,
	"book_id_b" uuid NOT NULL,
	"relationship_type" "duplicate_relationship_type" DEFAULT 'unresolved' NOT NULL,
	"similarity_score" numeric(3, 2),
	"detected_by" "duplicate_detected_by" NOT NULL,
	"status" "duplicate_status" DEFAULT 'pending' NOT NULL,
	"resolved_by" text,
	"resolved_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" uuid NOT NULL,
	"flag_type" "review_flag_type" NOT NULL,
	"status" "review_flag_status" DEFAULT 'open' NOT NULL,
	"detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" text,
	"resolution_note" text
);
--> statement-breakpoint
CREATE TABLE "taxonomy_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"suggested_name" text NOT NULL,
	"reason" text NOT NULL,
	"supporting_book_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"status" "taxonomy_suggestion_status" DEFAULT 'pending' NOT NULL,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone,
	"reviewed_by" text
);
--> statement-breakpoint
CREATE TABLE "reading_list_items" (
	"list_id" uuid NOT NULL,
	"book_id" uuid NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text,
	CONSTRAINT "reading_list_items_list_id_book_id_pk" PRIMARY KEY("list_id","book_id")
);
--> statement-breakpoint
CREATE TABLE "reading_lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "book_copies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" uuid NOT NULL,
	"home_location" text,
	"current_location" text,
	"availability_status" "availability_status" DEFAULT 'on_shelf' NOT NULL,
	"acquired_at" timestamp with time zone,
	"source_ingestion_item_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "book_identity_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ingestion_item_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_identifier" text,
	"raw_response" jsonb,
	"match_confidence" numeric(3, 2),
	"was_selected" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingestion_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"drive_file_id" text NOT NULL,
	"content_hash" text,
	"perceptual_hash" text,
	"status" "ingestion_item_status" DEFAULT 'pending' NOT NULL,
	"review_reason" text,
	"resulting_copy_id" uuid,
	"error_message" text,
	"retry_count" smallint DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingestion_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_type" "ingestion_job_type" NOT NULL,
	"status" "ingestion_job_status" DEFAULT 'pending' NOT NULL,
	"source" "ingestion_source" NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"total_items" integer DEFAULT 0 NOT NULL,
	"processed_items" integer DEFAULT 0 NOT NULL,
	"failed_items" integer DEFAULT 0 NOT NULL,
	"skipped_items" integer DEFAULT 0 NOT NULL,
	"config" jsonb,
	"created_by" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "metadata_provider_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"normalized_query" text NOT NULL,
	"response" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	CONSTRAINT "metadata_provider_cache_provider_query_unique" UNIQUE("provider","normalized_query")
);
--> statement-breakpoint
CREATE TABLE "book_sheet_sync" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" uuid NOT NULL,
	"sheet_row_number" integer,
	"last_synced_at" timestamp with time zone,
	"last_synced_content_hash" text,
	"sync_status" "sheet_sync_status" DEFAULT 'pending' NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "book_sheet_sync_book_id_unique" UNIQUE("book_id")
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_label" text NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "login_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"role" text NOT NULL,
	"succeeded" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"description" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "books" ADD CONSTRAINT "books_publisher_id_publishers_id_fk" FOREIGN KEY ("publisher_id") REFERENCES "public"."publishers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "books" ADD CONSTRAINT "books_physical_category_id_physical_categories_id_fk" FOREIGN KEY ("physical_category_id") REFERENCES "public"."physical_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_contributors" ADD CONSTRAINT "book_contributors_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_contributors" ADD CONSTRAINT "book_contributors_contributor_id_contributors_id_fk" FOREIGN KEY ("contributor_id") REFERENCES "public"."contributors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_languages" ADD CONSTRAINT "book_languages_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_tags" ADD CONSTRAINT "book_tags_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_tags" ADD CONSTRAINT "book_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_field_provenance" ADD CONSTRAINT "book_field_provenance_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_duplicates" ADD CONSTRAINT "book_duplicates_book_id_a_books_id_fk" FOREIGN KEY ("book_id_a") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_duplicates" ADD CONSTRAINT "book_duplicates_book_id_b_books_id_fk" FOREIGN KEY ("book_id_b") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_flags" ADD CONSTRAINT "review_flags_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_list_items" ADD CONSTRAINT "reading_list_items_list_id_reading_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."reading_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_list_items" ADD CONSTRAINT "reading_list_items_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_copies" ADD CONSTRAINT "book_copies_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_copies" ADD CONSTRAINT "book_copies_source_ingestion_item_id_ingestion_items_id_fk" FOREIGN KEY ("source_ingestion_item_id") REFERENCES "public"."ingestion_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_identity_candidates" ADD CONSTRAINT "book_identity_candidates_ingestion_item_id_ingestion_items_id_fk" FOREIGN KEY ("ingestion_item_id") REFERENCES "public"."ingestion_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_items" ADD CONSTRAINT "ingestion_items_job_id_ingestion_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."ingestion_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_items" ADD CONSTRAINT "ingestion_items_resulting_copy_id_book_copies_id_fk" FOREIGN KEY ("resulting_copy_id") REFERENCES "public"."book_copies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_sheet_sync" ADD CONSTRAINT "book_sheet_sync_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "books_isbn13_unique" ON "books" USING btree ("isbn_13") WHERE "books"."isbn_13" is not null;--> statement-breakpoint
CREATE INDEX "books_normalized_title_idx" ON "books" USING btree ("normalized_title");--> statement-breakpoint
CREATE INDEX "books_physical_category_idx" ON "books" USING btree ("physical_category_id");--> statement-breakpoint
CREATE INDEX "books_publisher_idx" ON "books" USING btree ("publisher_id");--> statement-breakpoint
CREATE INDEX "books_review_status_idx" ON "books" USING btree ("review_status");--> statement-breakpoint
CREATE INDEX "book_contributors_contributor_idx" ON "book_contributors" USING btree ("contributor_id");--> statement-breakpoint
CREATE INDEX "contributors_normalized_name_idx" ON "contributors" USING btree ("normalized_name");--> statement-breakpoint
CREATE INDEX "book_languages_language_idx" ON "book_languages" USING btree ("language_code");--> statement-breakpoint
CREATE INDEX "book_tags_tag_idx" ON "book_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "tags_family_idx" ON "tags" USING btree ("family");--> statement-breakpoint
CREATE UNIQUE INDEX "book_field_provenance_current_unique" ON "book_field_provenance" USING btree ("book_id","field_key") WHERE "book_field_provenance"."is_current" = true;--> statement-breakpoint
CREATE INDEX "book_field_provenance_book_idx" ON "book_field_provenance" USING btree ("book_id");--> statement-breakpoint
CREATE INDEX "book_duplicates_book_a_idx" ON "book_duplicates" USING btree ("book_id_a");--> statement-breakpoint
CREATE INDEX "book_duplicates_book_b_idx" ON "book_duplicates" USING btree ("book_id_b");--> statement-breakpoint
CREATE INDEX "review_flags_book_idx" ON "review_flags" USING btree ("book_id");--> statement-breakpoint
CREATE INDEX "review_flags_status_idx" ON "review_flags" USING btree ("status");--> statement-breakpoint
CREATE INDEX "book_copies_book_idx" ON "book_copies" USING btree ("book_id");--> statement-breakpoint
CREATE INDEX "book_identity_candidates_item_idx" ON "book_identity_candidates" USING btree ("ingestion_item_id");--> statement-breakpoint
CREATE INDEX "ingestion_items_job_idx" ON "ingestion_items" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "ingestion_items_status_idx" ON "ingestion_items" USING btree ("status");--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "login_attempts_identifier_role_created_idx" ON "login_attempts" USING btree ("identifier","role","created_at");