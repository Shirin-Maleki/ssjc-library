"use server";

import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { ingestionItems, ingestionJobs, auditLog } from "@/db/schema";
import { bookRepository, categoryRepository } from "@/db/repositories";
import { requireStaffSession, getSession } from "@/lib/auth/guards";
import { isUuid } from "@/lib/utils/uuid";
import { getConfiguredCoverStorageProvider, DriveProviderError } from "@/lib/googleDrive";
import { getConfiguredBookIntelligenceProvider } from "@/lib/ai";
import { getConfiguredMetadataProviders } from "@/lib/metadataProviders";
import { getConfiguredEmbeddingProvider } from "@/lib/embeddings";
import { generateEmbeddingForBook } from "@/lib/embeddings/generation";
import { prepareAnalysisImage, resolveRotationHint } from "./imagePrep";
import { classifyVisionFailure } from "./visionFailureClassification";
import { reconcileIdentity } from "./reconciliation";
import { resolveCandidateAcceptance, wasSelected as candidateWasSelected } from "./candidateAcceptance";
import { lookupMetadataCandidates } from "./metadataLookup";
import { findDuplicateCandidates, type DuplicateCandidate } from "./duplicateMatcher";
import { validateCategorySuggestion } from "./categorySuggestion";
import { mergeProviderSubjectsIntoTags } from "./enrichmentMerge";
import { selectTrustworthyDisplayCoverUrl } from "./displayCover";
import { persistIdentityCandidates } from "./identityCandidates";
import { readIntakeDraft, parseIntakeDraft, type IntakeDraft, type TeacherEdits, type AnalysisRotationDegrees } from "./draft";
import { isE2EFakeProvidersEnabled, buildFakeCoverEvidence, buildFakeAiSuggestions, buildFakeMetadataCandidates } from "./e2eFixtures";
import { saveNewBook, addAnotherCopy, saveForReview, type ProvenanceInput } from "./persistence";
import { isLanguageCode } from "@/lib/catalog/languages";
import type { LanguageCode, Format, FictionType, IllustrationStyle, VisualRealism } from "@/lib/catalog/types";

/**
 * The authenticated Server Action boundary for the Phase 7 single-book intake
 * pipeline (§45 of the phase brief) — every action independently calls
 * `requireStaffSession()` first, exactly matching
 * `src/lib/reading-lists/actions.ts`'s established convention. Thin by design: each
 * action validates input, loads/saves the `ingestion_items` draft, and delegates
 * real logic to `src/lib/intake/*` domain services and `src/lib/{ai,
 * metadataProviders, googleDrive, embeddings}` providers — never inline business
 * logic here.
 */

function assertValidId(id: string): void {
  if (!isUuid(id)) throw new Error("Invalid id.");
}

async function loadDraft(ingestionItemId: string): Promise<{ draft: IntakeDraft; jobId: string }> {
  const [row] = await db.select().from(ingestionItems).where(eq(ingestionItems.id, ingestionItemId)).limit(1);
  if (!row) throw new Error("Ingestion item not found.");
  const draft = readIntakeDraft(row.intakeDraft);
  if (!draft) throw new Error("This intake has no valid draft to resume — start a new one.");
  return { draft, jobId: row.jobId };
}

async function saveDraft(ingestionItemId: string, draft: IntakeDraft): Promise<void> {
  const validated = parseIntakeDraft(draft);
  await db.update(ingestionItems).set({ intakeDraft: validated }).where(eq(ingestionItems.id, ingestionItemId));
}

/** Never a raw provider/infrastructure error reaching the browser — every action
 * catches its own known error types and returns a calm, categorized result instead
 * of throwing across the Server Action boundary (§40 of the phase brief). */
export interface ActionFailure {
  ok: false;
  category: string;
  message: string;
}

function failure(category: string, message: string): ActionFailure {
  return { ok: false, category, message };
}

// ---------------------------------------------------------------------------
// Step 1 — cover upload: handled by the `/api/intake/cover` Route Handler, not a
// Server Action here (see that file and `docs/DECISIONS.md` for why: real browser
// testing proved the originally-specified direct-browser-to-Drive PUT is blocked
// by CORS, and Server Actions have no upload-progress events for the corrected,
// server-mediated replacement).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Step 2 — cover identification (vision)
// ---------------------------------------------------------------------------

