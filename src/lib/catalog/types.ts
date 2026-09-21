/**
 * The catalog domain model — see docs/SEARCH.md. Originally a Phase 2 mock-catalog
 * shape; as of Phase 4 this is exactly what `DrizzleBookRepository`
 * (`src/db/repositories/bookRepository.ts`) projects real `books` rows into, so the
 * search/ranking/Find UI code that consumes it is completely unaware the underlying
 * source changed from `fixtures.ts` to Postgres.
 */

// Imported (and re-exported below) from languages.ts, the actual centralized ISO
// 639-1 registry, so every existing `import type { LanguageCode } from
// "@/lib/catalog/types"` keeps working — see that file for the real definition and
// why it isn't declared here.
import type { LanguageCode } from "./languages";
export type { LanguageCode };

export type FictionType = "fiction" | "nonfiction";

export type Format =
  | "board_book"
  | "picture_book"
  | "early_reader"
  | "chapter_book"
  | "informational_reference"
  | "activity_book"
  | "other";

export type IllustrationStyle =
  | "photography"
  | "watercolor"
  | "collage"
  | "digital_illustration"
  | "pencil"
  | "ink"
  | "painted"
  | "mixed_media"
  | "graphic_vector";

export type VisualRealism =
  | "real_photography"
  | "realistic_illustration"
  | "stylized_illustration"
  | "cartoon"
  | "abstract"
  | "mixed";

export type DurationBand = "under_5" | "five_to_ten" | "ten_plus";

/** A tag is just a normalized string from a controlled vocabulary — see tags.ts. */
export type Tag = string;

export interface BookCoverSpec {
  /** Selects one of a small, curated set of restrained placeholder compositions —
   * see BookCover.tsx. Not derived from a hash, so variety across the catalog is
   * intentional rather than accidental. */
  variant: number;
  /** A real, previously-verified display image URL (Phase 7) — present only when
   * `books.display_cover_url` is set (e.g. a trustworthy external provider
   * thumbnail chosen during Add-a-Book enrichment). `undefined` for every fixture
   * book and any real book without one; `BookCover.tsx` falls back to the
   * typographic placeholder whenever this is absent, exactly as before. Never the
   * raw Drive source original — see docs/GOOGLE_INTEGRATION.md, "Original source
   * cover vs. display cover." */
  displayUrl?: string;
}

export interface Book {
  id: string;
  title: string;
  subtitle?: string;
  sortTitle: string;
  authors: string[];
  /** Absent (not an empty array) when no separate illustrator is recorded — e.g. a
   * photography-driven nonfiction title credited to one author. */
  illustrators?: string[];
  publisher: string;
  imprint?: string;
  /** Phase 5 correction pass: exposed only so the fixture catalog can carry a real
   * ISBN for the small number of known-item search evaluation cases that need one
   * (`tests/evaluation/dataset.ts`) — most fixture books have neither, matching a
   * real record with genuinely unrecorded ISBN data (never invented). Not surfaced
   * anywhere in the Find/Book Detail UI; the search boundary
   * (`SearchRepository.findCandidates`) reads these directly from the database. */
  isbn10?: string;
  isbn13?: string;
  /** The primary/display language — see docs/DATA_MODEL.md §3. Never removed or
   * repurposed in favor of `additionalLanguageCodes` below; a book always has exactly
   * one primary language, plus zero or more additional ones for multilingual
   * editions. */
  languageCode: LanguageCode;
  /** Additional languages for a multilingual edition (`book_languages` rows),
   * distinct from `languageCode` — a book with `languageCode: "en"` and
   * `additionalLanguageCodes: ["sv"]` must be discoverable by a teacher filtering on
   * either English or Swedish (docs/DATA_MODEL.md §3). Optional, not `[]`, because
   * the fixture source (`fixtures.ts`) has no `book_languages` table to derive it
   * from — always present (possibly empty) when projected by `DrizzleBookRepository`.
   * Every consumer treats `undefined` the same as `[]`. */
  additionalLanguageCodes?: LanguageCode[];
  description: string;
  /** Canonical unit is whole months — see docs/DATA_MODEL.md §4. Independently
   * nullable in either direction (both unknown, open-ended lower/upper bound, or
   * both set) — a real database record may legitimately have incomplete age data;
   * never format or compare years directly, use age.ts. */
  ageMinMonths?: number;
  ageMaxMonths?: number;
  /** `undefined` when the database's `fiction_status` is `unknown_mixed` (Phase 5
   * correction — `docs/DECISIONS.md`, "Incomplete metadata is never invented").
   * Never defaulted to "nonfiction": an unknown fiction status must not be presented
   * or ranked as if it were a real, confirmed one. */
  fictionType?: FictionType;
  /** `undefined` when the database's `format` column is NULL — never defaulted to
   * "other" (a real, distinct, human-chosen value). */
  format?: Format;
  /** Exactly one — the physical shelf location. See categories.ts. Never treat this
   * as just another tag. */
  physicalCategory: string;
  tags: Tag[];
  illustrationStyles: IllustrationStyle[];
  /** `undefined` when the database's `visual_realism` is NULL or `unknown` — never
   * defaulted to "mixed" (a real, distinct, confirmed value meaning "genuinely
   * combines styles," not "we don't know"). */
  visualRealism?: VisualRealism;
  /** `undefined` when `read_aloud_minutes_estimate` is NULL — never defaulted to
   * `0`, which would otherwise silently satisfy an "Under 5 minutes" filter/intent
   * for a book whose duration is simply unrecorded. Use
   * `src/lib/catalog/duration.ts::getReadDurationBand`, never this value directly,
   * everywhere a duration *band* (not the raw estimate) is what's actually needed. */
  readAloudMinutes?: number;
  cover: BookCoverSpec;
  publicationYear?: number;
  /** Derived from `book_copies` rows, never stored (docs/DATA_MODEL.md §2 — "Copies:
   * N" must never be a manually maintained counter). Optional because the fixture
   * source (tests, Storybook-style isolated UI dev) has no copies table to derive
   * from — always present when projected by `DrizzleBookRepository`. */
  copyCount?: number;
}
