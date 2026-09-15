import type { ReadingListRepository } from "./repository";
import type { CreateReadingListInput, ReadingList } from "./types";

/** Namespaced and versioned so a future schema change can migrate or discard old
 * data deliberately, rather than silently misreading it (docs/SECURITY.md pattern:
 * be explicit about format evolution rather than assuming forward-compatibility). */
const STORAGE_KEY = "ssjc-library:reading-lists:v1";

interface StoredShape {
  version: 1;
  lists: ReadingList[];
}

function generateId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback for browsers without crypto.randomUUID (older Safari) — not
  // cryptographically strong, which is fine: this is a local list identifier, never a
  // security token.
  return `list-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function isValidReadingList(value: unknown): value is ReadingList {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.name === "string" &&
    typeof v.createdAt === "string" &&
    typeof v.updatedAt === "string" &&
    Array.isArray(v.items)
  );
}

function readAll(): ReadingList[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Partial<StoredShape> | null;
    if (!parsed || !Array.isArray(parsed.lists)) return [];
    // Corrupted individual entries are dropped, not fatal — one bad row must never
    // take down the whole feature.
    return parsed.lists.filter(isValidReadingList);
  } catch {
    return [];
  }
}

function writeAll(lists: ReadingList[]): void {
  if (typeof window === "undefined") return;
  try {
    const payload: StoredShape = { version: 1, lists };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (error) {
    // Quota exceeded / private browsing / storage disabled must not crash the app —
    // the caller already has the correct in-memory result for this session.
    console.error("Reading Lists: failed to save to localStorage", error);
  }
}

function sortByUpdatedAtDesc(lists: ReadingList[]): ReadingList[] {
  return [...lists].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/**
 * Phase 3's local-only persistence adapter — see docs/DECISIONS.md, "Reading Lists
 * persistence: localStorage behind a repository interface." Data lives only in the
 * current browser; it is not shared across devices or staff members yet (the UI
 * discloses this — `ReadingListsOverview`). Phase 4 replaces this class with a real
 * database-backed `ReadingListRepository` implementation.
 */
export class LocalStorageReadingListRepository implements ReadingListRepository {
  async getAll(): Promise<ReadingList[]> {
    return sortByUpdatedAtDesc(readAll());
  }

  async getById(id: string): Promise<ReadingList | null> {
    return readAll().find((list) => list.id === id) ?? null;
  }

  async create(input: CreateReadingListInput): Promise<ReadingList> {
    const name = input.name.trim();
    if (!name) throw new Error("A reading list needs a name.");
    const createdBy = input.createdBy?.trim() || undefined;
    const now = new Date().toISOString();
    const list: ReadingList = { id: generateId(), name, createdBy, createdAt: now, updatedAt: now, items: [] };
    const all = readAll();
    all.push(list);
    writeAll(all);
    return list;
  }

  async rename(id: string, name: string): Promise<ReadingList> {
    const trimmed = name.trim();
    if (!trimmed) throw new Error("A reading list needs a name.");
    const all = readAll();
    const list = all.find((entry) => entry.id === id);
    if (!list) throw new Error(`Reading list ${id} not found.`);
    list.name = trimmed;
    list.updatedAt = new Date().toISOString();
    writeAll(all);
    return list;
  }

  async delete(id: string): Promise<void> {
    writeAll(readAll().filter((entry) => entry.id !== id));
  }

  async addBook(listId: string, bookId: string): Promise<ReadingList> {
    const all = readAll();
    const list = all.find((entry) => entry.id === listId);
    if (!list) throw new Error(`Reading list ${listId} not found.`);
    // Idempotent: adding a book already on the list is a no-op, not a duplicate entry.
    if (!list.items.some((item) => item.bookId === bookId)) {
      list.items.push({ bookId, addedAt: new Date().toISOString() });
      list.updatedAt = new Date().toISOString();
      writeAll(all);
    }
    return list;
  }

  async removeBook(listId: string, bookId: string): Promise<ReadingList> {
    const all = readAll();
    const list = all.find((entry) => entry.id === listId);
    if (!list) throw new Error(`Reading list ${listId} not found.`);
    list.items = list.items.filter((item) => item.bookId !== bookId);
    list.updatedAt = new Date().toISOString();
    writeAll(all);
    return list;
  }
}