export type IdentifyCoverResult =
  | ActionFailure
  | {
      ok: true;
      visibleTitle: string | null;
      visibleAuthors: string[] | null;
      identityConfidenceLevel: "high" | "medium" | "low";
      /** `false` when identification produced no usable title — real-cover
       * correction pass §5. The caller must not silently continue into metadata
       * lookup/enrichment in this case; it should show the teacher a recovery
       * choice instead (retry, rotate, or explicitly continue with a manual
       * fallback). A vision-provider call that succeeds but genuinely can't read
       * the cover is not a thrown error — this is how that real case surfaces. */
      hasUsableIdentification: boolean;
    };

/**
 * Runs (or re-runs) cover identification for an already-uploaded Drive source.
 * `manualRotationDegrees` (default 0, real-cover correction pass §6) is the
 * teacher's chosen correction on top of EXIF auto-orientation — persisted into the
 * draft so a later retry of this exact action (no rotation argument needed) reuses
 * whatever was last chosen, without the browser having to remember it across a
 * reload.
 */
export async function identifyCoverAction(ingestionItemId: string, manualRotationDegrees: AnalysisRotationDegrees = 0): Promise<IdentifyCoverResult> {
  await requireStaffSession();
  assertValidId(ingestionItemId);

  const { draft } = await loadDraft(ingestionItemId);
  draft.analysisRotationDegrees = manualRotationDegrees;

  // E2E fixture path — see e2eFixtures.ts's own doc comment. Skips both the real
  // Drive download and the real Gemini vision call; the rest of the pipeline
  // (metadata lookup, reconciliation, real duplicate-check against the real
  // seeded catalog, save) runs unmodified against this fixture evidence.
  if (isE2EFakeProvidersEnabled()) {
    // Deterministic simulation of the "service temporarily unavailable" outcome
    // (real-cover correction pass, final round §2) — a filename-keyed fixture,
    // exactly like every other E2E scenario in this seam, since there is no real
    // provider call to make throw in fake mode.
    if (draft.driveSource.filename.toLowerCase().includes("serviceunavailable")) {
      await saveDraft(ingestionItemId, draft);
      return failure("identification_unavailable", "Automatic book recognition is temporarily unavailable.");
    }
    const evidence = buildFakeCoverEvidence(draft.driveSource.filename);
    draft.coverEvidence = evidence;
    const fakeSuggestions = buildFakeAiSuggestions(draft.driveSource.filename);
    if (fakeSuggestions) {
      const activeCategories = await categoryRepository.listActiveCategories();
      draft.enrichmentSuggestion = fakeSuggestions;
      draft.categorySuggestion = toCategorySuggestionRecord(validateCategorySuggestion(fakeSuggestions, activeCategories));
    }
    draft.pipelineStage = "identified";
    await saveDraft(ingestionItemId, draft);
    return {
      ok: true,
      visibleTitle: evidence.visibleTitle,
      visibleAuthors: evidence.visibleAuthors,
      identityConfidenceLevel: evidence.identityConfidenceLevel,
      hasUsableIdentification: Boolean(evidence.visibleTitle?.trim()),
    };
  }

  const driveProvider = getConfiguredCoverStorageProvider();
  const aiProvider = getConfiguredBookIntelligenceProvider();
  if (!driveProvider) return failure("configuration_missing", "Photo storage isn't configured.");
  if (!aiProvider) return failure("configuration_missing", "Book identification isn't configured.");

  let downloaded;
  try {
    downloaded = await driveProvider.downloadSource(draft.driveSource.fileId);
  } catch (error) {
    return failure(categoryOf(error), "Couldn't read the uploaded photo back. Please try again.");
  }

  const analysisImage = await prepareAnalysisImage(downloaded.bytes, draft.driveSource.mimeType, manualRotationDegrees);
  const rotationHint = resolveRotationHint(analysisImage, manualRotationDegrees);
  const activeCategories = await categoryRepository.listActiveCategories();

  // AI-first catalog draft correction (§3): ONE combined multimodal request
  // returns both the strict visible-evidence extraction AND genuinely inferential
  // catalog-assistance suggestions — replacing the original two-sequential-call
  // design (a separate `suggestEnrichment` call later in the pipeline no longer
  // exists). See `analyzeCover`'s own doc comment for why this halves the default
  // per-book Gemini call count.
  let analysis;
  try {
    analysis = await aiProvider.analyzeCover({
      imageBytes: analysisImage.bytes,
      mimeType: analysisImage.mimeType,
      teacherRotationHintDegrees: rotationHint,
      activeCategories,
    });
  } catch (error) {
    await saveDraft(ingestionItemId, draft); // still persist the chosen rotation for the next retry
    const classified = classifyVisionFailure(error);
    return failure(classified.category, classified.message);
  }

  draft.coverEvidence = analysis.coverEvidence;
  draft.enrichmentSuggestion = analysis.aiSuggestions;
  draft.categorySuggestion = toCategorySuggestionRecord(validateCategorySuggestion(analysis.aiSuggestions, activeCategories));
  draft.pipelineStage = "identified";
  await saveDraft(ingestionItemId, draft);

  return {
    ok: true,
    visibleTitle: analysis.coverEvidence.visibleTitle,
    visibleAuthors: analysis.coverEvidence.visibleAuthors,
    identityConfidenceLevel: analysis.coverEvidence.identityConfidenceLevel,
    hasUsableIdentification: Boolean(analysis.coverEvidence.visibleTitle?.trim()),
  };
}

