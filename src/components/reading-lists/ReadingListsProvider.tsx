"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { RemoteReadingListRepository } from "@/lib/reading-lists/remoteRepository";
import type { ReadingListRepository } from "@/lib/reading-lists/repository";
import type { CreateReadingListInput, ReadingList } from "@/lib/reading-lists/types";

/** Never a raw error/SQL/stack trace (Phase 4 brief §35/§42) — one calm, teacher-
 * readable sentence, distinct from "there are genuinely no lists yet." */
const LOAD_ERROR_MESSAGE = "Reading Lists couldn't be loaded right now. Please try refreshing the page.";

interface ReadingListsContextValue {
  lists: ReadingList[];
  /** False until the initial load attempt (success OR failure) completes —
   * consumers must not render an empty state before this is true, or a real list
   * would flash "No lists yet" for a moment on every page load (product brief §11). */
  ready: boolean;
  /** Set only when the initial load itself failed (e.g. the database is
   * unreachable) — distinct from `ready && lists.length === 0`, which means the load
   * succeeded and there genuinely are no lists yet (Phase 4 brief §42). */
  loadError: string | null;
  getById: (id: string) => ReadingList | undefined;
  createList: (input: CreateReadingListInput) => Promise<ReadingList>;
  /** The Add-to-Reading-List dialog's "Create new list" step — one atomic server
   * operation (Phase 4 correction pass), not a separate `createList` + `addBook`
   * pair, which left a real partial-success window. */
  createListWithBook: (input: CreateReadingListInput, bookId: string) => Promise<ReadingList>;
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
 * The repository instance itself lives behind `ReadingListRepository` — Phase 4
 * swapped `LocalStorageReadingListRepository` for `RemoteReadingListRepository`
 * (Server Actions over Postgres, docs/DECISIONS.md) as the only change this file (or
 * anything using this provider) needed.
 */
export function ReadingListsProvider({ children }: { children: ReactNode }) {
  const [repository] = useState<ReadingListRepository>(() => new RemoteReadingListRepository());
  const [lists, setLists] = useState<ReadingList[]>([]);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const all = await repository.getAll();
    setLists(all);
    setLoadError(null);
    return all;
  }, [repository]);

  useEffect(() => {
    let cancelled = false;
    repository
      .getAll()
      .then((all) => {
        if (cancelled) return;
        setLists(all);
        setReady(true);
      })
      .catch(() => {
        if (cancelled) return;
        setLoadError(LOAD_ERROR_MESSAGE);
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

  const createListWithBook = useCallback(
    async (input: CreateReadingListInput, bookId: string) => {
      const created = await repository.createWithBook(input, bookId);
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
    () => ({ lists, ready, loadError, getById, createList, createListWithBook, renameList, deleteList, addBook, removeBook }),
    [lists, ready, loadError, getById, createList, createListWithBook, renameList, deleteList, addBook, removeBook]
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
