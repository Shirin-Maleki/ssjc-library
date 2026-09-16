"use server";

import { requireStaffSession } from "@/lib/auth/guards";
import { readingListRepository } from "@/db/repositories";
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
 */

export async function getAllReadingListsAction(): Promise<ReadingList[]> {
  await requireStaffSession();
  return readingListRepository.getAll();
}

export async function getReadingListByIdAction(id: string): Promise<ReadingList | null> {
  await requireStaffSession();
  return readingListRepository.getById(id);
}

export async function createReadingListAction(input: CreateReadingListInput): Promise<ReadingList> {
  await requireStaffSession();
  return readingListRepository.create(input);
}

export async function renameReadingListAction(id: string, name: string): Promise<ReadingList> {
  await requireStaffSession();
  return readingListRepository.rename(id, name);
}

export async function deleteReadingListAction(id: string): Promise<void> {
  await requireStaffSession();
  return readingListRepository.delete(id);
}

export async function addBookToReadingListAction(listId: string, bookId: string): Promise<ReadingList> {
  await requireStaffSession();
  return readingListRepository.addBook(listId, bookId);
}

export async function removeBookFromReadingListAction(listId: string, bookId: string): Promise<ReadingList> {
  await requireStaffSession();
  return readingListRepository.removeBook(listId, bookId);
}
