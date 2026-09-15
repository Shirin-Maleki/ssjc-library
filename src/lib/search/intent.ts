import type { DurationBand, IllustrationStyle, LanguageCode, VisualRealism } from "@/lib/catalog/types";
import { findLanguageByName, LANGUAGE_NAMES } from "@/lib/catalog/languages";
import { parseAgeYearsFromText } from "@/lib/catalog/age";
import { parseDurationBandFromText } from "@/lib/catalog/duration";
import { ILLUSTRATION_STYLE_LABELS } from "@/lib/catalog/labels";

export interface SearchIntent {
  ageYears?: number;
  durationBand?: DurationBand;
  /** One or more acceptable visual-realism values — "realistic" alone is broader
   * (matches real photography OR realistic illustration) than an explicit "real
   * photos" phrase, which means real photography specifically. */
  visualRealism?: VisualRealism[];
  languageCode?: LanguageCode;
  illustrationStyle?: IllustrationStyle;
}

const PHOTO_PHRASE = /\breal\s+(photos?|photographs?|pictures?)\b|\bphotographs?\b|\bphotography\b/;
const REALISTIC_WORD = /\brealistic\b/;

function parseVisualRealismIntent(normalizedQuery: string): VisualRealism[] | undefined {
  if (PHOTO_PHRASE.test(normalizedQuery)) return ["real_photography"];
  if (REALISTIC_WORD.test(normalizedQuery)) return ["real_photography", "realistic_illustration"];
  return undefined;
}

function parseLanguageIntent(normalizedQuery: string): LanguageCode | undefined {
  for (const code of Object.keys(LANGUAGE_NAMES) as LanguageCode[]) {
    const name = LANGUAGE_NAMES[code].toLowerCase();
    if (new RegExp(`\\b${name}\\b`).test(normalizedQuery)) {
      return findLanguageByName(LANGUAGE_NAMES[code]);
    }
  }
  return undefined;
}

function parseIllustrationStyleIntent(normalizedQuery: string): IllustrationStyle | undefined {
  for (const [style, label] of Object.entries(ILLUSTRATION_STYLE_LABELS) as [IllustrationStyle, string][]) {
    // Matched as a whole phrase, not any individual word in it — otherwise a query
    // containing the generic word "illustration" would falsely imply "Digital
    // illustration" specifically.
    const phrase = label.toLowerCase().replace(/\s*\/\s*/g, " ").replace(/\s+/g, "\\s+");
    if (new RegExp(`\\b${phrase}\\b`).test(normalizedQuery)) return style;
  }
  return undefined;
}

/**
 * Extracts structured signals from free text for RANKING ONLY — these never exclude a
 * book the way an explicit Filter selection does (docs/SEARCH.md's "filters are
 * constraints, query signals are relevance" rule). Deliberately narrow: a handful of
 * real phrasings the brief calls out, not general natural-language understanding.
 */
export function parseSearchIntent(rawQuery: string): SearchIntent {
  const normalized = rawQuery.toLowerCase();
  return {
    ageYears: parseAgeYearsFromText(normalized),
    durationBand: parseDurationBandFromText(normalized),
    visualRealism: parseVisualRealismIntent(normalized),
    languageCode: parseLanguageIntent(normalized),
    illustrationStyle: parseIllustrationStyleIntent(normalized),
  };
}
