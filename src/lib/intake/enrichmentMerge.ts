/**
 * AI-first catalog draft correction (§4/§13) — the "merge real provider context
 * into AI suggestions, without a second Gemini call" logic, extracted into its own
 * pure, dependency-light module specifically so it's directly unit-testable
 * without a database connection or staff session (mirrors `candidateAcceptance.ts`
 * and `visionFailureClassification.ts`'s own reasoning from earlier correction
 * passes).
 */

const MAX_TAGS = 10;

/**
 * Merges real provider subjects (e.g. Open Library's `subjects` field, when a
 * high-confidence candidate was accepted) into the AI-suggested tag list — real
 * provider context, never a second Gemini call. Case-insensitive de-duplication;
 * capped so a subject-heavy provider record can't produce an unbounded tag list.
 * Returns the original `tags` array unchanged (same reference) when there is
 * nothing to merge, so a caller can cheaply tell whether anything changed.
 */
export function mergeProviderSubjectsIntoTags(tags: string[], providerSubjects: string[] | undefined): string[] {
  if (!providerSubjects || providerSubjects.length === 0) return tags;
  const seen = new Set(tags.map((t) => t.toLowerCase()));
  const merged = [...tags];
  for (const subject of providerSubjects) {
    const normalized = subject.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    merged.push(subject.trim());
    if (merged.length >= MAX_TAGS) break;
  }
  return merged;
}
