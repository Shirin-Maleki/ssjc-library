ALTER TYPE "public"."provenance_source_type" ADD VALUE 'cover_visible' BEFORE 'human_corrected';--> statement-breakpoint
ALTER TABLE "ingestion_items" ADD COLUMN "intake_draft" jsonb;