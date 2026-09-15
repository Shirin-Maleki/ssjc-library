import Link from "next/link";
import { getCategoryLabel } from "@/lib/catalog/categories";
import { getLanguageName } from "@/lib/catalog/languages";
import { DURATION_BAND_LABELS } from "@/lib/catalog/duration";
import { FICTION_TYPE_LABELS, FORMAT_LABELS, ILLUSTRATION_STYLE_LABELS, VISUAL_REALISM_LABELS } from "@/lib/catalog/labels";
import type {
  DurationBand,
  FictionType,
  Format,
  IllustrationStyle,
  LanguageCode,
  VisualRealism,
} from "@/lib/catalog/types";
import { hasActiveFilters, type Filters } from "@/lib/search/filters";
import { buildFindHref } from "@/lib/search/urlParams";

interface Chip {
  key: string;
  label: string;
  href: string;
}

function withoutValue<K extends keyof Filters>(filters: Filters, key: K, value: string): Filters {
  const list = (filters[key] as string[] | undefined) ?? [];
  return { ...filters, [key]: list.filter((v) => v !== value) };
}

function buildChips(query: string, filters: Filters): Chip[] {
  const chips: Chip[] = [];

  if (typeof filters.ageYears === "number") {
    chips.push({
      key: "age",
      label: `Age ${filters.ageYears}`,
      href: buildFindHref(query, { ...filters, ageYears: undefined }),
    });
  }

  for (const value of filters.categories ?? []) {
    chips.push({
      key: `category:${value}`,
      label: getCategoryLabel(value),
      href: buildFindHref(query, withoutValue(filters, "categories", value)),
    });
  }
  for (const value of filters.languages ?? []) {
    chips.push({
      key: `language:${value}`,
      label: getLanguageName(value as LanguageCode),
      href: buildFindHref(query, withoutValue(filters, "languages", value)),
    });
  }
  for (const value of filters.visualRealism ?? []) {
    chips.push({
      key: `realism:${value}`,
      label: VISUAL_REALISM_LABELS[value as VisualRealism],
      href: buildFindHref(query, withoutValue(filters, "visualRealism", value)),
    });
  }
  for (const value of filters.fictionTypes ?? []) {
    chips.push({
      key: `fiction:${value}`,
      label: FICTION_TYPE_LABELS[value as FictionType],
      href: buildFindHref(query, withoutValue(filters, "fictionTypes", value)),
    });
  }
  for (const value of filters.durations ?? []) {
    chips.push({
      key: `duration:${value}`,
      label: DURATION_BAND_LABELS[value as DurationBand],
      href: buildFindHref(query, withoutValue(filters, "durations", value)),
    });
  }
  for (const value of filters.illustrationStyles ?? []) {
    chips.push({
      key: `style:${value}`,
      label: ILLUSTRATION_STYLE_LABELS[value as IllustrationStyle],
      href: buildFindHref(query, withoutValue(filters, "illustrationStyles", value)),
    });
  }
  for (const value of filters.formats ?? []) {
    chips.push({
      key: `format:${value}`,
      label: FORMAT_LABELS[value as Format],
      href: buildFindHref(query, withoutValue(filters, "formats", value)),
    });
  }
  for (const value of filters.authors ?? []) {
    chips.push({ key: `author:${value}`, label: value, href: buildFindHref(query, withoutValue(filters, "authors", value)) });
  }
  for (const value of filters.illustrators ?? []) {
    chips.push({
      key: `illustrator:${value}`,
      label: value,
      href: buildFindHref(query, withoutValue(filters, "illustrators", value)),
    });
  }
  for (const value of filters.publishers ?? []) {
    chips.push({
      key: `publisher:${value}`,
      label: value,
      href: buildFindHref(query, withoutValue(filters, "publishers", value)),
    });
  }

  return chips;
}

export function ActiveFilters({ query, filters }: { query: string; filters: Filters }) {
  if (!hasActiveFilters(filters)) return null;

  const chips = buildChips(query, filters);

  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Active filters">
      {chips.map((chip) => (
        <Link
          key={chip.key}
          href={chip.href}
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-subtle px-3 py-1 text-sm text-text-primary hover:border-border-strong"
        >
          {chip.label}
          <span aria-hidden="true" className="text-text-muted">
            ×
          </span>
          <span className="sr-only">Remove {chip.label} filter</span>
        </Link>
      ))}
      {chips.length > 1 && (
        <Link href={buildFindHref(query, {})} className="text-sm font-medium text-text-secondary underline underline-offset-4 hover:text-text-primary">
          Clear all
        </Link>
      )}
    </div>
  );
}
