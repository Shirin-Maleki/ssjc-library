import { db } from "../client";
import { DrizzleBookRepository } from "./bookRepository";
import { DrizzleCategoryRepository } from "./categoryRepository";
import { DrizzleReadingListRepository } from "./readingListRepository";

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
export const readingListRepository = new DrizzleReadingListRepository(db);

export type { BookRepository } from "./bookRepository";
export type { PhysicalCategoryOption } from "./categoryRepository";
