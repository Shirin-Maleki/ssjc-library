const LEADING_ARTICLES = ["the", "a", "an"];

/** Strips a leading English article for alphabetical shelving order — see
 * docs/DATA_MODEL.md §2 (`sort_title`). Deliberately simple for v1: no per-language
 * article rules yet, since the fixture catalog's non-English titles don't currently
 * start with one. */
export function computeSortTitle(title: string): string {
  const words = title.trim().split(/\s+/);
  if (words.length > 1 && LEADING_ARTICLES.includes(words[0].toLowerCase())) {
    return words.slice(1).join(" ");
  }
  return title;
}
