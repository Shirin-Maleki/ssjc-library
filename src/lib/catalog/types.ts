/**
 * The catalog domain model — see docs/SEARCH.md. Originally a Phase 2 mock-catalog
 * shape; as of Phase 4 this is exactly what `DrizzleBookRepository`
 * (`src/db/repositories/bookRepository.ts`) projects real `books` rows into, so the
 * search/ranking/Find UI code that consumes it is completely unaware the underlying
 * source changed from `fixtures.ts` to Postgres.
 */

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

export type LanguageCode = "en" | "sv" | "no" | "da" | "es" | "fr";

/** A tag is just a normalized string from a controlled vocabulary — see tags.ts. */
export type Tag = string;

export interface BookCoverSpec {
  /** Selects one of a small, curated set of restrained placeholder compositions —
   * see BookCover.tsx. Not derived from a hash, so variety across the catalog is
   * intentional rather than accidental. */
  variant: number;
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
  languageCode: LanguageCode;
  description: string;
  /** Canonical unit is whole months — see docs/DATA_MODEL.md §4. Independently
   * nullable in either direction (both unknown, open-ended lower/upper bound, or
   * both set) — a real database record may legitimately have incomplete age data;
   * never format or compare years directly, use age.ts. */
  ageMinMonths?: number;
  ageMaxMonths?: number;
  fictionType: FictionType;
  format: Format;
  /** Exactly one — the physical shelf location. See categories.ts. Never treat this
   * as just another tag. */
  physicalCategory: string;
  tags: Tag[];
  illustrationStyles: IllustrationStyle[];
  visualRealism: VisualRealism;
  readAloudMinutes: number;
  cover: BookCoverSpec;
  publicationYear?: number;
  /** Derived from `book_copies` rows, never stored (docs/DATA_MODEL.md §2 — "Copies:
   * N" must never be a manually maintained counter). Optional because the fixture
   * source (tests, Storybook-style isolated UI dev) has no copies table to derive
   * from — always present when projected by `DrizzleBookRepository`. */
  copyCount?: number;
}
