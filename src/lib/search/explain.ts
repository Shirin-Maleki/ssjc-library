import { getLanguageName } from "@/lib/catalog/languages";
import { DURATION_BAND_LABELS } from "@/lib/catalog/duration";
import {
  FICTION_TYPE_LABELS,
  FORMAT_LABELS,
  ILLUSTRATION_STYLE_LABELS,
  VISUAL_REALISM_LABELS,
} from "@/lib/catalog/labels";
import type { DurationBand, Format, FictionType, IllustrationStyle, LanguageCode, VisualRealism } from "@/lib/catalog/types";
import type { MatchReason, MatchReasonType } from "./rank";

/** Higher-priority reasons are kept when a sentence has to be trimmed for length —
 * mirrors the ranking hierarchy in rankingConfig.ts. */
const REASON_PRIORITY: MatchReasonType[] = [
  "title_exact",
  "exact_retrieval",
  "title_prefix",
  "author",
  "illustrator",
  "title_partial",
  "category",
  "tag",
  "language",
  "age",
  "visual_realism",
  "illustration_style",
  "duration",
  "publisher",
  "format",
  "fiction_type",
  "semantic",
  "fuzzy_match",
  "description",
];

function phraseFor(reason: MatchReason, categoryLabelBySlug: Map<string, string>): string {
  switch (reason.type) {
    case "title_exact":
    case "title_prefix":
    case "title_partial":
      return "the title";
    case "author":
      return `author ${reason.value}`;
    case "illustrator":
      return `illustrator ${reason.value}`;
    case "publisher":
      return `publisher ${reason.value}`;
    case "category":
      return `the ${categoryLabelBySlug.get(reason.value ?? "") ?? reason.value} category`;
    case "tag":
      return `the "${reason.value}" topic`;
    case "language":
      return `${getLanguageName(reason.value as LanguageCode)} language`;
    case "age":
      return "the requested age";
    case "illustration_style":
      return `${ILLUSTRATION_STYLE_LABELS[reason.value as IllustrationStyle]} illustrations`;
    case "visual_realism":
      return VISUAL_REALISM_LABELS[reason.value as VisualRealism];
    case "duration":
      return `a ${DURATION_BAND_LABELS[reason.value as DurationBand].toLowerCase()} read`;
    case "format":
      return `${FORMAT_LABELS[reason.value as Format].toLowerCase()} format`;
    case "fiction_type":
      return FICTION_TYPE_LABELS[reason.value as FictionType].toLowerCase();
    case "description":
      return "its description";
    case "exact_retrieval":
      return "an exact catalog match";
    case "fuzzy_match":
      return "a close spelling match";
    case "semantic":
      return "the theme you described";
    default:
      return "";
  }
}

function joinPhrases(phrases: string[]): string {
  if (phrases.length === 0) return "";
  if (phrases.length === 1) return phrases[0];
  if (phrases.length === 2) return `${phrases[0]} and ${phrases[1]}`;
  return `${phrases.slice(0, -1).join(", ")}, and ${phrases[phrases.length - 1]}`;
}

/**
 * Builds a concise, honest explanation from the fields that actually matched — never
 * a free-form generated sentence, and never a reason for a signal that didn't match
 * (docs/SEARCH.md "match explanations must be deterministic and grounded").
 */
export function buildMatchExplanation(
  reasons: MatchReason[],
  categoryLabelBySlug: Map<string, string> = new Map()
): string {
  if (reasons.length === 0) return "";

  const seen = new Set<MatchReasonType>();
  const ordered = REASON_PRIORITY.filter((type) => {
    if (seen.has(type)) return false;
    const found = reasons.find((r) => r.type === type);
    if (found) seen.add(type);
    return Boolean(found);
  }).slice(0, 3);

  const phrases = ordered
    .map((type) => reasons.find((r) => r.type === type))
    .filter((r): r is MatchReason => Boolean(r))
    .map((reason) => phraseFor(reason, categoryLabelBySlug))
    .filter(Boolean);

  return `Matches ${joinPhrases(phrases)}.`;
}
