import { describe, expect, it } from "vitest";
import {
  buildAdminReviewQueue,
  buildLowConfidenceSignal,
  classifyNeedsReviewReason,
  reasonCodeForReviewFlagType,
  type ReviewQueueSignal,
} from "@/lib/admin/reviewQueue";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-09-21T00:00:00Z");
function daysAgo(n: number): Date {
  return new Date(NOW.getTime() - n * DAY_MS);
}

describe("admin/reviewQueue — buildAdminReviewQueue", () => {
  it("a single signal produces a single queue item with that reason as primary", () => {
    const signals: ReviewQueueSignal[] = [
      { key: "ingestion:i1", ingestionItemId: "i1", title: null, createdAt: daysAgo(1), reason: "identity_needs_review" },
    ];
    const items = buildAdminReviewQueue(signals);
    expect(items).toHaveLength(1);
    expect(items[0].ingestionItemId).toBe("i1");
    expect(items[0].primaryReason.code).toBe("identity_needs_review");
    expect(items[0].title).toBe("Title not identified");
    expect(items[0].secondaryReasonCount).toBe(0);
  });

  it("multiple signals sharing the same key merge into ONE item, not several", () => {
    const signals: ReviewQueueSignal[] = [
      { key: "book:b1", bookId: "b1", title: "The Gruffalo", createdAt: daysAgo(3), reason: "category_missing" },
      { key: "book:b1", bookId: "b1", title: "The Gruffalo", createdAt: daysAgo(2), reason: "missing_metadata", reasonDetail: "Missing description" },
    ];
    const items = buildAdminReviewQueue(signals);
    expect(items).toHaveLength(1);
    expect(items[0].reasons).toHaveLength(2);
    // category_missing (priority 2) outranks missing_metadata (priority 4)
    expect(items[0].primaryReason.code).toBe("category_missing");
    expect(items[0].secondaryReasonCount).toBe(1);
  });

  it("the same reason code reported twice for the same key is not duplicated", () => {
    const signals: ReviewQueueSignal[] = [
      { key: "book:b1", bookId: "b1", title: "X", createdAt: daysAgo(1), reason: "category_missing" },
      { key: "book:b1", bookId: "b1", title: "X", createdAt: daysAgo(1), reason: "category_missing" },
    ];
    const items = buildAdminReviewQueue(signals);
    expect(items[0].reasons).toHaveLength(1);
  });

  it("sorts by priority first: identity/duplicate (1) before category (2) before conflict (3) before missing metadata (4)", () => {
    const signals: ReviewQueueSignal[] = [
      { key: "book:low", bookId: "low", title: "Low", createdAt: daysAgo(1), reason: "missing_metadata" },
      { key: "book:conflict", bookId: "conflict", title: "Conflict", createdAt: daysAgo(1), reason: "metadata_conflict" },
      { key: "book:cat", bookId: "cat", title: "Cat", createdAt: daysAgo(1), reason: "category_uncertain" },
      { key: "book:dup", bookId: "dup", title: "Dup", createdAt: daysAgo(1), reason: "possible_duplicate" },
    ];
    const items = buildAdminReviewQueue(signals);
    expect(items.map((i) => i.key)).toEqual(["book:dup", "book:cat", "book:conflict", "book:low"]);
  });

  it("within the same priority, the oldest entered-review item comes first", () => {
    const signals: ReviewQueueSignal[] = [
      { key: "book:newer", bookId: "newer", title: "Newer", createdAt: daysAgo(1), reason: "missing_metadata" },
      { key: "book:older", bookId: "older", title: "Older", createdAt: daysAgo(10), reason: "missing_metadata" },
    ];
    const items = buildAdminReviewQueue(signals);
    expect(items.map((i) => i.key)).toEqual(["book:older", "book:newer"]);
  });

  it("an empty signal list produces an empty queue (the empty state)", () => {
    expect(buildAdminReviewQueue([])).toEqual([]);
  });

  it("a real title overrides the 'Title not identified' fallback whichever signal supplies it", () => {
    const signals: ReviewQueueSignal[] = [
      { key: "ingestion:i1", ingestionItemId: "i1", title: null, createdAt: daysAgo(2), reason: "category_missing" },
      { key: "ingestion:i1", ingestionItemId: "i1", title: "The Gruffalo", createdAt: daysAgo(1), reason: "missing_metadata" },
    ];
    const items = buildAdminReviewQueue(signals);
    expect(items[0].title).toBe("The Gruffalo");
  });
});

