import { db } from "../client";
import { DrizzleBookRepository } from "./bookRepository";
import { DrizzleCategoryRepository } from "./categoryRepository";
import { DrizzleLocationRepository } from "./locationRepository";
import { DrizzleReadingListRepository } from "./readingListRepository";
import { DrizzleSearchRepository } from "./searchRepository";
import { SearchService } from "@/lib/search/searchService";

/**
 * The only place the running app constructs a repository against its real, live
 * connection (`src/db/client.ts`, which carries the `server-only` guard) — importing
 * this module from a Client Component fails the build, exactly as intended. Server
 * Components and Server Actions import from here; tests construct repository
 * instances directly against their own test connection instead
 * (`tests/integration/db/testDb.ts`).
 */
export const bookRepository = new DrizzleBookRepository(db);
export const categoryRepository = new DrizzleCategoryRepository(db);
export const locationRepository = new DrizzleLocationRepository(db);
export const readingListRepository = new DrizzleReadingListRepository(db);
export const searchRepository = new DrizzleSearchRepository(db);

/** A fresh `SearchService` per call, with a freshly-fetched category list (Phase 5)
 * — categories change rarely and this is one small query, so there's no need for
 * `SearchService` itself to be a long-lived singleton juggling stale category data. */
export async function createSearchService(): Promise<SearchService> {
  const categories = await categoryRepository.listCategories();
  return new SearchService(searchRepository, bookRepository, categories);
}

export type { BookRepository } from "./bookRepository";
export type { PhysicalCategoryOption } from "./categoryRepository";
export type { LibraryLocationOption } from "./locationRepository";
