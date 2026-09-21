import { normalizeSearchText, normalizeTitle } from "@/lib/search/normalize";
import { findLanguageByName, isLanguageCode, type LanguageCode } from "@/lib/catalog/languages";
import type { CoverIdentification } from "@/lib/ai";
import type { NormalizedMetadataCandidate } from "@/lib/metadataProviders";
import { AMBIGUOUS_THRESHOLD, HIGH_CONFIDENCE_THRESHOLD, RECONCILIATION_WEIGHTS } from "./reconciliationConfig";

/**
 * Deterministic identity reconciliation (Phase 7, §16 of the phase brief) — combines
 * cover-visible evidence with bibliographic provider candidates using explicit,
 * centralized, tested weights (`reconciliationConfig.ts`), never "ask Gemini which
 * result is correct." Produces a real outcome classification with ranked candidates
 * and named evidence, not one opaque AI confidence number.
 */

export type ReconciliationOutcome = "high_confidence" | "ambiguous" | "unresolved";

export interface ReconciledCandidate {
  candidate: NormalizedMetadataCandidate;
  score: number;
  matchedSignals: string[];
}

export interface ReconciliationResult {
  outcome: ReconciliationOutcome;
  /** The top-ranked candidate — present whenever `ranked` is non-empty, regardless
   * of outcome (an `ambiguous` or even `unresolved` result can still name its best
   * available candidate; the outcome is what gates whether a caller *acts* on it
   * automatically). */
  best?: ReconciledCandidate;
  ranked: ReconciledCandidate[];
}

/** A small, deliberately incomplete MARC (3-letter) → ISO 639-1 map for the language
 * codes Open Library's Search API actually returns (§27 of the phase brief — "do
 * not assume English"). Only common, unambiguous mappings are included; an
 * unrecognized MARC code is left unmapped rather than guessed — matching this
 * pipeline's "correct absence over plausible invention" principle for every other
 * field. */
const MARC_TO_ISO_639_1: Record<string, LanguageCode> = {
  eng: "en",
  swe: "sv",
  nor: "no",
  nob: "nb",
  nno: "nn",
  dan: "da",
  fre: "fr",
  fra: "fr",
  ger: "de",
  deu: "de",
  spa: "es",
  ita: "it",
  dut: "nl",
  nld: "nl",
  por: "pt",
  fin: "fi",
  pol: "pl",
  rus: "ru",
  jpn: "ja",
  chi: "zh",
  zho: "zh",
  ara: "ar",
};

/** Resolves a provider's own free-text/coded language value to a real ISO 639-1
 * code, or `undefined` when it can't be confidently resolved — never a guess. Tries,
 * in order: already a valid ISO 639-1 code; a known MARC 3-letter code; a matched
 * display name (`findLanguageByName`, e.g. "Swedish"). */
export function resolveProviderLanguage(value: string | undefined): LanguageCode | undefined {
  if (!value) return undefined;
  const trimmed = value.trim().toLowerCase();
  if (isLanguageCode(trimmed)) return trimmed;
  if (MARC_TO_ISO_639_1[trimmed]) return MARC_TO_ISO_639_1[trimmed];
  return findLanguageByName(value);
}

function titlesMatch(a: string | null | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  return normalizeTitle(a) === normalizeTitle(b);
}

function authorsOverlap(coverAuthors: string[] | null | undefined, candidateAuthors: string[] | undefined): boolean {
  if (!coverAuthors || coverAuthors.length === 0 || !candidateAuthors || candidateAuthors.length === 0) return false;
  const normalizedCandidateAuthors = new Set(candidateAuthors.map((a) => normalizeSearchText(a)));
  return coverAuthors.some((a) => normalizedCandidateAuthors.has(normalizeSearchText(a)));
}

function isbnsMatch(coverIsbn: string | null | undefined, candidate: NormalizedMetadataCandidate): boolean {
  if (!coverIsbn) return false;
  const normalizedCoverIsbn = coverIsbn.replace(/[^0-9Xx]/g, "").toUpperCase();
  const candidateIsbns = [candidate.isbn10, candidate.isbn13].filter((v): v is string => Boolean(v));
  return candidateIsbns.some((isbn) => isbn.replace(/[^0-9Xx]/g, "").toUpperCase() === normalizedCoverIsbn);
}

function scoreCandidate(coverEvidence: CoverIdentification, candidate: NormalizedMetadataCandidate): ReconciledCandidate {
  let score = 0;
  const matchedSignals: string[] = [];

  if (isbnsMatch(coverEvidence.visibleIsbn, candidate)) {
    score += RECONCILIATION_WEIGHTS.isbnMatch;
    matchedSignals.push("isbn");
  }
  if (titlesMatch(coverEvidence.visibleTitle, candidate.title)) {
    score += RECONCILIATION_WEIGHTS.normalizedTitleMatch;
    matchedSignals.push("title");
  }
  if (titlesMatch(coverEvidence.visibleSubtitle, candidate.subtitle)) {
    score += RECONCILIATION_WEIGHTS.subtitleMatch;
    matchedSignals.push("subtitle");
  }
  if (authorsOverlap(coverEvidence.visibleAuthors, candidate.authors)) {
    score += RECONCILIATION_WEIGHTS.authorMatch;
    matchedSignals.push("author");
  }
  const coverLanguage = resolveProviderLanguage(coverEvidence.visibleLanguage ?? undefined);
  const candidateLanguage = resolveProviderLanguage(candidate.language);
  if (coverLanguage && candidateLanguage && coverLanguage === candidateLanguage) {
    score += RECONCILIATION_WEIGHTS.languageMatch;
    matchedSignals.push("language");
  }
  if (
    coverEvidence.visiblePublisherOrImprint &&
    candidate.publisher &&
    normalizeSearchText(coverEvidence.visiblePublisherOrImprint).includes(normalizeSearchText(candidate.publisher))
  ) {
    score += RECONCILIATION_WEIGHTS.publisherMatch;
    matchedSignals.push("publisher");
  }

  return { candidate, score, matchedSignals };
}

export function reconcileIdentity(coverEvidence: CoverIdentification, candidates: NormalizedMetadataCandidate[]): ReconciliationResult {
  if (candidates.length === 0) {
    return { outcome: "unresolved", ranked: [] };
  }

  const ranked = candidates
    .map((candidate) => scoreCandidate(coverEvidence, candidate))
    .sort((a, b) => b.score - a.score);

  const best = ranked[0];
  const outcome: ReconciliationOutcome =
    best.score >= HIGH_CONFIDENCE_THRESHOLD ? "high_confidence" : best.score >= AMBIGUOUS_THRESHOLD ? "ambiguous" : "unresolved";

  return { outcome, best, ranked };
}
