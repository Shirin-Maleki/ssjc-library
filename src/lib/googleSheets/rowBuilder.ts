import type { Book } from "@/lib/catalog/types";
import { formatAgeRange } from "@/lib/catalog/age";
import { getReadDurationBand } from "@/lib/catalog/duration";
import { DURATION_BAND_LABELS } from "@/lib/catalog/duration";
import { FICTION_TYPE_LABELS, ILLUSTRATION_STYLE_LABELS, VISUAL_REALISM_LABELS, NOT_SPECIFIED } from "@/lib/catalog/labels";
import { getLanguageName, isLanguageCode } from "@/lib/catalog/languages";
import { TRUSTED_THUMBNAIL_HOSTS } from "@/lib/intake/displayCover";

/**
 * §11 of the phase brief: the visible `Catalog` tab's exact 15 teacher-facing
 * columns, built entirely from the SAME formatters/vocabulary Find and Book
 * Detail already use (`formatAgeRange`, `DURATION_BAND_LABELS`,
 * `FICTION_TYPE_LABELS`/`ILLUSTRATION_STYLE_LABELS`/`VISUAL_REALISM_LABELS`,
 * `getLanguageName`) — never a second, parallel set of labels that could
 * quietly drift from what a teacher already sees in the app itself.
 *
 * A 16th, deliberately HIDDEN column (`book_id`) is appended after the visible
 * 15 — a genuinely useful stable identifier for any future incremental sync
 * work or spreadsheet debugging, hidden via the Sheets API's own column-hide
 * (`sync.ts`'s `batchUpdate`), never surfaced as ordinary teacher-facing UI
 * (§11: "It must not become normal teacher-facing UI").
 */

export const CATALOG_HEADER_ROW = [
  "Cover",
  "Title",
  "Author",
  "Illustrator",
  "Publisher",
  "Age Range",
  "Short Description",
  "Themes / Tags",
  "Language",
  "Fiction / Nonfiction",
  "Illustration Style",
  "Visual Realism",
  "Read Time",
  "Physical Category",
  "Location",
  "Copy Count",
  "book_id (hidden)",
] as const;

export const VISIBLE_COLUMN_COUNT = CATALOG_HEADER_ROW.length - 1;

/**
 * A cover cell is a real `=IMAGE("https://...")` formula ONLY when
 * `displayUrl` independently re-passes the exact same host/scheme trust check
 * `selectTrustworthyDisplayCoverUrl` already gated it through once at save
 * time (`TRUSTED_THUMBNAIL_HOSTS`, re-exported from `intake/displayCover.ts`
 * for exactly this reuse) — never built from arbitrary book metadata text,
 * which is how a spreadsheet formula-injection vulnerability would happen.
 */
export function buildCoverCell(displayUrl: string | undefined): string {
  if (!displayUrl) return "";
  let url: URL;
  try {
    url = new URL(displayUrl);
  } catch {
    return "";
  }
  if (url.protocol !== "https:" || !TRUSTED_THUMBNAIL_HOSTS.has(url.hostname)) return "";
  // A literal double-quote inside a URL would break out of the formula's own
  // string literal — real cover URLs never legitimately contain one, but this
  // is a defensive, zero-cost check rather than an assumption.
  if (url.toString().includes('"')) return "";
  return `=IMAGE("${url.toString()}")`;
}

/**
 * Forces a cell to render as inert literal text under the Sheets API's
 * `USER_ENTERED` input mode (`googleSheetsProvider.ts`'s `updateValues`),
 * which is otherwise required so `buildCoverCell()`'s real `IMAGE()` formula
 * actually renders. `USER_ENTERED` interprets ANY cell beginning with
 * `=`/`+`/`-`/`@` as a formula — a book title, author name, or AI-written
 * description is arbitrary text this application does not control the first
 * character of, so every one of those columns is escaped here with Sheets'
 * own standard "force literal text" leading apostrophe, unconditionally
 * (cheap, and correct for every value, not just the ones that happen to start
 * with a dangerous character today). Never applied to the cover cell itself
 * (the one intentional formula) or to the numeric copy-count cell (sent as a
 * real JS `number`, never a string, so it is never subject to formula
 * interpretation at all).
 */
function escapeTextCell(value: string): string {
  return `'${value}`;
}

export type CatalogRow = readonly [string, string, string, string, string, string, string, string, string, string, string, string, string, string, string, number, string];

/** "Corridor 218" (one location, one copy) / "Corridor 218 (2)" (one location,
 * several copies) / "Corridor 218 (1), Blue Room (1)" (several locations) —
 * the exact deterministic formats the addendum specifies. A bare label
 * (no count) only ever appears for the single-location, single-copy case;
 * every other case always shows each bucket's count, so "2 copies, same
 * place" is never visually indistinguishable from "1 copy." Never exposes an
 * internal `book_copies` row id — only human-facing location names and
 * counts. */
export function formatLocationSummary(counts: readonly { label: string; count: number }[]): string {
  if (counts.length === 0) return NOT_SPECIFIED;
  if (counts.length === 1) {
    const only = counts[0];
    return only.count > 1 ? `${only.label} (${only.count})` : only.label;
  }
  return counts.map((c) => `${c.label} (${c.count})`).join(", ");
}

export function buildCatalogRow(book: Book, categoryLabel: string, locationSummary: string): CatalogRow {
  const readMinutes = book.readAloudMinutes;
  const durationBand = getReadDurationBand(readMinutes);
  const readTime = durationBand ? DURATION_BAND_LABELS[durationBand] : NOT_SPECIFIED;

  const languageName = isLanguageCode(book.languageCode) ? getLanguageName(book.languageCode) : book.languageCode;

  return [
    buildCoverCell(book.cover.displayUrl),
    escapeTextCell(book.title),
    escapeTextCell(book.authors.join(", ") || ""),
    escapeTextCell((book.illustrators ?? []).join(", ") || ""),
    escapeTextCell(book.publisher || ""),
    escapeTextCell(formatAgeRange(book.ageMinMonths, book.ageMaxMonths)),
    escapeTextCell(book.description || ""),
    escapeTextCell(book.tags.join(", ") || ""),
    escapeTextCell(languageName),
    escapeTextCell(book.fictionType ? FICTION_TYPE_LABELS[book.fictionType] : NOT_SPECIFIED),
    escapeTextCell(book.illustrationStyles.length > 0 ? book.illustrationStyles.map((s) => ILLUSTRATION_STYLE_LABELS[s]).join(", ") : NOT_SPECIFIED),
    escapeTextCell(book.visualRealism ? VISUAL_REALISM_LABELS[book.visualRealism] : NOT_SPECIFIED),
    escapeTextCell(readTime),
    escapeTextCell(categoryLabel),
    escapeTextCell(locationSummary),
    book.copyCount ?? 0,
    escapeTextCell(book.id),
  ];
}
