import type { LanguageCode } from "./types";

/**
 * A single application constant, not a database table — see docs/DATA_MODEL.md §3 for
 * why Phase 0 removed the `languages` reference table. Extend this map (and the
 * LanguageCode union in types.ts) rather than inventing a second source of truth.
 */
export const LANGUAGE_NAMES: Record<LanguageCode, string> = {
  en: "English",
  sv: "Swedish",
  no: "Norwegian",
  da: "Danish",
  es: "Spanish",
  fr: "French",
};

export function getLanguageName(code: LanguageCode): string {
  return LANGUAGE_NAMES[code] ?? code;
}

/** Reverse lookup used by search-intent parsing — matches a language mentioned by
 * name in free text (e.g. "Swedish book") back to its code. */
export function findLanguageByName(name: string): LanguageCode | undefined {
  const normalized = name.trim().toLowerCase();
  const entry = (Object.entries(LANGUAGE_NAMES) as [LanguageCode, string][]).find(
    ([, label]) => label.toLowerCase() === normalized
  );
  return entry?.[0];
}
