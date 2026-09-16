// See the equivalent comment in bookRepository.ts — the `server-only` guard lives on
// `src/db/client.ts` alone, so this class stays importable from
// `tests/integration/db/*.test.ts`.
import { and, desc, eq } from "drizzle-orm";
import type { Database } from "../client";
import { readingListItems, readingLists } from "../schema";
import type { ReadingListRepository } from "@/lib/reading-lists/repository";
import type { CreateReadingListInput, ReadingList } from "@/lib/reading-lists/types";

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
    const trimmed = name.trim();
    if (!trimmed) throw new Error("A reading list needs a name.");
    const [row] = await this.db
      .update(readingLists)
      .set({ name: trimmed, updatedAt: new Date() })
      .where(eq(readingLists.id, id))
      .returning();
    if (!row) throw new Error(`Reading list ${id} not found.`);
    const items = await this.db.select().from(readingListItems).where(eq(readingListItems.listId, id));
    return project(row, items);
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(readingLists).where(eq(readingLists.id, id));
  }

  async addBook(listId: string, bookId: string): Promise<ReadingList> {
    return this.db.transaction(async (tx) => {
      // The composite primary key (list_id, book_id) makes this idempotent at the
      // database level — adding a book already on the list is a genuine no-op, never
      // a duplicate row or an error.
      await tx.insert(readingListItems).values({ listId, bookId }).onConflictDoNothing();
      const [row] = await tx
        .update(readingLists)
        .set({ updatedAt: new Date() })
        .where(eq(readingLists.id, listId))
        .returning();
      if (!row) throw new Error(`Reading list ${listId} not found.`);
      const items = await tx.select().from(readingListItems).where(eq(readingListItems.listId, listId));
      return project(row, items);
    });
  }

  async removeBook(listId: string, bookId: string): Promise<ReadingList> {
    return this.db.transaction(async (tx) => {
      await tx.delete(readingListItems).where(and(eq(readingListItems.listId, listId), eq(readingListItems.bookId, bookId)));
      const [row] = await tx
        .update(readingLists)
        .set({ updatedAt: new Date() })
        .where(eq(readingLists.id, listId))
        .returning();
      if (!row) throw new Error(`Reading list ${listId} not found.`);
      const items = await tx.select().from(readingListItems).where(eq(readingListItems.listId, listId));
      return project(row, items);
    });
  }
}
