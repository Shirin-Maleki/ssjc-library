DROP INDEX "books_search_text_trgm_idx";--> statement-breakpoint
CREATE INDEX "books_title_trgm_idx" ON "books" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "contributors_name_trgm_idx" ON "contributors" USING gin ("name" gin_trgm_ops);