"use server";

import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { ingestionItems, ingestionJobs } from "@/db/schema";
import { bookRepository, categoryRepository } from "@/db/repositories";
import { requireStaffSession } from "@/lib/auth/guards";
import { isUuid } from "@/lib/utils/uuid";
import {
  getConfiguredCoverStorageProvider,
  DriveProviderError,
  isAllowedSourceCoverMimeType,
  isValidSourceCoverSize,
  MAX_SOURCE_COVER_SIZE_BYTES,
} from "@/lib/googleDrive";
import { getConfiguredBookIntelligenceProvider } from "@/lib/ai";
import { getConfiguredMetadataProviders } from "@/lib/metadataProviders";
import { getConfiguredEmbeddingProvider } from "@/lib/embeddings";
import { generateEmbeddingForBook } from "@/lib/embeddings/generation";
import { prepareAnalysisImage } from "./imagePrep";
import { reconcileIdentity, resolveProviderLanguage } from "./reconciliation";
import { lookupMetadataCandidates } from "./metadataLookup";
import { findDuplicateCandidates, type DuplicateCandidate } from "./duplicateMatcher";
import { validateCategorySuggestion } from "./categorySuggestion";
import { createInitialDraft, readIntakeDraft, parseIntakeDraft, type IntakeDraft, type TeacherEdits } from "./draft";
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
// Step 1 — resumable upload session
// ---------------------------------------------------------------------------

