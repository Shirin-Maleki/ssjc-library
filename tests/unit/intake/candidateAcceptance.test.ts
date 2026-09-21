import { describe, expect, it } from "vitest";
import { reconcileIdentity } from "@/lib/intake/reconciliation";
import { resolveCandidateAcceptance, wasSelected } from "@/lib/intake/candidateAcceptance";
import type { CoverIdentification } from "@/lib/ai/schemas";
import type { NormalizedMetadataCandidate } from "@/lib/metadataProviders/provider";

/**
 * Regression coverage for the Phase 7 final closure pass §1 identity-safety fix —
 * an uncertain (ambiguous/unresolved) provider candidate must never silently
 * become canonical bibliographic data, most importantly never its ISBN (which
 * duplicateMatcher.ts's own conservative rule would otherwise treat as proof of
 * `exact_copy_same_edition`).
 */

function emptyEvidence(overrides: Partial<CoverIdentification> = {}): CoverIdentification {
  return {
    visibleTitle: null,
    visibleSubtitle: null,
    visibleAuthors: null,
    visibleIllustrators: null,
    visiblePublisherOrImprint: null,
    visibleLanguage: null,
    visibleIsbn: null,
    visibleSeries: null,
    candidateSearchTerms: [],
    identityConfidenceLevel: "low",
    evidenceNotes: "",
    ...overrides,
  };
}

function candidate(overrides: Partial<NormalizedMetadataCandidate> = {}): NormalizedMetadataCandidate {
  return {
    provider: "open_library",
    providerIdentifier: "/works/OL1W",
    ...overrides,
  };
}

describe("intake/candidateAcceptance", () => {
  it("A. an ambiguous candidate with an ISBN does NOT populate the proposed ISBN", () => {
    // Title-only match (score 45) lands in the ambiguous band (30-74) — real
    // evidence, but not enough to accept automatically.
    const coverEvidence = emptyEvidence({ visibleTitle: "The Gruffalo" });
    const candidates = [candidate({ title: "The Gruffalo", isbn10: "0333710935", isbn13: "9780333710937" })];
    const reconciliation = reconcileIdentity(coverEvidence, candidates);
    expect(reconciliation.outcome).toBe("ambiguous");

    const acceptance = resolveCandidateAcceptance(coverEvidence, reconciliation);
    expect(acceptance.accepted).toBe(false);
    expect(acceptance.selectedCandidateProviderIdentifier).toBeNull();
    // Cover evidence never showed a title-only match's title as the proposed title
    // either — wait, title IS cover-visible here (independent of the gate) — but
    // the ISBN, which is provider-only, must not leak through.
    expect(acceptance.proposedBookValues?.title).toBe("The Gruffalo");
    expect(acceptance.proposedBookValues?.isbn10).toBeNull();
    expect(acceptance.proposedBookValues?.isbn13).toBeNull();
  });

  it("B. an unresolved candidate with an ISBN does NOT reach proposed values at all", () => {
    // No evidence overlaps the candidate at all — score 0, below even the
    // ambiguous threshold — genuinely unresolved.
    const coverEvidence = emptyEvidence();
    const candidates = [candidate({ title: "Some Other Book", isbn10: "1111111111", isbn13: "9781111111111" })];
    const reconciliation = reconcileIdentity(coverEvidence, candidates);
    expect(reconciliation.outcome).toBe("unresolved");
    expect(reconciliation.best).toBeDefined(); // still ranked/named for audit

    const acceptance = resolveCandidateAcceptance(coverEvidence, reconciliation);
    expect(acceptance.accepted).toBe(false);
    expect(acceptance.selectedCandidateProviderIdentifier).toBeNull();
    // No cover-visible title either, in this case — nothing to propose at all,
    // and specifically never the unresolved candidate's ISBN.
    expect(acceptance.proposedBookValues).toBeNull();
  });

  it("C. wasSelected() is false for every candidate when nothing was accepted (ambiguous)", () => {
    const coverEvidence = emptyEvidence({ visibleTitle: "The Gruffalo" });
    const best = candidate({ providerIdentifier: "/works/OL1W", title: "The Gruffalo", isbn13: "9780333710937" });
    const other = candidate({ providerIdentifier: "/works/OL2W", title: "Something else entirely" });
    const reconciliation = reconcileIdentity(coverEvidence, [best, other]);
    expect(reconciliation.outcome).toBe("ambiguous");

    const acceptance = resolveCandidateAcceptance(coverEvidence, reconciliation);
    expect(wasSelected(best, acceptance)).toBe(false);
    expect(wasSelected(other, acceptance)).toBe(false);
  });

  it("D. a high-confidence candidate (real ISBN match) is accepted and its fields adopted", () => {
    const coverEvidence = emptyEvidence({ visibleTitle: "The Gruffalo", visibleIsbn: "9780333710937" });
    const matched = candidate({
      providerIdentifier: "/works/OL1W",
      title: "The Gruffalo",
      isbn10: "0333710935",
      isbn13: "9780333710937",
      publisher: "Macmillan",
      authors: ["Julia Donaldson"],
    });
    const other = candidate({ providerIdentifier: "/works/OL2W", title: "Unrelated Book" });
    const reconciliation = reconcileIdentity(coverEvidence, [matched, other]);
    expect(reconciliation.outcome).toBe("high_confidence");

    const acceptance = resolveCandidateAcceptance(coverEvidence, reconciliation);
    expect(acceptance.accepted).toBe(true);
    expect(acceptance.selectedCandidateProviderIdentifier).toBe("/works/OL1W");
    expect(acceptance.proposedBookValues?.isbn10).toBe("0333710935");
    expect(acceptance.proposedBookValues?.isbn13).toBe("9780333710937");
    expect(acceptance.proposedBookValues?.publisher).toBe("Macmillan");
    expect(wasSelected(matched, acceptance)).toBe(true);
    expect(wasSelected(other, acceptance)).toBe(false);
  });

  it("cover-visible evidence populates proposed values independently of acceptance", () => {
    // No candidates at all (unresolved, no `best`) — cover evidence alone must
    // still be usable so a teacher can confirm from cover-visible evidence + Quick
    // Edit, per the brief's explicit requirement that high-confidence provider
    // metadata is never made mandatory to save a book.
    const coverEvidence = emptyEvidence({ visibleTitle: "A Book With No Provider Match", visibleAuthors: ["Jane Doe"] });
    const reconciliation = reconcileIdentity(coverEvidence, []);
    expect(reconciliation.outcome).toBe("unresolved");
    expect(reconciliation.best).toBeUndefined();

    const acceptance = resolveCandidateAcceptance(coverEvidence, reconciliation);
    expect(acceptance.proposedBookValues?.title).toBe("A Book With No Provider Match");
    expect(acceptance.proposedBookValues?.authors).toEqual(["Jane Doe"]);
    expect(acceptance.proposedBookValues?.isbn10).toBeNull();
    expect(acceptance.proposedBookValues?.isbn13).toBeNull();
  });
});
