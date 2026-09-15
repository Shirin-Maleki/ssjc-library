// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { LocalStorageReadingListRepository } from "@/lib/reading-lists/localStorageRepository";

const STORAGE_KEY = "ssjc-library:reading-lists:v1";

describe("LocalStorageReadingListRepository", () => {
  let repo: LocalStorageReadingListRepository;

  beforeEach(() => {
    window.localStorage.clear();
    repo = new LocalStorageReadingListRepository();
  });

  it("starts empty", async () => {
    expect(await repo.getAll()).toEqual([]);
  });

  it("creates a list with a required name and no creator", async () => {
    const list = await repo.create({ name: "Insects" });
    expect(list.name).toBe("Insects");
    expect(list.createdBy).toBeUndefined();
    expect(list.items).toEqual([]);
    expect(list.id).toBeTruthy();
    expect(list.createdAt).toBe(list.updatedAt);
  });

  it("rejects an empty (or whitespace-only) name", async () => {
    await expect(repo.create({ name: "   " })).rejects.toThrow();
  });

  it("trims the name and the optional creator", async () => {
    const list = await repo.create({ name: "  Bedtime  ", createdBy: "  Ms. Ellis  " });
    expect(list.name).toBe("Bedtime");
    expect(list.createdBy).toBe("Ms. Ellis");
  });

  it("a whitespace-only creator is normalized to undefined (displayed as Anonymous by the UI layer)", async () => {
    const list = await repo.create({ name: "Insects", createdBy: "   " });
    expect(list.createdBy).toBeUndefined();
  });

  it("survives being read back by a fresh repository instance (simulating a reload)", async () => {
    await repo.create({ name: "Insects" });
    const freshRepo = new LocalStorageReadingListRepository();
    const all = await freshRepo.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe("Insects");
  });

  it("rename changes only the name and bumps updatedAt", async () => {
    const created = await repo.create({ name: "Insects" });
    await new Promise((resolve) => setTimeout(resolve, 2));
    const renamed = await repo.rename(created.id, "Bugs & Insects");
    expect(renamed.name).toBe("Bugs & Insects");
    expect(renamed.createdAt).toBe(created.createdAt);
    expect(renamed.updatedAt).not.toBe(created.updatedAt);
  });

  it("rename rejects an empty name", async () => {
    const created = await repo.create({ name: "Insects" });
    await expect(repo.rename(created.id, "  ")).rejects.toThrow();
  });

  it("delete removes the list", async () => {
    const created = await repo.create({ name: "Insects" });
    await repo.delete(created.id);
    expect(await repo.getById(created.id)).toBeNull();
    expect(await repo.getAll()).toEqual([]);
  });

  it("addBook adds a book and removeBook removes it", async () => {
    const created = await repo.create({ name: "Insects" });
    const withBook = await repo.addBook(created.id, "book-1");
    expect(withBook.items.map((i) => i.bookId)).toEqual(["book-1"]);

    const withoutBook = await repo.removeBook(created.id, "book-1");
    expect(withoutBook.items).toEqual([]);
  });

  it("addBook is idempotent — adding the same book twice does not duplicate it", async () => {
    const created = await repo.create({ name: "Insects" });
    await repo.addBook(created.id, "book-1");
    const again = await repo.addBook(created.id, "book-1");
    expect(again.items).toHaveLength(1);
  });

  it("removing a book from a list never touches the catalog itself — only the list's own items", async () => {
    const created = await repo.create({ name: "Insects" });
    await repo.addBook(created.id, "book-1");
    await repo.addBook(created.id, "book-2");
    const result = await repo.removeBook(created.id, "book-1");
    expect(result.items.map((i) => i.bookId)).toEqual(["book-2"]);
  });

  it("a book can belong to more than one list", async () => {
    const listA = await repo.create({ name: "Insects" });
    const listB = await repo.create({ name: "Bedtime" });
    await repo.addBook(listA.id, "book-1");
    await repo.addBook(listB.id, "book-1");
    expect((await repo.getById(listA.id))?.items).toHaveLength(1);
    expect((await repo.getById(listB.id))?.items).toHaveLength(1);
  });

  it("corrupted localStorage content is treated as empty, not a crash", async () => {
    window.localStorage.setItem(STORAGE_KEY, "{not valid json");
    expect(await repo.getAll()).toEqual([]);
    // The repository must still be fully usable afterward.
    const created = await repo.create({ name: "Insects" });
    expect(created.name).toBe("Insects");
  });

  it("a malformed stored shape (e.g. an array instead of the wrapper object) is treated as empty", async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([{ id: "x" }]));
    expect(await repo.getAll()).toEqual([]);
  });

  it("getAll orders most-recently-updated first", async () => {
    const first = await repo.create({ name: "First" });
    await new Promise((resolve) => setTimeout(resolve, 2));
    const second = await repo.create({ name: "Second" });
    await new Promise((resolve) => setTimeout(resolve, 2));
    await repo.rename(first.id, "First (renamed)");

    const all = await repo.getAll();
    expect(all[0].id).toBe(first.id);
    expect(all[1].id).toBe(second.id);
  });
});
