import { MAX_ENRICHMENT_TAGS } from "@/lib/ai/schemas";

/**
 * AI-first catalog draft correction (§4/§13) — the "merge real provider context
 * into AI suggestions, without a second Gemini call" logic, extracted into its own
 * pure, dependency-light module specifically so it's directly unit-testable
 * without a database connection or staff session (mirrors `candidateAcceptance.ts`
 * and `visionFailureClassification.ts`'s own reasoning from earlier correction
 * passes). Importing `MAX_ENRICHMENT_TAGS` from `lib/ai/schemas` (a plain Zod
 * schema module, no DB/session/`server-only` dependency) rather than hard-coding a
 * second number here is the fix for a real Phase 7 bug: this file once defined its
 * own `MAX_TAGS = 10`, silently out of sync with `EnrichmentSuggestionSchema`'s
 * `tags.max(8)` — a subject-heavy accepted provider candidate could merge past 8
 * tags and only fail much later, at `parseIntakeDraft()`'s schema validation
 * inside `saveDraft()`. One shared constant makes that drift impossible to
 * reintroduce silently.
 */

/**
 * Merges real provider subjects (e.g. Open Library's `subjects` field, when a
 * high-confidence candidate was accepted) into the AI-suggested tag list — real
 * provider context, never a second Gemini call. The original AI tags are always
 * preserved first, in order, and are never displaced or truncated by this
 * function; provider subjects are appended only while capacity remains under
 * `MAX_ENRICHMENT_TAGS`, so if the AI already returned a full 8 tags, zero
 * provider subjects are added. Case-insensitive de-duplication; whitespace
 * trimmed. Returns the original `tags` array unchanged (same reference) when
 * there is nothing to merge, so a caller can cheaply tell whether anything
 * changed.
 */
export function mergeProviderSubjectsIntoTags(tags: string[], providerSubjects: string[] | undefined): string[] {
  if (!providerSubjects || providerSubjects.length === 0) return tags;
  const merged = [...tags];
  if (merged.length >= MAX_ENRICHMENT_TAGS) return merged;
  const seen = new Set(tags.map((t) => t.toLowerCase()));
  for (const subject of providerSubjects) {
    if (merged.length >= MAX_ENRICHMENT_TAGS) break;
    const normalized = subject.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    merged.push(subject.trim());
  }
  return merged;
}
