import type { ReadingListRepository } from "./repository";
import type { CreateReadingListInput, ReadingList } from "./types";
import {
  addBookToReadingListAction,
  createReadingListAction,
  deleteReadingListAction,
  getAllReadingListsAction,
  getReadingListByIdAction,
  removeBookFromReadingListAction,
  renameReadingListAction,
} from "./actions";

/**
 * The Phase 4 production Reading List transport — implements the exact same
 * `ReadingListRepository` interface `LocalStorageReadingListRepository` (Phase 3)
 * already did, so `ReadingListsProvider` needed zero changes beyond which class it
 * constructs (docs/DECISIONS.md, "Reading Lists: from localStorage to Postgres").
 * Every method is a thin call into an authenticated Server Action
 * (`src/lib/reading-lists/actions.ts`) — this class never imports Drizzle or touches
 * `localStorage`, keeping the browser bundle free of both.
 */
export class RemoteReadingListRepository implements ReadingListRepository {
  getAll(): Promise<ReadingList[]> {
    return getAllReadingListsAction();
  }

  getById(id: string): Promise<ReadingList | null> {
    return getReadingListByIdAction(id);
  }

  create(input: CreateReadingListInput): Promise<ReadingList> {
    return createReadingListAction(input);
  }

  rename(id: string, name: string): Promise<ReadingList> {
    return renameReadingListAction(id, name);
  }

  delete(id: string): Promise<void> {
    return deleteReadingListAction(id);
  }

  addBook(listId: string, bookId: string): Promise<ReadingList> {
    return addBookToReadingListAction(listId, bookId);
  }

  removeBook(listId: string, bookId: string): Promise<ReadingList> {
    return removeBookFromReadingListAction(listId, bookId);
  }
}
