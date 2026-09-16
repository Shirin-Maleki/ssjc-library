"use server";

import { requireStaffSession } from "@/lib/auth/guards";
import { readingListRepository } from "@/db/repositories";
import { isUuid } from "@/lib/utils/uuid";
import { InvalidIdError } from "./errors";
import type { CreateReadingListInput, ReadingList } from "./types";

/**
 * The authenticated Server Action boundary between the browser and the database-
 * backed `ReadingListRepository` (Phase 4 brief §34). Every action independently
 * calls `requireStaffSession()` first — never relying on `/lists` sitting below the
 * protected staff layout, since a Server Action can be invoked directly regardless of
 * which page rendered the form/button that triggered it. `RemoteReadingListRepository`
 * (`src/lib/reading-lists/remoteRepository.ts`) is the only caller; it exists so
 * `ReadingListsProvider` keeps talking to a plain `ReadingListRepository` interface
 * and has no idea Server Actions are involved.
 *
 * Every id argument is validated as real UUID shape here, before it ever reaches
 * Drizzle/Postgres (Phase 4 correction pass) — a Server Action is directly invokable
 * regardless of what UI rendered the button that normally calls it, so this boundary,
 * not just the calling component, is where a malformed id must be rejected as a safe
 * domain failure rather than a raw "invalid input syntax for type uuid" database
 * exception.
 */

function assertValidId(id: string): void {
  if (!isUuid(id)) throw new InvalidIdError(id);
}

export async function getAllReadingListsAction(): Promise<ReadingList[]> {
  await requireStaffSession();
  return readingListRepository.getAll();
}

export async function getReadingListByIdAction(id: string): Promise<ReadingList | null> {
  await requireStaffSession();
  // A query, not a mutation — a malformed id is simply "not found," not an error.
  if (!isUuid(id)) return null;
  return readingListRepository.getById(id);
}

export async function createReadingListAction(input: CreateReadingListInput): Promise<ReadingList> {
  await requireStaffSession();
  return readingListRepository.create(input);
}

export async function createReadingListWithBookAction(
  input: CreateReadingListInput,
  bookId: string
): Promise<ReadingList> {
  await requireStaffSession();
  assertValidId(bookId);
  return readingListRepository.createWithBook(input, bookId);
}

export async function renameReadingListAction(id: string, name: string): Promise<ReadingList> {
  await requireStaffSession();
  assertValidId(id);
  return readingListRepository.rename(id, name);
}

export async function deleteReadingListAction(id: string): Promise<void> {
  await requireStaffSession();
  assertValidId(id);
  return readingListRepository.delete(id);
}

export async function addBookToReadingListAction(listId: string, bookId: string): Promise<ReadingList> {
  await requireStaffSession();
  assertValidId(listId);
  assertValidId(bookId);
  return readingListRepository.addBook(listId, bookId);
}

export async function removeBookFromReadingListAction(listId: string, bookId: string): Promise<ReadingList> {
  await requireStaffSession();
  assertValidId(listId);
  assertValidId(bookId);
  return readingListRepository.removeBook(listId, bookId);
}