describe("admin/reviewQueue — reasonCodeForReviewFlagType", () => {
  it("maps every known flag type to its human reason code", () => {
    expect(reasonCodeForReviewFlagType("duplicate_uncertain")).toBe("possible_duplicate");
    expect(reasonCodeForReviewFlagType("category_uncertain")).toBe("category_uncertain");
    expect(reasonCodeForReviewFlagType("metadata_conflict")).toBe("metadata_conflict");
    expect(reasonCodeForReviewFlagType("missing_metadata")).toBe("missing_metadata");
    expect(reasonCodeForReviewFlagType("visual_style_uncertain")).toBe("missing_metadata");
  });

  it("falls back to identity_needs_review for a generic/unknown flag type", () => {
    expect(reasonCodeForReviewFlagType("user_flagged")).toBe("identity_needs_review");
    expect(reasonCodeForReviewFlagType("something_unrecognized")).toBe("identity_needs_review");
  });
});

describe("admin/reviewQueue — classifyNeedsReviewReason", () => {
  it("an unreadable/stale draft is itself a reason for review", () => {
    const result = classifyNeedsReviewReason({ draftValid: false, title: null, hasUnresolvedDuplicate: false, hasConfirmedCategory: false });
    expect(result.code).toBe("identity_needs_review");
    expect(result.detail).toBeTruthy();
  });

  it("an unresolved duplicate outranks a missing category", () => {
    const result = classifyNeedsReviewReason({ draftValid: true, title: "X", hasUnresolvedDuplicate: true, hasConfirmedCategory: false });
    expect(result.code).toBe("possible_duplicate");
  });

  it("no title identified at all is an identity reason", () => {
    const result = classifyNeedsReviewReason({ draftValid: true, title: null, hasUnresolvedDuplicate: false, hasConfirmedCategory: false });
    expect(result.code).toBe("identity_needs_review");
  });

  it("a title but no confirmed category is a category reason", () => {
    const result = classifyNeedsReviewReason({ draftValid: true, title: "X", hasUnresolvedDuplicate: false, hasConfirmedCategory: false });
    expect(result.code).toBe("category_missing");
  });

  it("title and category both present falls back to the generic awaiting-decision reason", () => {
    const result = classifyNeedsReviewReason({ draftValid: true, title: "X", hasUnresolvedDuplicate: false, hasConfirmedCategory: true });
    expect(result.code).toBe("identity_needs_review");
  });
});

describe("admin/reviewQueue — buildLowConfidenceSignal", () => {
  it("combines multiple low-confidence fields on the same book into one signal, never one per field", () => {
    const signal = buildLowConfidenceSignal({
      key: "book:b1",
      bookId: "b1",
      title: "X",
      fieldLabels: ["category", "age range"],
      createdAt: daysAgo(1),
    });
    expect(signal?.reason).toBe("low_confidence_field");
    expect(signal?.reasonDetail).toContain("category");
    expect(signal?.reasonDetail).toContain("age range");
    expect(signal?.reasonDetail).not.toMatch(/0\.\d/); // never a raw decimal
  });

  it("returns undefined when there is nothing low-confidence", () => {
    const signal = buildLowConfidenceSignal({ key: "book:b1", bookId: "b1", title: "X", fieldLabels: [], createdAt: daysAgo(1) });
    expect(signal).toBeUndefined();
  });
});