export interface InitiateUploadInput {
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

export type InitiateUploadResult = ActionFailure | { ok: true; sessionUri: string; parentFolderId: string };

export async function initiateUploadAction(input: InitiateUploadInput): Promise<InitiateUploadResult> {
  await requireStaffSession();

  if (!isAllowedSourceCoverMimeType(input.mimeType)) {
    return failure("invalid_file", "That file type isn't supported. Please choose a JPEG, PNG, WebP, HEIC, or HEIF photo.");
  }
  if (!isValidSourceCoverSize(input.sizeBytes)) {
    return failure("invalid_file", `That photo is too large (max ${Math.floor(MAX_SOURCE_COVER_SIZE_BYTES / (1024 * 1024))} MB).`);
  }

  const provider = getConfiguredCoverStorageProvider();
  if (!provider) return failure("configuration_missing", "Photo storage isn't configured yet. Please contact your administrator.");

  const rootFolderId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID!;
  try {
    const session = await provider.initiateResumableUpload({
      parentFolderId: rootFolderId,
      filename: input.filename,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
    });
    return { ok: true, sessionUri: session.sessionUri, parentFolderId: session.parentFolderId };
  } catch (error) {
    return failure(categoryOf(error), "Couldn't start the upload. Please try again.");
  }
}

// ---------------------------------------------------------------------------
// Step 2 — server-side confirmation, ingestion job/item creation
// ---------------------------------------------------------------------------

export interface ConfirmUploadInput {
  driveFileId: string;
  expectedFilename: string;
  expectedMimeType: string;
  expectedSizeBytes: number;
}

export type ConfirmUploadResult = ActionFailure | { ok: true; ingestionItemId: string };

export async function confirmUploadAction(input: ConfirmUploadInput): Promise<ConfirmUploadResult> {
  await requireStaffSession();

  const provider = getConfiguredCoverStorageProvider();
  if (!provider) return failure("configuration_missing", "Photo storage isn't configured yet. Please contact your administrator.");
  const rootFolderId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID!;

  let metadata;
  try {
    metadata = await provider.confirmUploadedFile({
      fileId: input.driveFileId,
      expectedParentFolderId: rootFolderId,
      expectedFilename: input.expectedFilename,
      expectedMimeType: input.expectedMimeType,
      expectedSizeBytes: input.expectedSizeBytes,
    });
  } catch (error) {
    return failure(categoryOf(error), "The upload couldn't be confirmed. Please try again.");
  }

  const [job] = await db.insert(ingestionJobs).values({ jobType: "single_add", source: "teacher_capture", status: "running", totalItems: 1 }).returning({ id: ingestionJobs.id });
  const draft = createInitialDraft({
    fileId: metadata.id,
    filename: metadata.name,
    mimeType: metadata.mimeType,
    sizeBytes: metadata.size ?? input.expectedSizeBytes,
    checksum: metadata.md5Checksum ?? null,
  });
  const [item] = await db
    .insert(ingestionItems)
    .values({ jobId: job.id, driveFileId: metadata.id, contentHash: metadata.md5Checksum, status: "processing", intakeDraft: draft })
    .returning({ id: ingestionItems.id });

  return { ok: true, ingestionItemId: item.id };
}

// ---------------------------------------------------------------------------
// Step 3 — cover identification (vision)
// ---------------------------------------------------------------------------

export type IdentifyCoverResult =
  | ActionFailure
  | { ok: true; visibleTitle: string | null; visibleAuthors: string[] | null; identityConfidenceLevel: "high" | "medium" | "low" };

export async function identifyCoverAction(ingestionItemId: string): Promise<IdentifyCoverResult> {
  await requireStaffSession();
  assertValidId(ingestionItemId);

  const driveProvider = getConfiguredCoverStorageProvider();
  const aiProvider = getConfiguredBookIntelligenceProvider();
  if (!driveProvider) return failure("configuration_missing", "Photo storage isn't configured.");
  if (!aiProvider) return failure("configuration_missing", "Book identification isn't configured.");

  const { draft } = await loadDraft(ingestionItemId);

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
  | { ok: true; reconciliationOutcome: "high_confidence" | "ambiguous" | "unresolved"; title: string | null };

export async function lookupMetadataAction(ingestionItemId: string): Promise<LookupMetadataResult> {
  await requireStaffSession();
  assertValidId(ingestionItemId);

  const { draft } = await loadDraft(ingestionItemId);
  const coverEvidence = draft.coverEvidence;

  const providers = getConfiguredMetadataProviders();
  const query = {
    isbn: coverEvidence?.visibleIsbn ?? undefined,
    title: coverEvidence?.visibleTitle ?? undefined,
    authors: coverEvidence?.visibleAuthors ?? undefined,
    language: coverEvidence?.visibleLanguage ?? undefined,
  };

  let lookupResult;
  try {
    lookupResult = query.isbn || query.title ? await lookupMetadataCandidates(db, providers, query) : { candidates: [], providersQueried: [], providerErrors: [] };
  } catch {
    lookupResult = { candidates: [], providersQueried: [], providerErrors: [{ provider: "unknown", category: "unexpected_provider_failure" }] };
  }

  const reconciliation = coverEvidence ? reconcileIdentity(coverEvidence, lookupResult.candidates) : { outcome: "unresolved" as const, ranked: [] };

  draft.metadataCandidates = lookupResult.candidates.map((c) => {
    const scored = reconciliation.ranked.find((r) => r.candidate.providerIdentifier === c.providerIdentifier);
    return { ...c, matchScore: scored?.score ?? 0, matchedSignals: scored?.matchedSignals ?? [] };
  });
  draft.reconciliationOutcome = reconciliation.outcome;
  draft.selectedCandidateProviderIdentifier = reconciliation.best?.candidate.providerIdentifier ?? null;

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

  return { ok: true, reconciliationOutcome: reconciliation.outcome, title };
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

export type CheckDuplicatesResult = ActionFailure | { ok: true; outcome: string; candidates: DuplicateCandidateSummary[] };

export async function checkDuplicatesAction(ingestionItemId: string): Promise<CheckDuplicatesResult> {
  await requireStaffSession();
  assertValidId(ingestionItemId);

  const { draft } = await loadDraft(ingestionItemId);
  const proposed = draft.proposedBookValues;
  if (!proposed?.title) {
    draft.duplicateOutcome = "no_match";
    draft.pipelineStage = "duplicate_checked";
    await saveDraft(ingestionItemId, draft);
    return { ok: true, outcome: "no_match", candidates: [] };
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
    candidates: result.candidates.map((c: DuplicateCandidate) => ({
      bookId: c.book.id,
      title: c.book.title,
      authors: c.book.authors,
      languageCode: c.book.languageCode,
      publisher: c.book.publisher || null,
      displayCoverUrl: null,
      outcome: c.outcome,
    })),
  };
}

// ---------------------------------------------------------------------------
// Step 6 — AI enrichment + category suggestion
// ---------------------------------------------------------------------------

export interface EnrichmentSummary {
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
    return { ok: true, summary: { description: null, tags: [], categorySlug: null, categoryLabel: null } };
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
  if (draft.coverEvidence?.visibleTitle) provenance.push({ fieldKey: "title", sourceType: "cover_visible", confidenceLevel: draft.coverEvidence.identityConfidenceLevel });
  if (draft.selectedCandidateProviderIdentifier) provenance.push({ fieldKey: "isbn", sourceType: "external_provider" });
  if (input.edits?.title) provenance.push({ fieldKey: "title", sourceType: "human_corrected" });
  if (input.edits?.physicalCategorySlug) provenance.push({ fieldKey: "physical_category", sourceType: "human_verified" });
  else if (draft.categorySuggestion) provenance.push({ fieldKey: "physical_category", sourceType: "ai_inferred", confidenceLevel: draft.categorySuggestion.confidence ?? undefined });

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
