import type { ReadingList } from "./types";

/** Blank/absent `createdBy` is never stored or shown as the literal string
 * "Anonymous" — it's a display-time fallback, computed here and only here. */
export function formatCreatedBy(createdBy: string | undefined): string {
  const trimmed = createdBy?.trim();
  return trimmed ? trimmed : "Anonymous";
}

export function formatBookCount(count: number): string {
  return count === 1 ? "1 book" : `${count} books`;
}

/** A friendly, locale-formatted date for display — the raw ISO string still belongs
 * in a `<time dateTime="">` attribute alongside this for assistive tech/machine
 * readability (docs/ACCESSIBILITY.md pattern). Returns "" for an unparseable value
 * rather than "Invalid Date" leaking into the UI. */
export function formatListDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric" }).format(date);
}

export function isBookInList(list: ReadingList, bookId: string): boolean {
  return list.items.some((item) => item.bookId === bookId);
}