// ---------------------------------------------------------------------------
// Step 4 — bibliographic metadata lookup + reconciliation
// ---------------------------------------------------------------------------

export type LookupMetadataResult =
  | ActionFailure
  | { ok: true; reconciliationOutcome: "high_confidence" | "ambiguous" | "unresolved"; title: string | null; languageCode: string | null };

export async function lookupMetadataAction(ingestionItemId: string): Promise<LookupMetadataResult> {
  await requireStaffSession();
  assertValidId(ingestionItemId);

  const { draft } = await loadDraft(ingestionItemId);
  const coverEvidence = draft.coverEvidence;

  let lookupResult;
  if (isE2EFakeProvidersEnabled()) {
    // E2E fixture path — see e2eFixtures.ts's own doc comment. Skips the real
    // metadata providers entirely (already inert via getConfiguredMetadataProviders()
    // returning none in E2E, but this also lets one specific fixture scenario
    // produce a real-shaped candidate to exercise the display-cover path).
    lookupResult = {
      candidates: buildFakeMetadataCandidates(draft.driveSource.filename, coverEvidence?.visibleTitle ?? null),
      providersQueried: [],
      providerErrors: [],
    };
  } else {
    const providers = getConfiguredMetadataProviders();
    const query = {
      isbn: coverEvidence?.visibleIsbn ?? undefined,
      title: coverEvidence?.visibleTitle ?? undefined,
      authors: coverEvidence?.visibleAuthors ?? undefined,
      language: coverEvidence?.visibleLanguage ?? undefined,
    };
    try {
      lookupResult = query.isbn || query.title ? await lookupMetadataCandidates(db, providers, query) : { candidates: [], providersQueried: [], providerErrors: [] };
    } catch {
      lookupResult = { candidates: [], providersQueried: [], providerErrors: [{ provider: "unknown", category: "unexpected_provider_failure" }] };
    }
  }

  const reconciliation = coverEvidence ? reconcileIdentity(coverEvidence, lookupResult.candidates) : { outcome: "unresolved" as const, ranked: [] };

  draft.metadataCandidates = lookupResult.candidates.map((c) => {
    const scored = reconciliation.ranked.find((r) => r.candidate.providerIdentifier === c.providerIdentifier);
    return { ...c, matchScore: scored?.score ?? 0, matchedSignals: scored?.matchedSignals ?? [] };
  });
  draft.reconciliationOutcome = reconciliation.outcome;

  // Identity-safety fix (Phase 7 final closure pass §1) — the actual gating logic
  // lives in `candidateAcceptance.ts`'s pure `resolveCandidateAcceptance()`,
  // specifically so it's unit-testable without a database connection or staff
  // session. An "accepted" provider candidate — one whose fields are trusted enough
  // to silently become canonical bibliographic data — requires `high_confidence`,
  // never merely "the best-scoring candidate we saw." An `ambiguous`/`unresolved`
  // best candidate is still ranked and still recorded for audit (both
  // `draft.metadataCandidates` above and `book_identity_candidates` below), but is
  // never adopted: adopting an uncertain candidate's ISBN, in particular, could let
  // duplicate detection mistake it for proof of `exact_copy_same_edition` (see
  // duplicateMatcher.ts's own conservative ISBN-only rule for that path — this is
  // the upstream half of the same guarantee).
  const acceptance = resolveCandidateAcceptance(coverEvidence, reconciliation);
  draft.selectedCandidateProviderIdentifier = acceptance.selectedCandidateProviderIdentifier;
  draft.proposedBookValues = acceptance.proposedBookValues;

  // Durable audit trail of every candidate considered (§7 of the correction pass) —
  // independent of the resumable draft above. Never blocks the intake on failure;
  // this is an audit convenience, not load-bearing for the pipeline itself.
  // `wasSelected` mirrors the same acceptance gate — an ambiguous/unresolved
  // candidate is retained here for review but always `wasSelected: false`.
  await persistIdentityCandidates(
    db,
    ingestionItemId,
    lookupResult.candidates.map((c) => ({
      candidate: c,
      matchScore: reconciliation.ranked.find((r) => r.candidate.providerIdentifier === c.providerIdentifier)?.score ?? 0,
      wasSelected: candidateWasSelected(c, acceptance),
    }))
  ).catch(() => {});

  draft.pipelineStage = "reconciled";
  await saveDraft(ingestionItemId, draft);

  return {
    ok: true,
    reconciliationOutcome: reconciliation.outcome,
    title: acceptance.proposedBookValues?.title ?? null,
    languageCode: acceptance.proposedBookValues?.languageCode ?? null,
  };
}

