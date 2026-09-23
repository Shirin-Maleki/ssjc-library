import { eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import { ingestionItems } from "@/db/schema";
// Imported from its own file, never `@/db/repositories`'s index — that index
// also imports the real, `server-only`-guarded `../client`, which throws
// unconditionally outside Next's own build pipeline. This module is called
// from `scripts/bulkImport/*.ts` via `tsx`, the same reason `duplicateMatcher.ts`
// already does this identically.
import { DrizzleCategoryRepository } from "@/db/repositories/categoryRepository";
import type { CoverStorageProvider } from "@/lib/googleDrive/provider";
import type { BookVisionProvider } from "@/lib/ai/provider";
import type { BookMetadataProvider } from "@/lib/metadataProviders/provider";
import { prepareAnalysisImage } from "@/lib/intake/imagePrep";
import { reconcileIdentity } from "@/lib/intake/reconciliation";
import { resolveCandidateAcceptance } from "@/lib/intake/candidateAcceptance";
import { lookupMetadataCandidates } from "@/lib/intake/metadataLookup";
import { findDuplicateCandidates } from "@/lib/intake/duplicateMatcher";
import { validateCategorySuggestion } from "@/lib/intake/categorySuggestion";
import { mergeProviderSubjectsIntoTags } from "@/lib/intake/enrichmentMerge";
import { resolveConfirmFields } from "@/lib/intake/confirmFieldResolution";
import { selectTrustworthyDisplayCoverUrl } from "@/lib/intake/displayCover";
import { persistIdentityCandidates } from "@/lib/intake/identityCandidates";
import { createInitialDraft, parseIntakeDraft, type IntakeDraft } from "@/lib/intake/draft";
import { saveNewBook, saveForReview, advanceParentJob, type ProvenanceInput } from "@/lib/intake/persistence";
import { isLanguageCode } from "@/lib/catalog/languages";
import type { LanguageCode } from "@/lib/catalog/types";
import { decideBulkCompletionGate } from "./completionGate";
import { classifyBulkImportError } from "./retryClassification";
import type { BulkImportCallCounters } from "./costTracking";
import { recordProviderCall, recordGeminiUsage } from "./costTracking";

/**
 * The bulk-import orchestrator (§22 of the phase brief) — composes the exact
 * same Phase 7 domain services `src/lib/intake/actions.ts` calls, in the same
 * order, for a single ingestion item, in one synchronous function call rather
 * than across several separate HTTP round trips. This is a SECOND
 * ORCHESTRATOR over shared logic, never a second implementation of the logic
 * itself — every real decision (identity reconciliation, candidate acceptance,
 * duplicate detection, category validation, display-cover trust) still runs
 * through the identical Phase 7 functions a teacher's own Add-a-Book flow uses.
 *
 * Dependency-injected (`BulkPipelineDeps`) rather than reaching for
 * `server-only`-guarded factories — the same reason `scripts/google/smoke.ts`
 * and `scripts/embeddings/generate.ts` construct concrete provider classes
 * directly, and the same reason this makes the whole orchestrator testable
 * against fake providers with zero real network/API calls
 * (`tests/unit/bulkImport/pipeline.test.ts`).
 */

export interface BulkPipelineDeps {
  db: Database;
  driveProvider: Pick<CoverStorageProvider, "downloadSource">;
  aiProvider: BookVisionProvider;
  metadataProviders: BookMetadataProvider[];
  /** The bulk importer's own configured source root — recorded as
   * `books.cover_drive_folder_id` for a completed/pending-review book,
   * mirroring Phase 7's own convention of recording which configured Drive
   * root a cover belongs to (never the literal immediate parent folder). */
  bulkImportRootFolderId: string;
  counters: BulkImportCallCounters;
  /** Phase 9 addendum §10 — the job's configured `--location`, resolved once
   * per run (`scripts/bulkImport/run.ts`) rather than re-queried per item. See
   * `getJobInitialLocationId`'s own doc comment for why this same value must
   * also be read again, separately, at admin Review-Later approval time for
   * an item that instead lands in `needs_review`. */
  initialLocationId?: string;
}

export interface ClaimedItemInfo {
  itemId: string;
  driveFileId: string;
  fileName: string;
  mimeType: string;
  /** Real Drive-reported file size — `IntakeDraftSchema.driveSource.sizeBytes`
   * requires a positive number, so a defensive `1` is used only in the rare
   * case Drive genuinely reports no size at all, never `0`. */
  sizeBytes: number;
}

export type ItemOutcome =
  | { kind: "completed"; bookId: string }
  | { kind: "needs_review"; reason: string }
  | { kind: "retry_scheduled"; reason: string }
  | { kind: "failed"; reason: string };

/**
 * Processes exactly one already-claimed (`status = "processing"`) ingestion
 * item end to end. Never throws for an ordinary pipeline/provider failure —
 * every failure is classified (`classifyBulkImportError`) and turned into one
 * of the four `ItemOutcome` kinds above; only a genuinely unexpected
 * programming error (a bug, not a provider failure) propagates, and even that
 * is caught one level up by the CLI run loop so one bad item can never crash
 * an entire batch run.
 */
export async function processOneClaimedItem(deps: BulkPipelineDeps, item: ClaimedItemInfo, maxRetries: number): Promise<ItemOutcome> {
  try {
    return await runPipeline(deps, item);
  } catch (error) {
    const classified = classifyBulkImportError(error);

    if (classified.failureClass === "reviewable") {
      await routeToReview(deps.db, item.itemId, "import_error", classified.message);
      return { kind: "needs_review", reason: classified.message };
    }

    const [current] = await deps.db.select({ retryCount: ingestionItems.retryCount, jobId: ingestionItems.jobId }).from(ingestionItems).where(eq(ingestionItems.id, item.itemId)).limit(1);
    const retryCount = (current?.retryCount ?? 0) + 1;

    if (classified.failureClass === "transient" && retryCount <= maxRetries) {
      // Bounded exponential backoff with jitter before this item becomes
      // reclaimable again (§32) — mirrors `googleDrive/retry.ts`'s exact
      // formula/constants rather than inventing a second one. Blocks only
      // THIS item's slot in the run loop's batch, not the whole process.
      await sleep(computeBackoffDelayMs(retryCount));
      await deps.db.update(ingestionItems).set({ status: "pending", retryCount, startedAt: null }).where(eq(ingestionItems.id, item.itemId));
      return { kind: "retry_scheduled", reason: classified.message };
    }

    // Permanent failure, or a transient one that exhausted its retry budget —
    // both become a real, terminal `"failed"` item rather than looping forever.
    await deps.db.update(ingestionItems).set({ status: "failed", retryCount, errorMessage: classified.message, completedAt: new Date() }).where(eq(ingestionItems.id, item.itemId));
    if (current) {
      await deps.db.transaction((tx) => advanceParentJob(tx, current.jobId, "failed"));
    }
    return { kind: "failed", reason: classified.message };
  }
}

const BACKOFF_BASE_DELAY_MS = 500;
const BACKOFF_MAX_DELAY_MS = 8000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** `BASE_DELAY_MS * 2^attempt`, capped, plus up to 30% jitter — the exact same
 * formula `googleDrive/retry.ts`'s `computeDelayMs` uses for Drive/OAuth
 * calls, reused here rather than invented a second time. */
function computeBackoffDelayMs(attempt: number): number {
  const exponential = Math.min(BACKOFF_BASE_DELAY_MS * 2 ** attempt, BACKOFF_MAX_DELAY_MS);
  const jitter = exponential * 0.3 * Math.random();
  return exponential + jitter;
}

async function routeToReview(db: Database, itemId: string, flagType: Parameters<typeof saveForReview>[1]["flagType"], reason: string): Promise<void> {
  const [item] = await db.select({ jobId: ingestionItems.jobId }).from(ingestionItems).where(eq(ingestionItems.id, itemId)).limit(1);
  if (!item) return;
  const draft = parseIntakeDraft(createInitialDraft({ fileId: "unknown", filename: "unknown", mimeType: "application/octet-stream", sizeBytes: 1, checksum: null }));
  await saveForReview(db, { ingestionItemId: itemId, draft, reviewReason: reason, actorLabel: "bulk_import", flagType });
}

async function runPipeline(deps: BulkPipelineDeps, item: ClaimedItemInfo): Promise<ItemOutcome> {
  const { db } = deps;

  const draft = parseIntakeDraft(
    createInitialDraft({ fileId: item.driveFileId, filename: item.fileName, mimeType: item.mimeType, sizeBytes: item.sizeBytes, checksum: null })
  );

  const downloaded = await deps.driveProvider.downloadSource(item.driveFileId);
  recordProviderCall(deps.counters, "drive_download");

  const analysisImage = await prepareAnalysisImage(downloaded.bytes, item.mimeType);
  const activeCategories = await new DrizzleCategoryRepository(db).listActiveCategories();

  const analysis = await deps.aiProvider.analyzeCover({ imageBytes: analysisImage.bytes, mimeType: analysisImage.mimeType, activeCategories });
  recordProviderCall(deps.counters, "gemini_vision");
  if (analysis.usage) recordGeminiUsage(deps.counters, analysis.usage);

  const coverEvidence = analysis.coverEvidence;
  const hasUsableIdentification = Boolean(coverEvidence.visibleTitle?.trim());
  draft.coverEvidence = coverEvidence;
  draft.enrichmentSuggestion = analysis.aiSuggestions;
  draft.aiSuggestionsStatus = analysis.aiSuggestionsStatus;

  let lookupResult;
  try {
    lookupResult =
      coverEvidence.visibleIsbn || coverEvidence.visibleTitle
        ? await lookupMetadataCandidates(db, deps.metadataProviders, {
            isbn: coverEvidence.visibleIsbn ?? undefined,
            title: coverEvidence.visibleTitle ?? undefined,
            authors: coverEvidence.visibleAuthors ?? undefined,
            language: coverEvidence.visibleLanguage ?? undefined,
          })
        : { candidates: [], providersQueried: [], providerErrors: [] };
    recordProviderCall(deps.counters, "metadata_lookup");
  } catch {
    // Matches Phase 7's own `lookupMetadataAction` degradation — a total
    // metadata-provider failure yields zero candidates, never a hard failure;
    // the completion gate below then conservatively routes to review for lack
    // of a confident match, which is the correct, safe outcome either way.
    lookupResult = { candidates: [], providersQueried: [], providerErrors: [{ provider: "unknown", category: "unexpected_provider_failure" }] };
  }

  const reconciliation = reconcileIdentity(coverEvidence, lookupResult.candidates);
  draft.metadataCandidates = lookupResult.candidates.map((c) => {
    const scored = reconciliation.ranked.find((r) => r.candidate.providerIdentifier === c.providerIdentifier);
    return { ...c, matchScore: scored?.score ?? 0, matchedSignals: scored?.matchedSignals ?? [] };
  });
  draft.reconciliationOutcome = reconciliation.outcome;

  const acceptance = resolveCandidateAcceptance(coverEvidence, reconciliation);
  draft.selectedCandidateProviderIdentifier = acceptance.selectedCandidateProviderIdentifier;
  draft.proposedBookValues = acceptance.proposedBookValues;

  await persistIdentityCandidates(
    db,
    item.itemId,
    lookupResult.candidates.map((c) => ({
      candidate: c,
      matchScore: reconciliation.ranked.find((r) => r.candidate.providerIdentifier === c.providerIdentifier)?.score ?? 0,
      wasSelected: acceptance.selectedCandidateProviderIdentifier === c.providerIdentifier,
    }))
  ).catch(() => {});

  const proposed = draft.proposedBookValues;
  let duplicateOutcome: "no_match" | "exact_copy_same_edition" | "same_title_different_edition" | "same_work_different_language" | "ambiguous_similar_title" = "no_match";
  if (proposed?.title) {
    const duplicateResult = await findDuplicateCandidates(db, {
      title: proposed.title,
      authors: proposed.authors,
      languageCode: proposed.languageCode && isLanguageCode(proposed.languageCode) ? proposed.languageCode : undefined,
      isbn10: proposed.isbn10 ?? undefined,
      isbn13: proposed.isbn13 ?? undefined,
    });
    recordProviderCall(deps.counters, "duplicate_check");
    duplicateOutcome = duplicateResult.outcome;
    draft.duplicateOutcome = duplicateResult.outcome;
    draft.duplicateCandidateBookIds = duplicateResult.candidates.map((c) => c.book.id);
  }

  const categorySuggestion = analysis.aiSuggestions ? validateCategorySuggestion(analysis.aiSuggestions, activeCategories) : undefined;
  draft.categorySuggestion = categorySuggestion
    ? { slug: categorySuggestion.slug, label: categorySuggestion.label, confidence: categorySuggestion.confidence, reason: categorySuggestion.reason }
    : null;

  const selectedCandidate = draft.selectedCandidateProviderIdentifier
    ? draft.metadataCandidates.find((c) => c.providerIdentifier === draft.selectedCandidateProviderIdentifier)
    : undefined;
  const mergedTags = mergeProviderSubjectsIntoTags(analysis.aiSuggestions?.tags ?? [], selectedCandidate?.subjects);
  draft.enrichmentSuggestion = analysis.aiSuggestions ? { ...analysis.aiSuggestions, tags: mergedTags } : null;

  const resolved = resolveConfirmFields({
    edits: undefined,
    proposedTitle: proposed?.title,
    proposedLanguageCode: proposed?.languageCode,
    proposedAuthors: proposed?.authors,
    fallbackCategorySlug: categorySuggestion?.slug ?? null,
    enrichment: draft.enrichmentSuggestion,
    coverEvidence,
    categorySuggestion: draft.categorySuggestion,
  });

  const decision = decideBulkCompletionGate({
    hasUsableIdentification,
    title: resolved.title ?? null,
    languageCode: resolved.languageCode ?? null,
    reconciliationOutcome: reconciliation.outcome,
    duplicateOutcome,
    categorySlug: categorySuggestion?.slug ?? null,
    categoryConfidence: categorySuggestion?.confidence ?? null,
  });

  draft.pipelineStage = decision.outcome === "complete" ? "ready_for_confirmation" : "needs_review";

  if (decision.outcome === "needs_review") {
    const languageOk = resolved.languageCode && isLanguageCode(resolved.languageCode);
    const pendingBook =
      resolved.title && languageOk
        ? {
            title: resolved.title,
            languageCode: resolved.languageCode as LanguageCode,
            authors: resolved.authors,
            description: resolved.description,
            coverDriveFileId: item.driveFileId,
            coverDriveFolderId: deps.bulkImportRootFolderId,
            coverFilename: item.fileName,
            coverMimeType: item.mimeType,
            coverSourceType: "bulk_import" as const,
          }
        : undefined;

    await saveForReview(db, {
      ingestionItemId: item.itemId,
      draft: parseIntakeDraft(draft),
      reviewReason: decision.reason,
      actorLabel: "bulk_import",
      pendingBook,
      flagType: decision.flagType,
    });
    return { kind: "needs_review", reason: decision.reason };
  }

  // decision.outcome === "complete" — every value used below has already been
  // validated non-null by the gate (title/languageCode/categorySlug).
  const languageCode = resolved.languageCode as LanguageCode;
  const provenance: ProvenanceInput[] = [...resolved.provenance];
  const isbn10FromProvider = Boolean(selectedCandidate?.isbn10 && selectedCandidate.isbn10 === proposed?.isbn10);
  const isbn13FromProvider = Boolean(selectedCandidate?.isbn13 && selectedCandidate.isbn13 === proposed?.isbn13);
  if (isbn10FromProvider || isbn13FromProvider) provenance.push({ fieldKey: "isbn", sourceType: "external_provider" });
  if (draft.enrichmentSuggestion?.visualMediaTypes && draft.enrichmentSuggestion.visualMediaTypes.length > 0) {
    provenance.push({ fieldKey: "visual_media_type", sourceType: "ai_inferred" });
  }
  if (draft.enrichmentSuggestion?.visualRealism) provenance.push({ fieldKey: "visual_realism", sourceType: "ai_inferred" });

  const displayCoverUrl = selectTrustworthyDisplayCoverUrl({ reconciliationOutcome: draft.reconciliationOutcome, thumbnailUrl: selectedCandidate?.thumbnailUrl });

  const result = await saveNewBook(db, {
    title: resolved.title!,
    subtitle: proposed?.subtitle ?? undefined,
    authors: resolved.authors,
    illustrators: proposed?.illustrators,
    publisherName: proposed?.publisher ?? undefined,
    languageCode,
    isbn10: proposed?.isbn10 ?? undefined,
    isbn13: proposed?.isbn13 ?? undefined,
    description: resolved.description,
    physicalCategorySlug: categorySuggestion!.slug,
    fictionType: resolved.fictionType,
    format: resolved.format,
    ageMinMonths: resolved.ageMinMonths,
    ageMaxMonths: resolved.ageMaxMonths,
    readAloudMinutes: draft.enrichmentSuggestion?.readAloudMinutes ?? undefined,
    visualMediaTypes: draft.enrichmentSuggestion?.visualMediaTypes,
    visualRealism: draft.enrichmentSuggestion?.visualRealism ?? undefined,
    tags: mergedTags,
    displayCoverUrl,
    coverDriveFileId: item.driveFileId,
    coverDriveFolderId: deps.bulkImportRootFolderId,
    coverFilename: item.fileName,
    coverMimeType: item.mimeType,
    provenance,
    ingestionItemId: item.itemId,
    actorLabel: "bulk_import",
    coverSourceType: "bulk_import",
    currentLocationId: deps.initialLocationId,
  });

  return { kind: "completed", bookId: result.bookId };
}

export type { IntakeDraft };
