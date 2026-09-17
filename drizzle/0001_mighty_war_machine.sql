CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
ALTER TABLE "books" drop column "read_duration_band";--> statement-breakpoint
ALTER TABLE "books" ADD COLUMN "read_duration_band" "read_duration_band" GENERATED ALWAYS AS (case
          when "books"."read_aloud_minutes_estimate" is null then null
          when "books"."read_aloud_minutes_estimate" < 5 then 'under_5'::read_duration_band
          when "books"."read_aloud_minutes_estimate" <= 10 then 'five_to_ten'::read_duration_band
          else 'ten_plus'::read_duration_band
        end) STORED;--> statement-breakpoint
ALTER TABLE "books" ADD COLUMN "search_text" text;--> statement-breakpoint
ALTER TABLE "books" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', coalesce("books"."search_text", ''))) STORED;--> statement-breakpoint
ALTER TABLE "books" ADD COLUMN "embedding" vector(768);--> statement-breakpoint
ALTER TABLE "books" ADD COLUMN "embedding_model" text;--> statement-breakpoint
ALTER TABLE "books" ADD COLUMN "embedding_dimension" smallint;--> statement-breakpoint
ALTER TABLE "books" ADD COLUMN "embedding_composition_version" smallint;--> statement-breakpoint
ALTER TABLE "books" ADD COLUMN "embedding_source_hash" text;--> statement-breakpoint
ALTER TABLE "books" ADD COLUMN "embedding_generated_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "books_search_vector_idx" ON "books" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "books_search_text_trgm_idx" ON "books" USING gin ("search_text" gin_trgm_ops);