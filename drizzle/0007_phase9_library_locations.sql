CREATE TYPE "public"."library_location_type" AS ENUM('corridor', 'classroom', 'other');--> statement-breakpoint
CREATE TABLE "library_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"display_name" text NOT NULL,
	"location_type" "library_location_type" DEFAULT 'other' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "library_locations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "book_copies" ADD COLUMN "current_location_id" uuid;--> statement-breakpoint
ALTER TABLE "book_copies" ADD CONSTRAINT "book_copies_current_location_id_library_locations_id_fk" FOREIGN KEY ("current_location_id") REFERENCES "public"."library_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "book_copies_current_location_idx" ON "book_copies" USING btree ("current_location_id");