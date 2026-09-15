/**
 * Age is stored internally in whole months (docs/DATA_MODEL.md §4) and only ever
 * converted to a friendly display range here — no component should format or reason
 * about years directly.
 */

export function formatAgeRange(minMonths: number, maxMonths: number): string {
  const minYears = Math.floor(minMonths / 12);
  const maxYears = maxMonths % 12 === 0 ? maxMonths / 12 : Math.ceil(maxMonths / 12);
  if (minYears === maxYears) return `${minYears} years`;
  return `${minYears}–${maxYears} years`;
}

/** A single selected "age" in the Find UI (e.g. "4") represents a point within that
 * year — the midpoint of year N is used as the comparison point against a book's
 * [ageMinMonths, ageMaxMonths] range, per docs/DATA_MODEL.md §4's convention. */
export function ageYearsToRepresentativeMonths(years: number): number {
  return years * 12 + 6;
}

export function bookMatchesAgeYears(
  book: { ageMinMonths: number; ageMaxMonths: number },
  years: number
): boolean {
  const point = ageYearsToRepresentativeMonths(years);
  return book.ageMinMonths <= point && point <= book.ageMaxMonths;
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