// ---------------------------------------------------------------------------
// Step 5 — duplicate check against the existing SSJC catalog
// ---------------------------------------------------------------------------

export interface DuplicateCandidateSummary {
  bookId: string;
  title: string;
  authors: string[];
  languageCode: string;
  publisher: string | null;
  displayCoverUrl: string | null;
  outcome: string;
}

export type CheckDuplicatesResult =
  | ActionFailure
  /** `capturedTitle` is the real identified/reconciled title (Phase 7 correction
   * pass §4) — the UI's "You photographed: …" comparison text must show this,
   * never the raw uploaded filename (e.g. "IMG_1234.HEIC"), which is meaningless
   * to a teacher. */
  | { ok: true; outcome: string; candidates: DuplicateCandidateSummary[]; capturedTitle: string | null };

export async function checkDuplicatesAction(ingestionItemId: string): Promise<CheckDuplicatesResult> {
  await requireStaffSession();
  assertValidId(ingestionItemId);

  const { draft } = await loadDraft(ingestionItemId);
  const proposed = draft.proposedBookValues;
  if (!proposed?.title) {
    draft.duplicateOutcome = "no_match";
    draft.pipelineStage = "duplicate_checked";
    await saveDraft(ingestionItemId, draft);
    return { ok: true, outcome: "no_match", candidates: [], capturedTitle: null };
  }

  let result;
  try {
    result = await findDuplicateCandidates(db, {
      title: proposed.title,
      authors: proposed.authors,
      languageCode: proposed.languageCode && isLanguageCode(proposed.languageCode) ? proposed.languageCode : undefined,
      isbn10: proposed.isbn10 ?? undefined,
      isbn13: proposed.isbn13 ?? undefined,
    });
  } catch {
    return failure("duplicate_check_failed", "Couldn't check the existing catalog. Please try again.");
  }

  draft.duplicateOutcome = result.outcome;
  draft.duplicateCandidateBookIds = result.candidates.map((c: DuplicateCandidate) => c.book.id);
  draft.pipelineStage = "duplicate_checked";
  await saveDraft(ingestionItemId, draft);

  return {
    ok: true,
    outcome: result.outcome,
    capturedTitle: proposed.title,
    candidates: result.candidates.map((c: DuplicateCandidate) => ({
      bookId: c.book.id,
      title: c.book.title,
      authors: c.book.authors,
      languageCode: c.book.languageCode,
      publisher: c.book.publisher || null,
      displayCoverUrl: c.book.cover.displayUrl ?? null,
      outcome: c.outcome,
    })),
  };
}

// ---------------------------------------------------------------------------
// Step 6 — AI enrichment + category suggestion
// ---------------------------------------------------------------------------

export interface EnrichmentSummary {
  /** The already-reconciled title/authors/language from `draft.proposedBookValues`
   * (Phase 7 correction pass §4) — returned here so a caller resuming straight to
   * enrichment (e.g. after "Different book") can build the full confirm view from
   * this one action's result, without needing to remember a separately-cached
   * identify/lookup result from an earlier, non-repeated call. */
  title: string | null;
  authors: string[];
  languageCode: string | null;
  /** Everything below is `ai_inferred` — genuinely inferential catalog-assistance
   * suggestions from the single combined analysis call in `identifyCoverAction`
   * (AI-first catalog draft correction §2/§10), never claimed as bibliographic
   * fact. `aiSuggestionsAvailable: false` means AI never ran at all for this
   * intake (unconfigured, or an E2E fixture with no suggestions) — distinct from
   * AI running and genuinely having nothing useful to suggest, so the UI can be
   * honest about which case it's in rather than showing an unexplained gap. */
  description: string | null;
  tags: string[];
  categorySlug: string | null;
  categoryLabel: string | null;
  categoryConfidence: "high" | "medium" | "low" | null;
  fictionType: FictionType | null;
  format: Format | null;
  ageMinMonths: number | null;
  ageMaxMonths: number | null;
  readAloudMinutes: number | null;
  visualMediaTypes: IllustrationStyle[];
  visualRealism: VisualRealism | null;
  aiSuggestionsAvailable: boolean;
}

