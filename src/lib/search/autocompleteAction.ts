"use server";

import { requireStaffSession } from "@/lib/auth/guards";
import { searchRepository } from "@/db/repositories";
import { normalizeSearchText } from "./normalize";
import type { AutocompleteRow } from "@/db/repositories/searchRepository";

export type { AutocompleteRow } from "@/db/repositories/searchRepository";

const RESULT_LIMIT = 8;
const PER_TYPE_FETCH_LIMIT = 8;

const TYPE_PRIORITY: Record<AutocompleteRow["type"], number> = {
  title: 0,
  author: 1,
  illustrator: 2,
  category: 3,
  publisher: 4,
  topic: 5,
  language: 6,
};

/**
 * The Phase 5 replacement for client-side, full-catalog autocomplete — an
 * authenticated Server Action (`requireStaffSession()`, independently checked here
 * exactly like every other Server Action in this app — a Server Action is directly
 * invokable regardless of which page rendered the input that normally calls it)
 * returning bounded, real-catalog-only suggestions (`docs/SEARCH.md` §6). Never
 * ships the full catalog to the browser; the client only ever sees the handful of
 * suggestions actually worth showing.
 */
export async function autocompleteAction(query: string): Promise<AutocompleteRow[]> {
  await requireStaffSession();
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const rows = await searchRepository.autocomplete(trimmed, PER_TYPE_FETCH_LIMIT);
  const normalizedQuery = normalizeSearchText(trimmed);

  return rows
    .map((row) => ({ row, isPrefix: normalizeSearchText(row.value).startsWith(normalizedQuery) }))
    .sort((a, b) => {
      // Prefix matches first, then a stable type ordering, then alphabetical —
      // deterministic regardless of which SQL query happened to return a row first.
      if (a.isPrefix !== b.isPrefix) return a.isPrefix ? -1 : 1;
      if (TYPE_PRIORITY[a.row.type] !== TYPE_PRIORITY[b.row.type]) return TYPE_PRIORITY[a.row.type] - TYPE_PRIORITY[b.row.type];
      return a.row.value.localeCompare(b.row.value);
    })
    .slice(0, RESULT_LIMIT)
    .map(({ row }) => row);
}
