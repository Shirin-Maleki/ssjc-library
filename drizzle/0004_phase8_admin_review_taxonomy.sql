ALTER TABLE "physical_categories" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "physical_categories" ADD COLUMN "display_order" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "taxonomy_suggestions" ADD COLUMN "resolved_category_id" uuid;--> statement-breakpoint
ALTER TABLE "ingestion_items" ADD COLUMN "pending_book_id" uuid;--> statement-breakpoint
ALTER TABLE "taxonomy_suggestions" ADD CONSTRAINT "taxonomy_suggestions_resolved_category_id_physical_categories_id_fk" FOREIGN KEY ("resolved_category_id") REFERENCES "public"."physical_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_items" ADD CONSTRAINT "ingestion_items_pending_book_id_books_id_fk" FOREIGN KEY ("pending_book_id") REFERENCES "public"."books"("id") ON DELETE no action ON UPDATE no action;