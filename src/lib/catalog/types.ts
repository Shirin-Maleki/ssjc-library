/**
 * Phase 2 mock catalog domain model — see docs/SEARCH.md. This shape intentionally
 * mirrors the eventual database columns (docs/DATA_MODEL.md) closely enough that
 * swapping the data source in Phase 5 should not require rewriting the Find UI, only
 * the functions in this module and src/lib/search that currently read `fixtures.ts`.
 */

export type FictionType = "fiction" | "nonfiction";

export type Format =
  | "board_book"
  | "picture_book"
  | "early_reader"
  | "chapter_book"
  | "informational_reference"
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
  /** Canonical unit is whole months — see docs/DATA_MODEL.md §4. Never format or
   * compare years directly; use age.ts. */
  ageMinMonths: number;
  ageMaxMonths: number;
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
}
