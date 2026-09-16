import { afterAll, afterEach, describe, expect, it } from "vitest";
import { DrizzleReadingListRepository } from "@/db/repositories/readingListRepository";
import { DrizzleBookRepository } from "@/db/repositories/bookRepository";
import { BookNotFoundError, InvalidIdError, ReadingListNotFoundError } from "@/lib/reading-lists/errors";
import { requireTestDatabaseUrl, createTestDb } from "./testDb";

const NONEXISTENT_UUID = "00000000-0000-0000-0000-000000000000";

const hasTestDb = (() => {
  try {
    requireTestDatabaseUrl();
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!hasTestDb)("DrizzleReadingListRepository (against a real Postgres database)", () => {
  const { db, client } = hasTestDb ? createTestDb() : ({} as ReturnType<typeof createTestDb>);
  const repository = hasTestDb ? new DrizzleReadingListRepository(db) : (undefined as unknown as DrizzleReadingListRepository);
  const bookRepository = hasTestDb ? new DrizzleBookRepository(db) : (undefined as unknown as DrizzleBookRepository);
  const createdListIds: string[] = [];

  afterEach(async () => {
    for (const id of createdListIds.splice(0)) {
      await repository.delete(id);
    }
  });

  afterAll(async () => {
    if (hasTestDb) await client.end();
  });

  async function trackedCreate(...args: Parameters<DrizzleReadingListRepository["create"]>) {
    const list = await repository.create(...args);
    createdListIds.push(list.id);
    return list;
  }

  it("creates a list with a required name and no creator", async () => {
    const list = await trackedCreate({ name: "Insects" });
    expect(list.name).toBe("Insects");
    expect(list.createdBy).toBeUndefined();
    expect(list.items).toEqual([]);
  });

  it("rejects an empty (whitespace-only) name", async () => {
    await expect(repository.create({ name: "   " })).rejects.toThrow();
  });

  it("trims the name and creator, and a whitespace-only creator normalizes to undefined (Anonymous)", async () => {
    const list = await trackedCreate({ name: "  Bedtime  ", createdBy: "   " });
    expect(list.name).toBe("Bedtime");
    expect(list.createdBy).toBeUndefined();
  });

  it("rename updates only the name", async () => {
    const created = await trackedCreate({ name: "Insects" });
    const renamed = await repository.rename(created.id, "Bugs & Insects");
    expect(renamed.name).toBe("Bugs & Insects");
    expect(renamed.createdAt).toBe(created.createdAt);
  });

  it("delete removes the list", async () => {
    const created = await repository.create({ name: "Temporary" });
    await repository.delete(created.id);
    expect(await repository.getById(created.id)).toBeNull();
  });

  it("addBook and removeBook work against a real seeded book, and duplicate add is idempotent", async () => {
    const [book] = await bookRepository.listBooks();
    const list = await trackedCreate({ name: "Dino Books" });

    const withBook = await repository.addBook(list.id, book.id);
    expect(withBook.items.map((i) => i.bookId)).toEqual([book.id]);

    const addedAgain = await repository.addBook(list.id, book.id);
    expect(addedAgain.items).toHaveLength(1);

    const withoutBook = await repository.removeBook(list.id, book.id);
    expect(withoutBook.items).toEqual([]);
  });

  it("a book can belong to more than one list", async () => {
    const [book] = await bookRepository.listBooks();
    const listA = await trackedCreate({ name: "List A" });
    const listB = await trackedCreate({ name: "List B" });
    await repository.addBook(listA.id, book.id);
    await repository.addBook(listB.id, book.id);
    expect((await repository.getById(listA.id))?.items).toHaveLength(1);
    expect((await repository.getById(listB.id))?.items).toHaveLength(1);
  });

  it("addBook against a missing list throws a typed domain error, not a raw database exception", async () => {
    const [book] = await bookRepository.listBooks();
    await expect(repository.addBook(NONEXISTENT_UUID, book.id)).rejects.toThrow(ReadingListNotFoundError);
  });

  it("addBook against a nonexistent book throws a typed domain error, never a raw foreign-key-violation exception (Phase 4 correction pass)", async () => {
    const list = await trackedCreate({ name: "Dino Books 2" });
    await expect(repository.addBook(list.id, NONEXISTENT_UUID)).rejects.toThrow(BookNotFoundError);
  });

  it("rename/removeBook against a missing list also throw ReadingListNotFoundError, not a generic error", async () => {
    const [book] = await bookRepository.listBooks();
    await expect(repository.rename(NONEXISTENT_UUID, "New Name")).rejects.toThrow(ReadingListNotFoundError);
    await expect(repository.removeBook(NONEXISTENT_UUID, book.id)).rejects.toThrow(ReadingListNotFoundError);
  });

  it("a malformed (non-UUID) id is rejected as InvalidIdError before ever reaching Postgres", async () => {
    const [book] = await bookRepository.listBooks();
    await expect(repository.addBook("not-a-uuid", book.id)).rejects.toThrow(InvalidIdError);
    await expect(repository.addBook(book.id /* wrong kind, but valid uuid shape */, "also-not-a-uuid")).rejects.toThrow(
      InvalidIdError
    );
    await expect(repository.rename("not-a-uuid", "New Name")).rejects.toThrow(InvalidIdError);
    await expect(repository.removeBook("not-a-uuid", book.id)).rejects.toThrow(InvalidIdError);
    await expect(repository.createWithBook({ name: "X" }, "not-a-uuid")).rejects.toThrow(InvalidIdError);
  });

  it("getById and delete treat a malformed id as a safe no-result/no-op, not a database error", async () => {
    expect(await repository.getById("not-a-uuid")).toBeNull();
    await expect(repository.delete("not-a-uuid")).resolves.toBeUndefined();
  });

  describe("createWithBook (one atomic operation, Phase 4 correction pass)", () => {
    it("returns the new list already containing the book", async () => {
      const [book] = await bookRepository.listBooks();
      const created = await repository.createWithBook({ name: "Atomic Create" }, book.id);
      createdListIds.push(created.id);
      expect(created.items.map((i) => i.bookId)).toEqual([book.id]);
    });

    it("both the list row and the item row genuinely persist — verified by re-fetching from scratch", async () => {
      const [book] = await bookRepository.listBooks();
      const created = await repository.createWithBook({ name: "Atomic Create Persisted" }, book.id);
      createdListIds.push(created.id);

      const refetched = await repository.getById(created.id);
      expect(refetched).not.toBeNull();
      expect(refetched!.name).toBe("Atomic Create Persisted");
      expect(refetched!.items.map((i) => i.bookId)).toEqual([book.id]);
    });

    it("a nonexistent book makes the entire operation fail, leaving no orphan/empty list behind", async () => {
      const before = await repository.getAll();
      const beforeCount = before.length;

      await expect(repository.createWithBook({ name: "Should Never Exist" }, NONEXISTENT_UUID)).rejects.toThrow(
        BookNotFoundError
      );

      const after = await repository.getAll();
      expect(after.length).toBe(beforeCount);
      expect(after.some((list) => list.name === "Should Never Exist")).toBe(false);
    });

    it("duplicate-membership constraints still apply normally afterward — adding the same book again is idempotent", async () => {
      const [book] = await bookRepository.listBooks();
      const created = await repository.createWithBook({ name: "Atomic Then Idempotent" }, book.id);
      createdListIds.push(created.id);

      const addedAgain = await repository.addBook(created.id, book.id);
      expect(addedAgain.items).toHaveLength(1);
    });
  });

  it("data persists through a brand-new repository/connection instance", async () => {
    const created = await trackedCreate({ name: "Persistence Check" });
    const { db: freshDb, client: freshClient } = createTestDb();
    try {
      const freshRepository = new DrizzleReadingListRepository(freshDb);
      const found = await freshRepository.getById(created.id);
      expect(found?.name).toBe("Persistence Check");
    } finally {
      await freshClient.end();
    }
  });

  it(
    "shared-persistence acceptance: two independent connections see the same list " +
      "(the Phase 3 browser-local limitation is genuinely removed)",
    async () => {
      // Simulates two independent staff browser sessions (Phase 4 brief §36) — each
      // gets its own connection/repository instance, standing in for two separate
      // authenticated Server Action calls from two different browser contexts.
      const { db: contextA, client: clientA } = createTestDb();
      const { db: contextB, client: clientB } = createTestDb();
      try {
        const repoA = new DrizzleReadingListRepository(contextA);
        const repoB = new DrizzleReadingListRepository(contextB);

        const list = await repoA.create({ name: "Shared Across Devices", createdBy: "Context A" });
        createdListIds.push(list.id);

        const seenByB = await repoB.getById(list.id);
        expect(seenByB).not.toBeNull();
        expect(seenByB!.name).toBe("Shared Across Devices");

        const [book] = await bookRepository.listBooks();
        await repoA.addBook(list.id, book.id);
        const afterAdd = await repoB.getById(list.id);
        expect(afterAdd!.items.map((i) => i.bookId)).toEqual([book.id]);
      } finally {
        await clientA.end();
        await clientB.end();
      }
    }
  );
});
