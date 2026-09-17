/**
 * Age is stored internally in whole months (docs/DATA_MODEL.md §4) and only ever
 * converted to a friendly display range here — no component should format or reason
 * about years directly.
 */

/** Every branch here is a real, reachable case now that a database record can
 * legitimately have an unknown or open-ended age (docs/DATA_MODEL.md §4; Phase 4
 * brief §17) — never assume both bounds are present. */
export function formatAgeRange(minMonths: number | undefined, maxMonths: number | undefined): string {
  if (minMonths == null && maxMonths == null) return "Age not specified";
  if (minMonths != null && maxMonths == null) return `${Math.floor(minMonths / 12)}+ years`;
  if (minMonths == null && maxMonths != null) {
    const years = maxMonths % 12 === 0 ? maxMonths / 12 : Math.ceil(maxMonths / 12);
    return `Up to ${years} years`;
  }
  const minYears = Math.floor(minMonths! / 12);
  const maxYears = maxMonths! % 12 === 0 ? maxMonths! / 12 : Math.ceil(maxMonths! / 12);
  if (minYears === maxYears) return `${minYears} years`;
  return `${minYears}–${maxYears} years`;
}

/** A single selected "age" in the Find UI (e.g. "4") represents a point within that
 * year — the midpoint of year N is used as the comparison point against a book's
 * [ageMinMonths, ageMaxMonths] range, per docs/DATA_MODEL.md §4's convention. */
export function ageYearsToRepresentativeMonths(years: number): number {
  return years * 12 + 6;
}

/** A book with both bounds unknown can never confidently satisfy a specific age
 * filter — excluded, not assumed suitable (matches the "flagged missing_metadata"
 * treatment in docs/DATA_MODEL.md §4). An open-ended bound (one side only) is
 * treated as unbounded on that side. */
export function bookMatchesAgeYears(
  book: { ageMinMonths?: number; ageMaxMonths?: number },
  years: number
): boolean {
  if (book.ageMinMonths == null && book.ageMaxMonths == null) return false;
  const point = ageYearsToRepresentativeMonths(years);
  const min = book.ageMinMonths ?? -Infinity;
  const max = book.ageMaxMonths ?? Infinity;
  return min <= point && point <= max;
}

const WORD_NUMBERS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};

/** Extracts an intended age in years from free text — used only as a ranking signal
 * (see docs/SEARCH.md), never as a hard filter. Returns undefined if no age phrase
 * is recognized. Deliberately narrow: a handful of real phrasings, not general NLP. */
export function parseAgeYearsFromText(text: string): number | undefined {
  const normalized = text.toLowerCase();

  // "2 to 5" / "2-5" — a range phrase (Phase 5 correction pass, docs/SEARCH.md §2).
  // Treated as a single representative point (the midpoint), the same mechanism
  // "age 4" already uses — this stays a ranking signal only, never a hard filter,
  // so a coarse midpoint approximation is an acceptable, documented simplification
  // rather than a genuine two-sided range constraint.
  const rangeAge = normalized.match(/\b(\d{1,2})\s*(?:to|-)\s*(\d{1,2})\b(?!\s*-?\s*minutes?)/);
  if (rangeAge) {
    const low = Number(rangeAge[1]);
    const high = Number(rangeAge[2]);
    if (low >= 0 && high <= 18 && low <= high) return Math.round((low + high) / 2);
  }

  const explicitAge = normalized.match(/\bage\s*(\d{1,2})\b/);
  if (explicitAge) {
    const years = Number(explicitAge[1]);
    if (years >= 0 && years <= 18) return years;
  }

  const digitAge = normalized.match(/\b(\d{1,2})[\s-]*year[\s-]*olds?\b/);
  if (digitAge) {
    const years = Number(digitAge[1]);
    if (years >= 0 && years <= 18) return years;
  }

  const wordAge = normalized.match(
    /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)[\s-]*year[\s-]*olds?\b/
  );
  if (wordAge) {
    return WORD_NUMBERS[wordAge[1]];
  }

  return undefined;
}
