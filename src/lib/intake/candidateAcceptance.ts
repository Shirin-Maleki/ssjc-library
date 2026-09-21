import type { CoverIdentification } from "@/lib/ai/schemas";
import type { NormalizedMetadataCandidate } from "@/lib/metadataProviders/provider";
import { resolveProviderLanguage, type ReconciliationResult } from "./reconciliation";
import type { LanguageCode } from "@/lib/catalog/types";

/**
 * Identity-safety fix (Phase 7 final closure pass §1) — extracted from
 * `lookupMetadataAction` into its own pure, dependency-light module specifically so
 * this acceptance gate is directly unit-testable without a database connection or a
 * staff session (both required just to *import* `actions.ts`, which pulls in
 * `@/db/client` at module load time).
 *
 * The gate itself: a provider candidate's fields (ISBN, publisher, subtitle,
 * language, authors, title) may only become canonical `proposedBookValues` — and
 * therefore only reach duplicate detection — when reconciliation reached
 * `high_confidence`. An `ambiguous` or `unresolved` best-scoring candidate is a
 * real signal worth keeping for audit (the caller still records it in
 * `book_identity_candidates` with `wasSelected: false`), but its fields must never
 * silently become the record teachers see as "already identified" — most
 * importantly, its ISBN must never reach `duplicateMatcher.ts`, whose own
 * conservative rule (correction pass §3) treats a genuine ISBN match as proof of
 * `exact_copy_same_edition`. An uncertain candidate's ISBN reaching that path would
 * defeat the point of that rule.
 *
 * Cover-visible evidence (`coverEvidence.visible*`) is independent of this gate —
 * it always populates proposed values when present, accepted candidate or not.
 */
export interface ProposedBookValues {
  title: string;
  subtitle: string | null;
  authors: string[];
  illustrators: string[];
  publisher: string | null;
  languageCode: string | null;
  additionalLanguageCodes: string[];
  isbn10: string | null;
  isbn13: string | null;
}

export interface CandidateAcceptanceResult {
  /** Whether reconciliation reached `high_confidence` — the one outcome that makes
   * a candidate's fields eligible to become canonical proposed values. */
  accepted: boolean;
  /** The accepted candidate's provider identifier, or `null` when nothing was
   * accepted (including when reconciliation only produced an ambiguous/unresolved
   * best guess) — this is what `draft.selectedCandidateProviderIdentifier` and
   * `book_identity_candidates.was_selected` are both driven from. */
  selectedCandidateProviderIdentifier: string | null;
  proposedBookValues: ProposedBookValues | null;
}

export function resolveCandidateAcceptance(
  coverEvidence: CoverIdentification | null | undefined,
  reconciliation: ReconciliationResult
): CandidateAcceptanceResult {
  const accepted = reconciliation.outcome === "high_confidence";
  const chosen = accepted ? reconciliation.best?.candidate : undefined;
  const selectedCandidateProviderIdentifier = accepted ? (reconciliation.best?.candidate.providerIdentifier ?? null) : null;

  const resolvedLanguage: LanguageCode | undefined =
    resolveProviderLanguage(coverEvidence?.visibleLanguage ?? undefined) ?? resolveProviderLanguage(chosen?.language) ?? undefined;

  const title = coverEvidence?.visibleTitle ?? chosen?.title ?? null;
  const proposedBookValues: ProposedBookValues | null = title
    ? {
        title,
        subtitle: coverEvidence?.visibleSubtitle ?? chosen?.subtitle ?? null,
        authors: coverEvidence?.visibleAuthors ?? chosen?.authors ?? [],
        illustrators: coverEvidence?.visibleIllustrators ?? [],
        publisher: coverEvidence?.visiblePublisherOrImprint ?? chosen?.publisher ?? null,
        languageCode: resolvedLanguage ?? null,
        additionalLanguageCodes: [],
        isbn10: chosen?.isbn10 ?? null,
        isbn13: chosen?.isbn13 ?? (coverEvidence?.visibleIsbn && coverEvidence.visibleIsbn.length >= 13 ? coverEvidence.visibleIsbn : null),
      }
    : null;

  return { accepted, selectedCandidateProviderIdentifier, proposedBookValues };
}

/** Computes the `wasSelected` flag for one candidate exactly as
 * `book_identity_candidates` should record it — `true` only for the accepted
 * candidate, `false` for every other candidate considered, including the
 * best-scoring one when reconciliation didn't reach `high_confidence`. */
export function wasSelected(candidate: NormalizedMetadataCandidate, acceptance: CandidateAcceptanceResult): boolean {
  return acceptance.accepted && candidate.providerIdentifier === acceptance.selectedCandidateProviderIdentifier;
}
