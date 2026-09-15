"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { LocalStorageReadingListRepository } from "@/lib/reading-lists/localStorageRepository";
import type { ReadingListRepository } from "@/lib/reading-lists/repository";
import type { CreateReadingListInput, ReadingList } from "@/lib/reading-lists/types";

interface ReadingListsContextValue {
  lists: ReadingList[];
  /** False until the initial localStorage read completes — consumers must not render
   * an empty state before this is true, or a real list would flash "No lists yet"
   * for a moment on every page load (product brief §11). */
  ready: boolean;
  getById: (id: string) => ReadingList | undefined;
  createList: (input: CreateReadingListInput) => Promise<ReadingList>;
  renameList: (id: string, name: string) => Promise<ReadingList>;
  deleteList: (id: string) => Promise<void>;
  addBook: (listId: string, bookId: string) => Promise<ReadingList>;
  removeBook: (listId: string, bookId: string) => Promise<ReadingList>;
}

const ReadingListsContext = createContext<ReadingListsContextValue | null>(null);

/**
 * The one shared client-side access point for Reading Lists — `/lists`, `/lists/[id]`,
 * Search Results, and Book Detail all read/write through this instead of touching
 * `localStorage` (or even knowing it exists) directly. Mounted once in the staff
 * layout (`src/app/(staff)/layout.tsx`) so every staff page shares the same in-memory
 * list state without prop-drilling.
 *
 * The repository instance itself lives behind `ReadingListRepository` — swapping
 * `LocalStorageReadingListRepository` for a real database-backed implementation in
 * Phase 4 is the only change this file (or anything using this provider) will need.
 */
export function ReadingListsProvider({ children }: { children: ReactNode }) {
  const [repository] = useState<ReadingListRepository>(() => new LocalStorageReadingListRepository());
  const [lists, setLists] = useState<ReadingList[]>([]);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    const all = await repository.getAll();
    setLists(all);
    return all;
  }, [repository]);

  useEffect(() => {
    let cancelled = false;
    repository.getAll().then((all) => {
      if (cancelled) return;
      setLists(all);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [repository]);

  const getById = useCallback((id: string) => lists.find((list) => list.id === id), [lists]);

  const createList = useCallback(
    async (input: CreateReadingListInput) => {
      const created = await repository.create(input);
      await refresh();
      return created;
    },
    [repository, refresh]
  );

  const renameList = useCallback(
    async (id: string, name: string) => {
      const renamed = await repository.rename(id, name);
      await refresh();
      return renamed;
    },
    [repository, refresh]
  );

  const deleteList = useCallback(
    async (id: string) => {
      await repository.delete(id);
      await refresh();
    },
    [repository, refresh]
  );

  const addBook = useCallback(
    async (listId: string, bookId: string) => {
      const updated = await repository.addBook(listId, bookId);
      await refresh();
      return updated;
    },
    [repository, refresh]
  );

  const removeBook = useCallback(
    async (listId: string, bookId: string) => {
      const updated = await repository.removeBook(listId, bookId);
      await refresh();
      return updated;
    },
    [repository, refresh]
  );

  const value = useMemo<ReadingListsContextValue>(
    () => ({ lists, ready, getById, createList, renameList, deleteList, addBook, removeBook }),
    [lists, ready, getById, createList, renameList, deleteList, addBook, removeBook]
  );

  return <ReadingListsContext.Provider value={value}>{children}</ReadingListsContext.Provider>;
}

export function useReadingLists(): ReadingListsContextValue {
  const context = useContext(ReadingListsContext);
  if (!context) {
    throw new Error("useReadingLists must be used within a ReadingListsProvider");
  }
  return context;
}
