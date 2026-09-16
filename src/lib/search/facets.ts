import type { Book } from "@/lib/catalog/types";
import { getLanguageName } from "@/lib/catalog/languages";
import { DURATION_BAND_LABELS, getReadDurationBand } from "@/lib/catalog/duration";
import { FICTION_TYPE_LABELS, FORMAT_LABELS, ILLUSTRATION_STYLE_LABELS, VISUAL_REALISM_LABELS } from "@/lib/catalog/labels";

export interface FacetOption {
  value: string;
  label: string;
}

/** Every filter option list is derived from the books actually present, the same
 * "no second hidden list" rule autocomplete follows — a format or language with zero
 * fixture books simply doesn't appear as a choice.
 *
 * `categories` is real category data (slug + label) fetched server-side from
 * `physical_categories` (Phase 4 brief §15/§31) — this function no longer imports the
 * old hard-coded `PHYSICAL_CATEGORIES` constant itself, so it has no way to silently
 * fall back to a second taxonomy source. */
export function buildFacets(books: Book[], categories: { slug: string; label: string }[]) {
  const languageCodes = Array.from(new Set(books.map((b) => b.languageCode)));
  const formats = Array.from(new Set(books.map((b) => b.format)));
  const illustrationStyles = Array.from(new Set(books.flatMap((b) => b.illustrationStyles)));
  const visualRealism = Array.from(new Set(books.map((b) => b.visualRealism)));
  const durations = Array.from(new Set(books.map((b) => getReadDurationBand(b.readAloudMinutes))));
  const authors = Array.from(new Set(books.flatMap((b) => b.authors))).sort();
  const illustrators = Array.from(new Set(books.flatMap((b) => b.illustrators ?? []))).sort();
  const publishers = Array.from(new Set(books.map((b) => b.publisher))).sort();
  const categoriesInUse = new Set(books.map((b) => b.physicalCategory));

  return {
    categories: categories
      .filter((c) => categoriesInUse.has(c.slug))
      .map((c) => ({ value: c.slug, label: c.label })) satisfies FacetOption[],
    languages: languageCodes
      .map((code) => ({ value: code, label: getLanguageName(code) }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    fictionTypes: (["fiction", "nonfiction"] as const)
      .filter((type) => books.some((b) => b.fictionType === type))
      .map((type) => ({ value: type, label: FICTION_TYPE_LABELS[type] })),
    formats: formats.map((f) => ({ value: f, label: FORMAT_LABELS[f] })).sort((a, b) => a.label.localeCompare(b.label)),
    illustrationStyles: illustrationStyles
      .map((s) => ({ value: s, label: ILLUSTRATION_STYLE_LABELS[s] }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    visualRealism: visualRealism
      .map((r) => ({ value: r, label: VISUAL_REALISM_LABELS[r] }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    durations: (["under_5", "five_to_ten", "ten_plus"] as const)
      .filter((band) => durations.includes(band))
      .map((band) => ({ value: band, label: DURATION_BAND_LABELS[band] })),
    authors: authors.map((a) => ({ value: a, label: a })),
    illustrators: illustrators.map((i) => ({ value: i, label: i })),
    publishers: publishers.map((p) => ({ value: p, label: p })),
  };
}