export type EnrichAndSuggestResult = ActionFailure | { ok: true; summary: EnrichmentSummary };

function emptyEnrichmentSummary(draft: IntakeDraft): EnrichmentSummary {
  return {
    title: draft.proposedBookValues?.title ?? null,
    authors: draft.proposedBookValues?.authors ?? [],
    languageCode: draft.proposedBookValues?.languageCode ?? null,
    description: null,
    tags: [],
    categorySlug: null,
    categoryLabel: null,
    categoryConfidence: null,
    fictionType: null,
    format: null,
    ageMinMonths: null,
    ageMaxMonths: null,
    readAloudMinutes: null,
    visualMediaTypes: [],
    visualRealism: null,
    aiSuggestionsAvailable: false,
  };
}

/**
 * AI-first catalog draft correction (§5): this no longer makes a second Gemini
 * call. `draft.enrichmentSuggestion` already came from the single combined
 * analysis call in `identifyCoverAction` — this step only MERGES real provider
 * context (subjects → tags) and RE-VALIDATES the suggested category against the
 * current active list (categories could in principle have changed since
 * identify time). A useful partial AI result is never discarded: only the
 * category slug is re-checked; every other AI-suggested field is preserved
 * as-is, even if incomplete.
 */
export async function enrichAndSuggestCategoryAction(ingestionItemId: string): Promise<EnrichAndSuggestResult> {
  await requireStaffSession();
  assertValidId(ingestionItemId);

  const { draft } = await loadDraft(ingestionItemId);
  if (!draft.proposedBookValues?.title) {
    return { ok: true, summary: emptyEnrichmentSummary(draft) };
  }

  const activeCategories = await categoryRepository.listActiveCategories();
  const suggestion = draft.enrichmentSuggestion;

  const selectedCandidate = draft.selectedCandidateProviderIdentifier
    ? draft.metadataCandidates.find((c) => c.providerIdentifier === draft.selectedCandidateProviderIdentifier)
    : undefined;
  const mergedTags = mergeProviderSubjectsIntoTags(suggestion?.tags ?? [], selectedCandidate?.subjects);

  const categorySuggestion = suggestion ? validateCategorySuggestion(suggestion, activeCategories) : undefined;

  draft.enrichmentSuggestion = suggestion ? { ...suggestion, tags: mergedTags } : null;
  draft.categorySuggestion = toCategorySuggestionRecord(categorySuggestion);
  draft.pipelineStage = "ready_for_confirmation";
  await saveDraft(ingestionItemId, draft);

  return {
    ok: true,
    summary: {
      title: draft.proposedBookValues.title,
      authors: draft.proposedBookValues.authors,
      languageCode: draft.proposedBookValues.languageCode,
      description: suggestion?.description ?? null,
      tags: mergedTags,
      categorySlug: categorySuggestion?.slug ?? null,
      categoryLabel: categorySuggestion?.label ?? null,
      categoryConfidence: categorySuggestion?.confidence ?? null,
      fictionType: suggestion?.fictionType ?? null,
      format: suggestion?.format ?? null,
      ageMinMonths: suggestion?.ageMinMonths ?? null,
      ageMaxMonths: suggestion?.ageMaxMonths ?? null,
      readAloudMinutes: suggestion?.readAloudMinutes ?? null,
      visualMediaTypes: suggestion?.visualMediaTypes ?? [],
      visualRealism: suggestion?.visualRealism ?? null,
      aiSuggestionsAvailable: Boolean(suggestion),
    },
  };
}

// ---------------------------------------------------------------------------
// Step 7 — final actions: confirm save, another copy, review later
// ---------------------------------------------------------------------------

export interface ConfirmSaveInput {
  ingestionItemId: string;
  categorySlug: string;
  edits?: TeacherEdits;
}

export type ConfirmSaveResult = ActionFailure | { ok: true; bookId: string; title: string; categoryLabel: string };

