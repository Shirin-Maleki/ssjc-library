// See the equivalent comment in bookRepository.ts — the `server-only` guard lives on
// `src/db/client.ts` alone, so this class stays importable from
// `tests/integration/db/*.test.ts`.
import { and, desc, eq } from "drizzle-orm";
import type { Database } from "../client";
import { books, readingListItems, readingLists } from "../schema";
import type { ReadingListRepository } from "@/lib/reading-lists/repository";
import type { CreateReadingListInput, ReadingList } from "@/lib/reading-lists/types";
import { BookNotFoundError, InvalidIdError, ReadingListNotFoundError } from "@/lib/reading-lists/errors";
import { isUuid } from "@/lib/utils/uuid";

type ListRow = typeof readingLists.$inferSelect;
type ItemRow = typeof readingListItems.$inferSelect;

function project(list: ListRow, items: ItemRow[]): ReadingList {
  return {
    id: list.id,
    name: list.name,
    createdBy: list.createdBy ?? undefined,
    createdAt: list.createdAt.toISOString(),
    updatedAt: list.updatedAt.toISOString(),
    items: items.map((item) => ({ bookId: item.bookId, addedAt: item.addedAt.toISOString() })),
  };
}

/**
 * The Phase 4 canonical Reading List store (docs/DECISIONS.md, "Reading Lists: from
 * localStorage to Postgres") — same `ReadingListRepository` interface Phase 3's
 * `LocalStorageReadingListRepository` already implements, so every dialog/component
 * above the repository boundary needed zero changes; only which implementation the
 * server-side transport constructs changed. See `src/lib/reading-lists/actions.ts` for
 * the authenticated Server Action boundary — this class is never imported by a Client
 * Component.
 */
export class DrizzleReadingListRepository implements ReadingListRepository {
  constructor(private readonly db: Database) {}

  async getAll(): Promise<ReadingList[]> {
    const lists = await this.db.select().from(readingLists).orderBy(desc(readingLists.updatedAt));
    if (lists.length === 0) return [];
    const items = await this.db.select().from(readingListItems);
    const itemsByList = new Map<string, ItemRow[]>();
    for (const item of items) {
      const list = itemsByList.get(item.listId) ?? [];
      list.push(item);
      itemsByList.set(item.listId, list);
    }
    return lists.map((list) => project(list, itemsByList.get(list.id) ?? []));
  }

  async getById(id: string): Promise<ReadingList | null> {
    // A query, not a mutation — a malformed id is simply "not found," never a raw
    // "invalid input syntax for type uuid" database error (Phase 4 correction pass).
    if (!isUuid(id)) return null;
    const [list] = await this.db.select().from(readingLists).where(eq(readingLists.id, id)).limit(1);
    if (!list) return null;
    const items = await this.db.select().from(readingListItems).where(eq(readingListItems.listId, id));
    return project(list, items);
  }

  async create(input: CreateReadingListInput): Promise<ReadingList> {
    const name = input.name.trim();
    if (!name) throw new Error("A reading list needs a name.");
    const createdBy = input.createdBy?.trim() || undefined;
    const [row] = await this.db.insert(readingLists).values({ name, createdBy }).returning();
    return project(row, []);
  }

  async rename(id: string, name: string): Promise<ReadingList> {
    if (!isUuid(id)) throw new InvalidIdError(id);
    const trimmed = name.trim();
    if (!trimmed) throw new Error("A reading list needs a name.");
    const [row] = await this.db
      .update(readingLists)
      .set({ name: trimmed, updatedAt: new Date() })
      .where(eq(readingLists.id, id))
      .returning();
    if (!row) throw new ReadingListNotFoundError(id);
    const items = await this.db.select().from(readingListItems).where(eq(readingListItems.listId, id));
    return project(row, items);
  }

  async delete(id: string): Promise<void> {
    // Deleting a nonexistent row is already an idempotent no-op; a malformed id gets
    // the same treatment rather than a raw database syntax error.
    if (!isUuid(id)) return;
    await this.db.delete(readingLists).where(eq(readingLists.id, id));
  }

  async addBook(listId: string, bookId: string): Promise<ReadingList> {
    if (!isUuid(listId)) throw new InvalidIdError(listId);
    if (!isUuid(bookId)) throw new InvalidIdError(bookId);
    return this.db.transaction(async (tx) => {
      // Both sides checked explicitly, before the insert — reading_list_items has a
      // foreign key to *both* reading_lists and books, so a nonexistent id on either
      // side must be caught here, not left to surface as a raw foreign-key-violation
      // exception (Phase 4 correction pass — "SQL/driver errors must not become the
      // product contract").
      const [list] = await tx.select({ id: readingLists.id }).from(readingLists).where(eq(readingLists.id, listId)).limit(1);
      if (!list) throw new ReadingListNotFoundError(listId);
      const [book] = await tx.select({ id: books.id }).from(books).where(eq(books.id, bookId)).limit(1);
      if (!book) throw new BookNotFoundError(bookId);
      // The composite primary key (list_id, book_id) makes this idempotent at the
      // database level — adding a book already on the list is a genuine no-op, never
      // a duplicate row or an error.
      await tx.insert(readingListItems).values({ listId, bookId }).onConflictDoNothing();
      const [row] = await tx
        .update(readingLists)
        .set({ updatedAt: new Date() })
        .where(eq(readingLists.id, listId))
        .returning();
      if (!row) throw new ReadingListNotFoundError(listId);
      const items = await tx.select().from(readingListItems).where(eq(readingListItems.listId, listId));
      return project(row, items);
    });
  }

  async removeBook(listId: string, bookId: string): Promise<ReadingList> {
    if (!isUuid(listId)) throw new InvalidIdError(listId);
    if (!isUuid(bookId)) throw new InvalidIdError(bookId);
    return this.db.transaction(async (tx) => {
      await tx.delete(readingListItems).where(and(eq(readingListItems.listId, listId), eq(readingListItems.bookId, bookId)));
      const [row] = await tx
        .update(readingLists)
        .set({ updatedAt: new Date() })
        .where(eq(readingLists.id, listId))
        .returning();
      if (!row) throw new ReadingListNotFoundError(listId);
      const items = await tx.select().from(readingListItems).where(eq(readingListItems.listId, listId));
      return project(row, items);
    });
  }

  /** The Add-to-Reading-List dialog's "Create new list" step, as one atomic
   * transaction (Phase 4 correction pass) — create() followed by a separate
   * addBook() left a real partial-success window (the list could commit with no
   * book if the second call failed); here, if the book doesn't exist, the whole
   * transaction rolls back and no list is created at all. */
  async createWithBook(input: CreateReadingListInput, bookId: string): Promise<ReadingList> {
    if (!isUuid(bookId)) throw new InvalidIdError(bookId);
    const name = input.name.trim();
    if (!name) throw new Error("A reading list needs a name.");
    const createdBy = input.createdBy?.trim() || undefined;
    return this.db.transaction(async (tx) => {
      const [book] = await tx.select({ id: books.id }).from(books).where(eq(books.id, bookId)).limit(1);
      if (!book) throw new BookNotFoundError(bookId);
      const [row] = await tx.insert(readingLists).values({ name, createdBy }).returning();
      await tx.insert(readingListItems).values({ listId: row.id, bookId });
      const items = await tx.select().from(readingListItems).where(eq(readingListItems.listId, row.id));
      return project(row, items);
    });
  }
}
