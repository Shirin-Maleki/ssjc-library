import { describe, expect, it } from "vitest";
import { mergeProviderSubjectsIntoTags } from "@/lib/intake/enrichmentMerge";
import { createInitialDraft, parseIntakeDraft } from "@/lib/intake/draft";
import { MAX_ENRICHMENT_TAGS, type EnrichmentSuggestion } from "@/lib/ai/schemas";

/**
 * Regression coverage for the real Phase 7 tag-merge schema mismatch bug: a
 * schema-valid (<=8 tag) AI suggestion, once merged with a subject-heavy accepted
 * provider candidate's `subjects`, could produce a >8-tag array that
 * `enrichAndSuggestCategoryAction()` then wrote into `draft.enrichmentSuggestion`
 * — and `saveDraft()`'s `parseIntakeDraft()` correctly rejected it at save time
 * with "Too big: expected array to have <=8 items".
 *
 * This exercises the same real, unmodified functions `enrichAndSuggestCategoryAction`
 * calls for its merge step (`mergeProviderSubjectsIntoTags`) and its save step
 * (`parseIntakeDraft`, the exact function that threw in production) — not a live
 * provider call. `actions.ts` itself (`"use server"`, `requireStaffSession()`,
 * `@/db/client`) cannot be imported directly in a Vitest unit test, matching this
 * codebase's established pattern for `candidateAcceptance.ts` /
 * `visionFailureClassification.ts` / `confirmFieldResolution.ts` — the fix belongs
 * in, and is proven at, the pure domain-logic layer those Server Actions delegate to.
 */
describe("intake/enrichmentFinalization — the real tag-merge failure path (tag-merge schema mismatch fix)", () => {
  it("a schema-valid <=8-tag AI suggestion merged with a subject-heavy accepted candidate never produces an invalid draft", () => {
    const draft = createInitialDraft({
      fileId: "drive-file-1",
      filename: "cover.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 12345,
      checksum: null,
    });
    draft.pipelineStage = "enriched";
    draft.proposedBookValues = {
      title: "The Gruffalo",
      subtitle: null,
      authors: ["Julia Donaldson"],
      illustrators: [],
      publisher: null,
      languageCode: "en",
      additionalLanguageCodes: [],
      isbn10: null,
      isbn13: null,
    };

    const aiSuggestion: EnrichmentSuggestion = {
      description: "A mouse invents a fearsome creature to scare off forest predators.",
      tags: ["forest", "clever-mouse", "monsters", "friendship", "courage", "trickery"],
      fictionType: "fiction",
      format: "picture_book",
      ageMinMonths: 36,
      ageMaxMonths: 72,
      readAloudMinutes: 8,
      visualMediaTypes: ["digital_illustration"],
      visualRealism: "stylized_illustration",
      physicalCategorySlug: "picture-books",
      categoryConfidence: "high",
      categoryReason: "Clearly a picture book.",
    };
    expect(aiSuggestion.tags.length).toBe(6);
    expect(aiSuggestion.tags.length).toBeLessThanOrEqual(MAX_ENRICHMENT_TAGS);

    draft.enrichmentSuggestion = aiSuggestion;
    draft.aiSuggestionsStatus = "valid";

    // A real accepted Open Library candidate with far more subjects than remaining
    // tag capacity — this is exactly the shape that triggered the real bug.
    draft.selectedCandidateProviderIdentifier = "OL12345W";
    draft.metadataCandidates = [
      {
        provider: "open_library",
        providerIdentifier: "OL12345W",
        title: "The Gruffalo",
        authors: ["Julia Donaldson"],
        subjects: [
          "Fairy tales",
          "Juvenile fiction",
          "Monsters",
          "Mice",
          "Forest animals",
          "Picture books",
          "Fantasy",
          "Adventure stories",
          "Bedtime stories",
          "Read-aloud books",
        ],
        matchScore: 0.95,
        matchedSignals: ["title", "author"],
      },
    ];

    // The exact merge step `enrichAndSuggestCategoryAction` performs.
    const selectedCandidate = draft.metadataCandidates.find(
      (c) => c.providerIdentifier === draft.selectedCandidateProviderIdentifier
    );
    const mergedTags = mergeProviderSubjectsIntoTags(draft.enrichmentSuggestion.tags, selectedCandidate?.subjects);

    expect(mergedTags.length).toBeLessThanOrEqual(MAX_ENRICHMENT_TAGS);
    expect(mergedTags.length).toBe(8); // 6 AI tags + exactly 2 new unique provider subjects (capacity-limited)
    // Original AI tags preserved first, in order, never displaced.
    expect(mergedTags.slice(0, 6)).toEqual(aiSuggestion.tags);

    draft.enrichmentSuggestion = { ...draft.enrichmentSuggestion, tags: mergedTags };
    draft.pipelineStage = "ready_for_confirmation";

    // The exact save-time validation that threw "Too big: expected array to have
    // <=8 items" in the real, reported failure — this must now succeed.
    const validated = parseIntakeDraft(draft);
    expect(validated.enrichmentSuggestion?.tags.length).toBeLessThanOrEqual(MAX_ENRICHMENT_TAGS);

    // The confirmation summary surfaces the same merged tags — never more than 8.
    const confirmationSummaryTags = validated.enrichmentSuggestion?.tags ?? [];
    expect(confirmationSummaryTags.length).toBeLessThanOrEqual(8);
  });
});