export async function confirmSaveAction(input: ConfirmSaveInput): Promise<ConfirmSaveResult> {
  await requireStaffSession();
  assertValidId(input.ingestionItemId);

  const { draft } = await loadDraft(input.ingestionItemId);
  const proposed = draft.proposedBookValues;
  const title = input.edits?.title ?? proposed?.title;
  if (!title) return failure("insufficient_data", "A title is needed before this book can be added.");

  const languageCode = (input.edits?.languageCode ?? proposed?.languageCode) as LanguageCode | null;
  if (!languageCode || !isLanguageCode(languageCode)) {
    return failure("insufficient_data", "A language is needed before this book can be added.");
  }

  const categorySlug = input.edits?.physicalCategorySlug ?? input.categorySlug;
  if (!categorySlug) return failure("insufficient_data", "A shelving category is needed before this book can be added.");

  const enrichment = draft.enrichmentSuggestion;

  // `draft.selectedCandidateProviderIdentifier` is only ever set for an accepted
  // (high-confidence) candidate as of the identity-safety fix in lookupMetadataAction
  // above — an ambiguous/unresolved best guess never reaches here. Resolved once,
  // reused for both provenance and display-cover derivation below.
  const selectedCandidate = draft.selectedCandidateProviderIdentifier
    ? draft.metadataCandidates.find((c) => c.providerIdentifier === draft.selectedCandidateProviderIdentifier)
    : undefined;

  const provenance: ProvenanceInput[] = [];
  // Mutually exclusive per field — `book_field_provenance` enforces at most one
  // *current* row per (book, field) (its own partial unique index), so a field a
  // teacher touched in Quick Edit must replace its cover/provider-sourced
  // provenance entry, never add a second row alongside it (a real, reproducible
  // unique-constraint failure caught by this exact scenario during Phase 7 E2E
  // testing, not a hypothetical).
  if (input.edits?.title) {
    provenance.push({ fieldKey: "title", sourceType: "human_corrected" });
  } else if (draft.coverEvidence?.visibleTitle) {
    provenance.push({ fieldKey: "title", sourceType: "cover_visible", confidenceLevel: draft.coverEvidence.identityConfidenceLevel });
  }
  // Truthful provenance (Phase 7 final closure pass §1): record "external_provider"
  // for the ISBN field only when the accepted candidate actually supplied the ISBN
  // value being saved — never merely because a candidate was accepted for other
  // fields. (`proposed.isbn13` can independently come from cover-visible evidence;
  // that case gets no provenance row here rather than a false "external_provider" one.)
  const isbn10FromProvider = Boolean(selectedCandidate?.isbn10 && selectedCandidate.isbn10 === proposed?.isbn10);
  const isbn13FromProvider = Boolean(selectedCandidate?.isbn13 && selectedCandidate.isbn13 === proposed?.isbn13);
  if (isbn10FromProvider || isbn13FromProvider) provenance.push({ fieldKey: "isbn", sourceType: "external_provider" });
  if (input.edits?.physicalCategorySlug) provenance.push({ fieldKey: "physical_category", sourceType: "human_verified" });
  else if (draft.categorySuggestion) provenance.push({ fieldKey: "physical_category", sourceType: "ai_inferred", confidenceLevel: draft.categorySuggestion.confidence ?? undefined });

  // AI-first catalog draft correction (§11) — the same accepted/human-corrected
  // pattern extended to every AI-suggested discovery field a teacher can see on
  // the confirmation screen. A field the teacher never touched, but that the
  // single combined analysis call genuinely suggested, is still `ai_inferred`
  // provenance — it must never mysteriously disappear on save just because no one
  // explicitly re-confirmed it (§11's own explicit requirement).
  const description = input.edits?.description ?? enrichment?.description ?? undefined;
  if (input.edits?.description) provenance.push({ fieldKey: "description", sourceType: "human_corrected" });
  else if (enrichment?.description) provenance.push({ fieldKey: "description", sourceType: "ai_inferred" });

  const fictionType = input.edits?.fictionType ?? enrichment?.fictionType ?? undefined;
  if (input.edits?.fictionType) provenance.push({ fieldKey: "fiction_status", sourceType: "human_corrected" });
  else if (enrichment?.fictionType) provenance.push({ fieldKey: "fiction_status", sourceType: "ai_inferred" });

  const format = input.edits?.format ?? enrichment?.format ?? undefined;
  if (input.edits?.format) provenance.push({ fieldKey: "format", sourceType: "human_corrected" });
  else if (enrichment?.format) provenance.push({ fieldKey: "format", sourceType: "ai_inferred" });

  const ageMinMonths = input.edits?.ageMinMonths ?? enrichment?.ageMinMonths ?? undefined;
  const ageMaxMonths = input.edits?.ageMaxMonths ?? enrichment?.ageMaxMonths ?? undefined;
  if (input.edits?.ageMinMonths != null || input.edits?.ageMaxMonths != null) {
    provenance.push({ fieldKey: "age_range", sourceType: "human_corrected" });
  } else if (enrichment?.ageMinMonths != null || enrichment?.ageMaxMonths != null) {
    provenance.push({ fieldKey: "age_range", sourceType: "ai_inferred" });
  }

  // No Quick Edit surface for visual metadata (§8's explicit exclusion) — always
  // ai_inferred when the combined analysis call suggested it, never a teacher
  // correction.
  if (enrichment?.visualMediaTypes && enrichment.visualMediaTypes.length > 0) {
    provenance.push({ fieldKey: "visual_media_type", sourceType: "ai_inferred" });
  }
  if (enrichment?.visualRealism) provenance.push({ fieldKey: "visual_realism", sourceType: "ai_inferred" });

  // Display cover (Phase 7 correction pass §2) — derived ONLY from the
  // actually selected/reconciled metadata candidate, never the raw Drive
  // source original. See displayCover.ts for the trust boundary (confirmed
  // identity only, known provider host, upgraded to https).
  const displayCoverUrl = selectTrustworthyDisplayCoverUrl({
    reconciliationOutcome: draft.reconciliationOutcome,
    thumbnailUrl: selectedCandidate?.thumbnailUrl,
  });

  let result;
  try {
    result = await saveNewBook(db, {
      title,
      subtitle: proposed?.subtitle ?? undefined,
      authors: input.edits?.authors ?? proposed?.authors ?? [],
      illustrators: proposed?.illustrators,
      publisherName: proposed?.publisher ?? undefined,
      languageCode,
      isbn10: proposed?.isbn10 ?? undefined,
      isbn13: proposed?.isbn13 ?? undefined,
      description,
      physicalCategorySlug: categorySlug,
      fictionType,
      format,
      ageMinMonths,
      ageMaxMonths,
      readAloudMinutes: enrichment?.readAloudMinutes ?? undefined,
      visualMediaTypes: enrichment?.visualMediaTypes,
      visualRealism: enrichment?.visualRealism ?? undefined,
      tags: enrichment?.tags,
      displayCoverUrl,
      coverDriveFileId: draft.driveSource.fileId,
      coverDriveFolderId: process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID ?? "",
      coverFilename: draft.driveSource.filename,
      coverMimeType: draft.driveSource.mimeType,
      provenance,
      ingestionItemId: input.ingestionItemId,
      actorLabel: "teacher",
    });
  } catch (error) {
    return failure("save_failed", error instanceof Error ? error.message : "Couldn't save this book. Please try again.");
  }

  const categories = await categoryRepository.listCategories();
  const categoryLabel = categories.find((c) => c.slug === categorySlug)?.label ?? categorySlug;

  attemptTargetedEmbedding(result.bookId);

  return { ok: true, bookId: result.bookId, title, categoryLabel };
}

