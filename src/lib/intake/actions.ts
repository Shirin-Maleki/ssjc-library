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
import { prepareAnalysisImage } from "./imagePrep";
import { reconcileIdentity, resolveProviderLanguage } from "./reconciliation";
import { lookupMetadataCandidates } from "./metadataLookup";
import { findDuplicateCandidates, type DuplicateCandidate } from "./duplicateMatcher";
import { validateCategorySuggestion } from "./categorySuggestion";
import { selectTrustworthyDisplayCoverUrl } from "./displayCover";
import { persistIdentityCandidates } from "./identityCandidates";
import { readIntakeDraft, parseIntakeDraft, type IntakeDraft, type TeacherEdits } from "./draft";
import { isE2EFakeProvidersEnabled, buildFakeCoverEvidence, buildFakeMetadataCandidates } from "./e2eFixtures";
import { saveNewBook, addAnotherCopy, saveForReview, type ProvenanceInput } from "./persistence";
import { isLanguageCode } from "@/lib/catalog/languages";
import type { LanguageCode } from "@/lib/catalog/types";

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
  | { ok: true; visibleTitle: string | null; visibleAuthors: string[] | null; identityConfidenceLevel: "high" | "medium" | "low" };

export async function identifyCoverAction(ingestionItemId: string): Promise<IdentifyCoverResult> {
  await requireStaffSession();
  assertValidId(ingestionItemId);

  const { draft } = await loadDraft(ingestionItemId);

  // E2E fixture path — see e2eFixtures.ts's own doc comment. Skips both the real
  // Drive download and the real Gemini vision call; the rest of the pipeline
  // (metadata lookup, reconciliation, real duplicate-check against the real
  // seeded catalog, save) runs unmodified against this fixture evidence.
  if (isE2EFakeProvidersEnabled()) {
    const evidence = buildFakeCoverEvidence(draft.driveSource.filename);
    draft.coverEvidence = evidence;
    draft.pipelineStage = "identified";
    await saveDraft(ingestionItemId, draft);
    return { ok: true, visibleTitle: evidence.visibleTitle, visibleAuthors: evidence.visibleAuthors, identityConfidenceLevel: evidence.identityConfidenceLevel };
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

  const analysisImage = await prepareAnalysisImage(downloaded.bytes, draft.driveSource.mimeType);

  let evidence;
  try {
    evidence = await aiProvider.identifyCover({ imageBytes: analysisImage.bytes, mimeType: analysisImage.mimeType });
  } catch {
    return failure("vision_failed", "Couldn't automatically identify this book. You can still continue and enter details yourself.");
  }

  draft.coverEvidence = evidence;
  draft.pipelineStage = "identified";
  await saveDraft(ingestionItemId, draft);

  return { ok: true, visibleTitle: evidence.visibleTitle, visibleAuthors: evidence.visibleAuthors, identityConfidenceLevel: evidence.identityConfidenceLevel };
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
  draft.selectedCandidateProviderIdentifier = reconciliation.best?.candidate.providerIdentifier ?? null;

  // Durable audit trail of every candidate considered (§7 of the correction pass) —
  // independent of the resumable draft above. Never blocks the intake on failure;
  // this is an audit convenience, not load-bearing for the pipeline itself.
  await persistIdentityCandidates(
    db,
    ingestionItemId,
    lookupResult.candidates.map((c) => ({
      candidate: c,
      matchScore: reconciliation.ranked.find((r) => r.candidate.providerIdentifier === c.providerIdentifier)?.score ?? 0,
      wasSelected: c.providerIdentifier === reconciliation.best?.candidate.providerIdentifier,
    }))
  ).catch(() => {});

  const chosen = reconciliation.best?.candidate;
  const resolvedLanguage: LanguageCode | undefined =
    resolveProviderLanguage(coverEvidence?.visibleLanguage ?? undefined) ?? resolveProviderLanguage(chosen?.language) ?? undefined;

  const title = coverEvidence?.visibleTitle ?? chosen?.title ?? null;
  draft.proposedBookValues = title
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
  draft.pipelineStage = "reconciled";
  await saveDraft(ingestionItemId, draft);

  return { ok: true, reconciliationOutcome: reconciliation.outcome, title, languageCode: resolvedLanguage ?? null };
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
  description: string | null;
  tags: string[];
  categorySlug: string | null;
  categoryLabel: string | null;
}

export type EnrichAndSuggestResult = ActionFailure | { ok: true; summary: EnrichmentSummary };

export async function enrichAndSuggestCategoryAction(ingestionItemId: string): Promise<EnrichAndSuggestResult> {
  await requireStaffSession();
  assertValidId(ingestionItemId);

  const { draft } = await loadDraft(ingestionItemId);
  if (!draft.coverEvidence || !draft.proposedBookValues?.title) {
    return {
      ok: true,
      summary: {
        title: draft.proposedBookValues?.title ?? null,
        authors: draft.proposedBookValues?.authors ?? [],
        languageCode: draft.proposedBookValues?.languageCode ?? null,
        description: null,
        tags: [],
        categorySlug: null,
        categoryLabel: null,
      },
    };
  }

  const activeCategories = await categoryRepository.listActiveCategories();
  const aiProvider = getConfiguredBookIntelligenceProvider();

  let enrichment;
  if (aiProvider) {
    try {
      enrichment = await aiProvider.suggestEnrichment({
        coverEvidence: draft.coverEvidence,
        metadataSummary: {
          title: draft.proposedBookValues.title,
          subtitle: draft.proposedBookValues.subtitle ?? undefined,
          authors: draft.proposedBookValues.authors,
          publisher: draft.proposedBookValues.publisher ?? undefined,
        },
        activeCategories,
      });
    } catch {
      enrichment = null;
    }
  }

  const categorySuggestion = enrichment ? validateCategorySuggestion(enrichment, activeCategories) : undefined;

  draft.enrichmentSuggestion = enrichment ?? null;
  draft.categorySuggestion = categorySuggestion
    ? { slug: categorySuggestion.slug, label: categorySuggestion.label, confidence: categorySuggestion.confidence, reason: categorySuggestion.reason }
    : null;
  draft.pipelineStage = "ready_for_confirmation";
  await saveDraft(ingestionItemId, draft);

  return {
    ok: true,
    summary: {
      title: draft.proposedBookValues.title,
      authors: draft.proposedBookValues.authors,
      languageCode: draft.proposedBookValues.languageCode,
      description: enrichment?.description ?? null,
      tags: enrichment?.tags ?? [],
      categorySlug: categorySuggestion?.slug ?? null,
      categoryLabel: categorySuggestion?.label ?? null,
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
  if (draft.selectedCandidateProviderIdentifier) provenance.push({ fieldKey: "isbn", sourceType: "external_provider" });
  if (input.edits?.physicalCategorySlug) provenance.push({ fieldKey: "physical_category", sourceType: "human_verified" });
  else if (draft.categorySuggestion) provenance.push({ fieldKey: "physical_category", sourceType: "ai_inferred", confidenceLevel: draft.categorySuggestion.confidence ?? undefined });

  // Display cover (Phase 7 correction pass §2) — derived ONLY from the
  // actually selected/reconciled metadata candidate, never the raw Drive
  // source original. See displayCover.ts for the trust boundary (confirmed
  // identity only, known provider host, upgraded to https).
  const selectedCandidate = draft.selectedCandidateProviderIdentifier
    ? draft.metadataCandidates.find((c) => c.providerIdentifier === draft.selectedCandidateProviderIdentifier)
    : undefined;
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
      description: enrichment?.description ?? undefined,
      physicalCategorySlug: categorySlug,
      fictionType: input.edits?.fictionType ?? enrichment?.fictionType ?? undefined,
      format: input.edits?.format ?? enrichment?.format ?? undefined,
      ageMinMonths: input.edits?.ageMinMonths ?? enrichment?.ageMinMonths ?? undefined,
      ageMaxMonths: input.edits?.ageMaxMonths ?? enrichment?.ageMaxMonths ?? undefined,
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
