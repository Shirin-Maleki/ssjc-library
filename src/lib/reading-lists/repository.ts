import type { CreateReadingListInput, ReadingList } from "./types";

/**
 * The seam Phase 4 replaces (docs/DECISIONS.md, "Reading Lists persistence:
 * localStorage behind a repository interface"). Every method is `async` even though
 * today's only implementation (`LocalStorageReadingListRepository`) is purely
 * synchronous under the hood — so a future database/API-backed implementation slots
 * in with no change to any component, dialog, or the provider that calls this
 * interface.
 */
export interface ReadingListRepository {
  getAll(): Promise<ReadingList[]>;
  getById(id: string): Promise<ReadingList | null>;
  create(input: CreateReadingListInput): Promise<ReadingList>;
  rename(id: string, name: string): Promise<ReadingList>;
  delete(id: string): Promise<void>;
  addBook(listId: string, bookId: string): Promise<ReadingList>;
  removeBook(listId: string, bookId: string): Promise<ReadingList>;
}
