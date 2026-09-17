import { describe, expect, it } from "vitest";
import type { Book } from "@/lib/catalog/types";
import type { CandidateSignals } from "@/db/repositories/searchRepository";
import { combineScores, rankScoredBooks } from "@/lib/search/hybridScore";
import { RANKING_WEIGHTS, RETRIEVAL_SIGNAL_WEIGHTS } from "@/lib/search/rankingConfig";

function makeBook(overrides: Partial<Book> & { id: string; title: string }): Book {
  return {
    subtitle: undefined,
    authors: ["Fixture Author"],
    illustrators: [],
    publisher: "Fixture Publisher",
    languageCode: "en",
    description: "A fixture description with no special keywords.",
    ageMinMonths: 36,
    ageMaxMonths: 72,
    fictionType: "fiction",
    format: "picture_book",
    physicalCategory: "stories-imagination",
    tags: [],
    illustrationStyles: ["watercolor"],
    visualRealism: "stylized_illustration",
    readAloudMinutes: 5,
    cover: { variant: 0 },
    sortTitle: overrides.title,
    ...overrides,
  };
}

function signals(overrides: Partial<CandidateSignals> = {}): CandidateSignals {
  return { bookId: "x", ftsRank: 0, trgmSimilarity: 0, vectorDistance: null, exactMatch: false, ...overrides };
}

describe("combineScores", () => {
  it("with no signals at all, falls back to the unchanged deterministic score", () => {
    const book = makeBook({ id: "a", title: "Dinosaur Adventure" });
    const deterministic = combineScores(book, "dinosaur adventure", undefined);
    expect(deterministic.score).toBeGreaterThan(0);
    expect(deterministic.reasons.some((r) => r.type === "title_exact")).toBe(true);
  });

  it("an exact retrieval match adds a flat, large bonus and a reason", () => {
    const book = makeBook({ id: "a", title: "Totally Unrelated Title" });
    const withSignal = combineScores(book, "9780000000000", signals({ exactMatch: true }));
    expect(withSignal.score).toBeGreaterThanOrEqual(RETRIEVAL_SIGNAL_WEIGHTS.exactRetrievalMatch);
    expect(withSignal.reasons.some((r) => r.type === "exact_retrieval")).toBe(true);
  });

  it("a full-text rank contribution is capped well below exact-title weight", () => {
    const book = makeBook({ id: "a", title: "Totally Unrelated Title" });
    // An unrealistically large ts_rank should still never approach exactTitle (100).
    const scored = combineScores(book, "query", signals({ ftsRank: 10 }));
    expect(scored.score).toBeLessThan(RANKING_WEIGHTS.exactTitle);
    expect(scored.score).toBeLessThanOrEqual(RETRIEVAL_SIGNAL_WEIGHTS.fullTextRank);
  });

  it("a trigram similarity contribution scales linearly with the 0-1 similarity value", () => {
    const book = makeBook({ id: "a", title: "Totally Unrelated Title" });
    const low = combineScores(book, "query", signals({ trgmSimilarity: 0.2 }));
    const high = combineScores(book, "query", signals({ trgmSimilarity: 0.8 }));
    expect(high.score).toBeGreaterThan(low.score);
    expect(low.reasons.some((r) => r.type === "fuzzy_match")).toBe(true);
  });

  it("a semantic (vector) contribution is the smallest of the four signal weights and never dominates", () => {
    const book = makeBook({ id: "a", title: "Totally Unrelated Title" });
    // A near-identical vector (distance ~0) is the best possible semantic signal.
    const scored = combineScores(book, "query", signals({ vectorDistance: 0 }));
    expect(scored.score).toBeCloseTo(RETRIEVAL_SIGNAL_WEIGHTS.semanticSimilarity, 5);
    expect(scored.reasons.some((r) => r.type === "semantic")).toBe(true);
    expect(RETRIEVAL_SIGNAL_WEIGHTS.semanticSimilarity).toBeLessThan(RETRIEVAL_SIGNAL_WEIGHTS.trigramSimilarity);
    expect(RETRIEVAL_SIGNAL_WEIGHTS.semanticSimilarity).toBeLessThan(RETRIEVAL_SIGNAL_WEIGHTS.fullTextRank);
  });

  it("a vector distance at or beyond the meaningful ceiling contributes nothing", () => {
    const book = makeBook({ id: "a", title: "Totally Unrelated Title" });
    const scored = combineScores(book, "query", signals({ vectorDistance: 1 }));
    expect(scored.score).toBe(0);
    expect(scored.reasons.some((r) => r.type === "semantic")).toBe(false);
  });

  it("a real deterministic exact-title match still outranks a purely semantic/fuzzy match on an unrelated book", () => {
    const exactTitleBook = makeBook({ id: "a", title: "Dinosaur Adventure" });
    const semanticOnlyBook = makeBook({ id: "b", title: "Totally Unrelated Title" });

    const exact = combineScores(exactTitleBook, "dinosaur adventure", undefined);
    const semantic = combineScores(semanticOnlyBook, "dinosaur adventure", signals({ vectorDistance: 0.1 }));

    expect(exact.score).toBeGreaterThan(semantic.score);
  });
});

describe("rankScoredBooks", () => {
  it("drops books at or below the meaningful-score threshold — never pads results", () => {
    const zero = combineScores(makeBook({ id: "a", title: "Unrelated" }), "dinosaur adventure", undefined);
    const real = combineScores(makeBook({ id: "b", title: "Dinosaur Adventure" }), "dinosaur adventure", undefined);
    const ranked = rankScoredBooks([zero, real]);
    expect(ranked.map((r) => r.book.id)).toEqual(["b"]);
  });

  it("sorts by score descending, with a deterministic alphabetical tie-break", () => {
    const a = combineScores(makeBook({ id: "a", title: "Zebra Book", sortTitle: "Zebra Book" }), "book", signals({ exactMatch: true }));
    const b = combineScores(makeBook({ id: "b", title: "Apple Book", sortTitle: "Apple Book" }), "book", signals({ exactMatch: true }));
    const ranked = rankScoredBooks([a, b]);
    expect(ranked.map((r) => r.book.id)).toEqual(["b", "a"]);
  });
});