export interface AddAnotherCopyInput {
  ingestionItemId: string;
  bookId: string;
}

export type AddAnotherCopyResult = ActionFailure | { ok: true; bookId: string; title: string; categoryLabel: string };

export async function addAnotherCopyAction(input: AddAnotherCopyInput): Promise<AddAnotherCopyResult> {
  await requireStaffSession();
  assertValidId(input.ingestionItemId);
  assertValidId(input.bookId);

  try {
    await addAnotherCopy(db, { bookId: input.bookId, ingestionItemId: input.ingestionItemId, actorLabel: "teacher" });
  } catch (error) {
    return failure("save_failed", error instanceof Error ? error.message : "Couldn't add this copy. Please try again.");
  }

  const book = await bookRepository.getBookById(input.bookId);
  const categories = await categoryRepository.listCategories();
  const categoryLabel = categories.find((c) => c.slug === book?.physicalCategory)?.label ?? "";

  return { ok: true, bookId: input.bookId, title: book?.title ?? "", categoryLabel };
}

export interface ReviewLaterInput {
  ingestionItemId: string;
  reason: string;
}

export async function reviewLaterAction(input: ReviewLaterInput): Promise<ActionFailure | { ok: true }> {
  await requireStaffSession();
  assertValidId(input.ingestionItemId);

  const { draft } = await loadDraft(input.ingestionItemId);
  const proposed = draft.proposedBookValues;

  const pendingBook =
    proposed?.title && proposed.languageCode && isLanguageCode(proposed.languageCode)
      ? {
          title: proposed.title,
          languageCode: proposed.languageCode,
          authors: proposed.authors,
          coverDriveFileId: draft.driveSource.fileId,
          coverDriveFolderId: process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID ?? "",
          coverFilename: draft.driveSource.filename,
          coverMimeType: draft.driveSource.mimeType,
        }
      : undefined;

  draft.pipelineStage = "needs_review";
  draft.reviewReason = input.reason;

  try {
    await saveForReview(db, { ingestionItemId: input.ingestionItemId, draft, reviewReason: input.reason, actorLabel: "teacher", pendingBook });
  } catch (error) {
    return failure("save_failed", error instanceof Error ? error.message : "Couldn't save this for review. Please try again.");
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Step 7b — human "different book" decision, and Start Over abandonment
// (Phase 7 correction pass §4 / §6)
// ---------------------------------------------------------------------------

/**
 * Records that a teacher reviewed an ambiguous duplicate comparison and
 * explicitly decided this is a different book — a real human decision worth
 * an audit trail, distinct from the system's own `no_match` (which means
 * nothing similar was even found). Deliberately does not re-run vision or
 * metadata lookup and does not block the flow on failure (called
 * fire-and-forget by the client) — this is an audit convenience, never a
 * gate on proceeding to enrichment.
 */
export async function markDifferentBookAction(ingestionItemId: string): Promise<ActionFailure | { ok: true }> {
  await requireStaffSession();
  assertValidId(ingestionItemId);

  const { draft } = await loadDraft(ingestionItemId);
  draft.duplicateOutcome = "no_match";
  await saveDraft(ingestionItemId, draft);

  await db.insert(auditLog).values({
    actorLabel: "teacher",
    action: "duplicate_marked_different_book",
    entityType: "ingestion_item",
    entityId: ingestionItemId,
    detail: { previousDuplicateCandidateBookIds: draft.duplicateCandidateBookIds },
  });

  return { ok: true };
}

/**
 * Best-effort abandonment for "Start Over" after a real upload/ingestion item
 * already exists (§6) — without this, a teacher photographing a cover, then
 * changing their mind before confirming, left a real `ingestion_jobs`/
 * `ingestion_items` pair permanently stuck at `"running"`/`"processing"`,
 * indistinguishable from a genuinely stuck job. Marks both `"failed"` (the
 * closest honest existing status — nothing errored, but the run will never
 * complete or be resumed either) with a clear, non-alarming reason, rather
 * than inventing a new "abandoned" status. Never awaited by the caller and
 * never blocks the UI from resetting — this is real, but genuinely optional,
 * housekeeping.
 */
export async function abandonIntakeAction(ingestionItemId: string): Promise<void> {
  const session = await getSession();
  if (!session) return;
  if (!isUuid(ingestionItemId)) return;

  try {
    const [item] = await db
      .update(ingestionItems)
      .set({ status: "failed", errorMessage: "Abandoned by staff before completing (Start Over).", completedAt: new Date() })
      .where(eq(ingestionItems.id, ingestionItemId))
      .returning({ jobId: ingestionItems.jobId });
    if (item) {
      await db.update(ingestionJobs).set({ status: "failed", completedAt: new Date() }).where(eq(ingestionJobs.id, item.jobId));
    }
  } catch {
    // Best-effort — Start Over always succeeds client-side regardless.
  }
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function categoryOf(error: unknown): string {
  if (error instanceof DriveProviderError) return error.category;
  return "unexpected_provider_failure";
}

/** Converts `validateCategorySuggestion()`'s result into `IntakeDraft.categorySuggestion`'s
 * stored shape — `undefined` (no category could be confirmed) becomes `null`, never a
 * fabricated fallback (AI-first catalog draft correction §3). */
function toCategorySuggestionRecord(
  validated: ReturnType<typeof validateCategorySuggestion>
): IntakeDraft["categorySuggestion"] {
  return validated ? { slug: validated.slug, label: validated.label, confidence: validated.confidence, reason: validated.reason } : null;
}

/**
 * Fire-and-forget: attempts the new book's embedding after the save transaction has
 * already committed, per §36 of the phase brief ("BOOK CREATION STILL SUCCEEDS"
 * regardless of embedding outcome — a teacher is never shown a technical embedding
 * error). Deliberately not awaited by the caller.
 */
function attemptTargetedEmbedding(bookId: string): void {
  const embeddingProvider = getConfiguredEmbeddingProvider();
  if (!embeddingProvider) return;
  void generateEmbeddingForBook(db, embeddingProvider, bookId).catch(() => {
    // Intentionally swallowed — the embedding backfill script recovers this later
    // (embeddingSourceHash/embeddingCompositionVersion remain null/stale, exactly as
    // designed). Never surfaced to the teacher.
  });
}
