import { describe, expect, it } from "vitest";
import { reconcileIdentity, resolveProviderLanguage } from "@/lib/intake/reconciliation";
import type { CoverIdentification } from "@/lib/ai/schemas";
import type { NormalizedMetadataCandidate } from "@/lib/metadataProviders/provider";

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
    provider: "google_books",
    providerIdentifier: "abc123",
    ...overrides,
  };
}

describe("intake/reconciliation — resolveProviderLanguage", () => {
  it("passes through an already-valid ISO 639-1 code", () => {
    expect(resolveProviderLanguage("en")).toBe("en");
  });

  it("maps a known MARC 3-letter code", () => {
    expect(resolveProviderLanguage("swe")).toBe("sv");
    expect(resolveProviderLanguage("fre")).toBe("fr");
    expect(resolveProviderLanguage("fra")).toBe("fr");
  });

  it("resolves a display name", () => {
    expect(resolveProviderLanguage("Swedish")).toBe("sv");
  });

  it("returns undefined for an unrecognized value rather than guessing", () => {
    expect(resolveProviderLanguage("klingon")).toBeUndefined();
    expect(resolveProviderLanguage(undefined)).toBeUndefined();
    expect(resolveProviderLanguage("")).toBeUndefined();
  });
});

describe("intake/reconciliation — reconcileIdentity", () => {
  it("is unresolved with zero candidates", () => {
    const result = reconcileIdentity(emptyEvidence(), []);
    expect(result.outcome).toBe("unresolved");
    expect(result.ranked).toEqual([]);
    expect(result.best).toBeUndefined();
  });

  it("is high_confidence on an ISBN match alone", () => {
    const evidence = emptyEvidence({ visibleIsbn: "978-0-14-036621-7" });
    const result = reconcileIdentity(evidence, [candidate({ isbn13: "9780140366217" })]);
    expect(result.outcome).toBe("high_confidence");
    expect(result.best?.matchedSignals).toContain("isbn");
  });

  it("is high_confidence on a strong title+author combination without an ISBN", () => {
    const evidence = emptyEvidence({ visibleTitle: "The Gruffalo", visibleAuthors: ["Julia Donaldson"] });
    const result = reconcileIdentity(evidence, [candidate({ title: "The Gruffalo", authors: ["Julia Donaldson"] })]);
    expect(result.outcome).toBe("high_confidence");
    expect(result.best?.matchedSignals).toEqual(expect.arrayContaining(["title", "author"]));
  });

  it("is ambiguous on a title-only match (weak evidence, real but insufficient)", () => {
    const evidence = emptyEvidence({ visibleTitle: "The Gruffalo" });
    const result = reconcileIdentity(evidence, [candidate({ title: "The Gruffalo" })]);
    expect(result.outcome).toBe("ambiguous");
  });

  it("is unresolved when nothing at all matches", () => {
    const evidence = emptyEvidence({ visibleTitle: "Some Unrelated Book" });
    const result = reconcileIdentity(evidence, [candidate({ title: "A Completely Different Title" })]);
    expect(result.outcome).toBe("unresolved");
    expect(result.best?.score).toBe(0);
  });

  it("never matches title/author signals when the cover shows nothing (no false positives from absence)", () => {
    const evidence = emptyEvidence();
    const result = reconcileIdentity(evidence, [candidate({ title: "Anything", authors: ["Anyone"] })]);
    expect(result.outcome).toBe("unresolved");
    expect(result.best?.matchedSignals).toEqual([]);
  });

  it("ranks multiple candidates by score, best first", () => {
    const evidence = emptyEvidence({ visibleTitle: "The Gruffalo", visibleAuthors: ["Julia Donaldson"] });
    const weak = candidate({ providerIdentifier: "weak", title: "The Gruffalo" });
    const strong = candidate({ providerIdentifier: "strong", title: "The Gruffalo", authors: ["Julia Donaldson"] });
    const result = reconcileIdentity(evidence, [weak, strong]);
    expect(result.ranked[0].candidate.providerIdentifier).toBe("strong");
    expect(result.ranked[1].candidate.providerIdentifier).toBe("weak");
    expect(result.best?.candidate.providerIdentifier).toBe("strong");
  });

  it("matches a conflicting-language candidate on title alone, without a false language signal", () => {
    const evidence = emptyEvidence({ visibleTitle: "Bébé", visibleLanguage: "French" });
    const result = reconcileIdentity(evidence, [candidate({ title: "Bébé", language: "eng" })]);
    expect(result.best?.matchedSignals).toContain("title");
    expect(result.best?.matchedSignals).not.toContain("language");
  });

  it("matches publisher as a substring, not requiring an exact string match", () => {
    const evidence = emptyEvidence({ visiblePublisherOrImprint: "Scholastic Press" });
    const result = reconcileIdentity(evidence, [candidate({ publisher: "Scholastic" })]);
    expect(result.best?.matchedSignals).toContain("publisher");
  });

  it("treats a case/punctuation-different ISBN as a genuine match", () => {
    const evidence = emptyEvidence({ visibleIsbn: "0-14-036621-1" });
    const result = reconcileIdentity(evidence, [candidate({ isbn10: "0140366211" })]);
    expect(result.best?.matchedSignals).toContain("isbn");
  });
});
