import { and, eq, inArray } from "drizzle-orm";
import type { Database } from "@/db/client";
import {
  auditLog,
  bookContributors,
  bookCopies,
  bookDuplicates,
  bookTags,
  books,
  ingestionItems,
  ingestionJobs,
  physicalCategories,
  reviewFlags,
  reviewFlagTypeEnum,
  taxonomySuggestions,
} from "@/db/schema";

type ReviewFlagType = (typeof reviewFlagTypeEnum.enumValues)[number];
import { resolveConfirmFields } from "@/lib/intake/confirmFieldResolution";
import { readIntakeDraft, type TeacherEdits } from "@/lib/intake/draft";
import { saveNewBook, upsertContributor, upsertPublisher, upsertTag, getJobInitialLocationId, type ProvenanceInput, type Transaction } from "@/lib/intake/persistence";
import { selectTrustworthyDisplayCoverUrl } from "@/lib/intake/displayCover";
import { isLanguageCode } from "@/lib/catalog/languages";
import type { Format, IllustrationStyle, LanguageCode, VisualRealism } from "@/lib/catalog/types";
import { buildSearchIndexText } from "@/lib/embeddings/document";
import { generateEmbeddingForBook } from "@/lib/embeddings/generation";
import { GeminiEmbeddingProvider } from "@/lib/embeddings/geminiProvider";
import type { EmbeddingProvider } from "@/lib/embeddings/provider";
import { rebuildSearchTextForBooks } from "@/lib/search/searchTextMaintenance";
import { normalizeTitle } from "@/lib/search/normalize";
import { computeSortTitle } from "@/lib/catalog/sortTitle";
import { isUuid } from "@/lib/utils/uuid";
import { writeCurrentProvenance } from "./provenanceWrite";
import { invalidateEmbedding, invalidateEmbeddings } from "./embeddingInvalidation";
import { resolveProvenanceForPatch, type AdminMetadataPatch } from "./adminPatch";
import {
  validateAdminMetadataPatch,
  validateApprovalEdits,
  validateCategoryInput,
  validateTaxonomyLabel,
  validateEffectiveAgeRange,
  validateVerifiedFieldKeys,
  isValidId,
  isValidDuplicateAction,
  isValidReviewFlagOutcome,
} from "./validation";
import type { MetadataFieldKey } from "@/lib/metadata/fieldRegistry";
import { planDuplicateResolution, type DuplicateResolutionAction } from "./duplicateResolution";
import { generateUniqueCategorySlug } from "./categorySlug";
import { FLAG_TYPES_RESOLVED_BY_REVIEW_LATER_APPROVAL, FLAG_TYPES_RESOLVED_BY_SAME_EDITION_DUPLICATE } from "./reviewFlagResolution";

const ADMIN_ACTOR = "admin";

/**
 * The Phase 8 admin transactional persistence layer — mirrors
 * `src/lib/intake/persistence.ts`'s own convention (a dedicated module of
 * `db.transaction` functions, never inline raw inserts in a Server Action).
 * Every function here is called by `src/lib/admin/actions.ts`'s "use server"
 * boundary, which independently enforces `requireAdminSession()` before any of
 * these ever run.
 */

/**
 * Fire-and-forget targeted embedding refresh — mirrors `src/lib/intake/actions.ts`'s
 * own private `attemptTargetedEmbedding` helper exactly (never awaited by the
 * caller, never lets a provider failure affect the admin mutation's own success —
 * §11/§21/§31: "Gemini/embedding failure never blocks admin save"). Deliberately
 * constructs `GeminiEmbeddingProvider` directly rather than importing
 * `lib/embeddings/index.ts`'s `getConfiguredEmbeddingProvider()` — that factory is
 * `import "server-only"`, which throws unconditionally outside Next's own build
 * pipeline, and this module (unlike `intake/actions.ts`) IS directly imported by
 * Vitest integration tests (`tests/integration/db/adminReview.test.ts`) — the exact
 * same reason `scripts/embeddings/generate.ts` constructs its own provider this way
 * instead of importing the guarded factory.
 */
function getConfiguredEmbeddingProviderForAdmin(): EmbeddingProvider | undefined {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return undefined;
  try {
    return new GeminiEmbeddingProvider(apiKey);
  } catch {
    return undefined;
  }
}

function attemptTargetedEmbedding(db: Database, bookId: string): void {
  const provider = getConfiguredEmbeddingProviderForAdmin();
  if (!provider) return;
  void generateEmbeddingForBook(db, provider, bookId).catch(() => {
    // Intentionally swallowed — the embedding backfill script recovers this later.
  });
}

async function completeParentJob(tx: Transaction, jobId: string): Promise<void> {
  await tx.update(ingestionJobs).set({ status: "completed", processedItems: 1, completedAt: new Date() }).where(eq(ingestionJobs.id, jobId));
}

// ---------------------------------------------------------------------------
// Review Later resolution (§11)
// ---------------------------------------------------------------------------

export interface ApproveReviewLaterInput {
  ingestionItemId: string;
  /** Presence-based admin corrections — exactly Phase 7's `TeacherEdits` shape,
   * diffed the same way `ConfirmBook.tsx` diffs Quick Edit: an omitted field means
   * "use the draft/AI value," an explicit `null` means "clear it." */
  edits: TeacherEdits;
  /** The category currently selected on the review detail screen — the fallback
   * used when `edits.physicalCategorySlug` is absent, exactly mirroring
   * `ConfirmSaveInput.categorySlug`. */
  categorySlug: string;
}

export type ApproveReviewLaterResult =
  | { ok: true; bookId: string }
  | { ok: false; error: "not_found" | "already_resolved" | "invalid_draft" | "insufficient_data" | "duplicate_unresolved" | "invalid_input" | "save_failed"; message: string };

const UNRESOLVED_DUPLICATE_OUTCOMES = new Set(["exact_copy_same_edition", "same_title_different_edition", "same_work_different_language", "ambiguous_similar_title"]);

/**
 * The core Review Later acceptance workflow (§11) — never reruns the Phase 7
 * intake pipeline; resolves every field from the ALREADY-VALIDATED persisted
 * draft using the exact same `resolveConfirmFields` presence-based logic the
 * original teacher confirm screen uses, so provenance (ai_inferred/
 * human_corrected/human_verified) is derived identically regardless of whether a
 * teacher or an admin made the final call. Branches into exactly one of two
 * persistence paths: finalizing an existing `pending_review` placeholder book
 * (`finalizePendingBook`), or creating a brand-new one via the existing,
 * already-transactional `saveNewBook` (an ingestion-only item with no prior book
 * row) — never a third, half-duplicated code path.
 */
export async function approveReviewLater(db: Database, input: ApproveReviewLaterInput): Promise<ApproveReviewLaterResult> {
  if (!isValidId(input.ingestionItemId)) return { ok: false, error: "not_found", message: "This review item no longer exists." };

  const [item] = await db.select().from(ingestionItems).where(eq(ingestionItems.id, input.ingestionItemId)).limit(1);
  if (!item) return { ok: false, error: "not_found", message: "This review item no longer exists." };
  if (item.status !== "needs_review") {
    return { ok: false, error: "already_resolved", message: "This item was already resolved. Refresh to see the latest version." };
  }

  const draft = readIntakeDraft(item.intakeDraft);
  if (!draft) {
    return { ok: false, error: "invalid_draft", message: "This item's saved data could not be read and needs a fresh look." };
  }

  if (draft.duplicateOutcome && UNRESOLVED_DUPLICATE_OUTCOMES.has(draft.duplicateOutcome)) {
    return { ok: false, error: "duplicate_unresolved", message: "Resolve the possible duplicate before approving this item." };
  }

  const validationFailure = validateApprovalEdits(input.edits);
  if (validationFailure) return { ok: false, error: "invalid_input", message: validationFailure.message };

  const resolved = resolveConfirmFields({
    edits: input.edits,
    proposedTitle: draft.proposedBookValues?.title,
    proposedLanguageCode: draft.proposedBookValues?.languageCode,
    proposedAuthors: draft.proposedBookValues?.authors,
    fallbackCategorySlug: input.categorySlug,
    enrichment: draft.enrichmentSuggestion,
    coverEvidence: draft.coverEvidence,
    categorySuggestion: draft.categorySuggestion,
  });

  if (!resolved.title) return { ok: false, error: "insufficient_data", message: "A title is needed before this book can be added." };
  const languageCode = resolved.languageCode as LanguageCode | null | undefined;
  if (!languageCode || !isLanguageCode(languageCode)) {
    return { ok: false, error: "insufficient_data", message: "A language is needed before this book can be added." };
  }
  const categorySlug = resolved.categorySlug;
  if (!categorySlug) return { ok: false, error: "insufficient_data", message: "A shelving category is needed before this book can be added." };

  // Effective age-range validation (§3): each supplied bound's own range was
  // already checked by `validateApprovalEdits()` above, but that alone can't
  // catch e.g. the admin raising only the minimum past an AI-suggested maximum
  // they never touched — this checks the actual RESOLVED pair that would be
  // saved, after `resolveConfirmFields()` has already merged edits with the
  // draft's AI/proposed values.
  const effectiveAgeError = validateEffectiveAgeRange(resolved.ageMinMonths ?? null, resolved.ageMaxMonths ?? null);
  if (effectiveAgeError) return { ok: false, error: "invalid_input", message: effectiveAgeError.message };

  // A new category assignment may never target an inactive category (§4) —
  // the admin UI only ever offers active categories, but the Server Action is
  // independently invokable. A previously-assigned inactive category (not
  // relevant here — this is always a NEW assignment, ingestion-only or
  // finalizing a pending placeholder) is never displayed as if active.
  const [activeCategoryRow] = await db.select({ id: physicalCategories.id }).from(physicalCategories).where(and(eq(physicalCategories.slug, categorySlug), eq(physicalCategories.isActive, true))).limit(1);
  if (!activeCategoryRow) {
    return { ok: false, error: "insufficient_data", message: "That shelving category is no longer active. Choose a current category." };
  }

  const provenance: ProvenanceInput[] = [...resolved.provenance];
  const enrichment = draft.enrichmentSuggestion;
  if (enrichment?.visualMediaTypes && enrichment.visualMediaTypes.length > 0) {
    provenance.push({ fieldKey: "visual_media_type", sourceType: "ai_inferred" });
  }
  if (enrichment?.visualRealism) provenance.push({ fieldKey: "visual_realism", sourceType: "ai_inferred" });

  // Metadata-parity correction: both branches below must derive the display
  // cover through the exact same Phase 7 trust boundary `confirmSaveAction`
  // uses — only a high-confidence reconciled candidate's thumbnail, from a
  // known trusted host, ever becomes the catalog display cover. Previously
  // NEITHER branch set this at all, and only `saveNewBook`'s call included
  // subtitle/illustrators/publisher/ISBN — `finalizePendingBook` silently
  // dropped them.
  const selectedCandidate = draft.selectedCandidateProviderIdentifier
    ? draft.metadataCandidates.find((c) => c.providerIdentifier === draft.selectedCandidateProviderIdentifier)
    : undefined;
  const displayCoverUrl = selectTrustworthyDisplayCoverUrl({
    reconciliationOutcome: draft.reconciliationOutcome,
    thumbnailUrl: selectedCandidate?.thumbnailUrl,
  });

  if (item.pendingBookId) {
    try {
      const bookId = await finalizePendingBook(db, {
        bookId: item.pendingBookId,
        ingestionItemId: input.ingestionItemId,
        title: resolved.title,
        subtitle: draft.proposedBookValues?.subtitle ?? undefined,
        authors: resolved.authors,
        illustrators: draft.proposedBookValues?.illustrators,
        publisherName: draft.proposedBookValues?.publisher ?? undefined,
        isbn10: draft.proposedBookValues?.isbn10 ?? undefined,
        isbn13: draft.proposedBookValues?.isbn13 ?? undefined,
        languageCode,
        description: resolved.description,
        physicalCategorySlug: categorySlug,
        fictionType: resolved.fictionType,
        format: resolved.format,
        ageMinMonths: resolved.ageMinMonths,
        ageMaxMonths: resolved.ageMaxMonths,
        readAloudMinutes: enrichment?.readAloudMinutes ?? undefined,
        visualMediaTypes: enrichment?.visualMediaTypes,
        visualRealism: enrichment?.visualRealism ?? undefined,
        tags: enrichment?.tags,
        displayCoverUrl,
        provenance,
      });
      if (!bookId) return { ok: false, error: "already_resolved", message: "This item was already updated. Refresh to see the latest version." };
      attemptTargetedEmbedding(db, bookId);
      return { ok: true, bookId };
    } catch (error) {
      return { ok: false, error: "save_failed", message: error instanceof Error ? error.message : "Couldn't approve this book. Please try again." };
    }
  }

  // Ingestion-only path: `saveNewBook()` itself has no status-conditional
  // guard on the ingestion item (it unconditionally marks it completed) — two
  // near-simultaneous approval submissions for the same item would otherwise
  // both proceed and create two books. Claiming the item here first (an
  // atomic conditional UPDATE, the same pattern `finalizePendingBook` and
  // `resolveDuplicate`'s same-edition branch use internally) means only one
  // caller ever reaches `saveNewBook` at all. A failed save reverts the claim
  // rather than stranding the item outside the queue forever.
  const claimed = await db
    .update(ingestionItems)
    .set({ status: "processing" })
    .where(and(eq(ingestionItems.id, input.ingestionItemId), eq(ingestionItems.status, "needs_review")))
    .returning({ id: ingestionItems.id });
  if (claimed.length === 0) {
    return { ok: false, error: "already_resolved", message: "This item was already updated. Refresh to see the latest version." };
  }

  try {
    const result = await saveNewBook(db, {
      title: resolved.title,
      subtitle: draft.proposedBookValues?.subtitle ?? undefined,
      authors: resolved.authors,
      illustrators: draft.proposedBookValues?.illustrators,
      publisherName: draft.proposedBookValues?.publisher ?? undefined,
      languageCode,
      isbn10: draft.proposedBookValues?.isbn10 ?? undefined,
      isbn13: draft.proposedBookValues?.isbn13 ?? undefined,
      description: resolved.description,
      physicalCategorySlug: categorySlug,
      fictionType: resolved.fictionType,
      format: resolved.format,
      ageMinMonths: resolved.ageMinMonths,
      ageMaxMonths: resolved.ageMaxMonths,
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
      actorLabel: ADMIN_ACTOR,
    });
    attemptTargetedEmbedding(db, result.bookId);
    return { ok: true, bookId: result.bookId };
  } catch (error) {
    await db.update(ingestionItems).set({ status: "needs_review" }).where(eq(ingestionItems.id, input.ingestionItemId));
    return { ok: false, error: "save_failed", message: error instanceof Error ? error.message : "Couldn't approve this book. Please try again." };
  }
}

interface FinalizePendingBookInput {
  bookId: string;
  ingestionItemId: string;
  title: string;
  subtitle?: string;
  authors: string[];
  illustrators?: string[];
  publisherName?: string;
  isbn10?: string;
  isbn13?: string;
  languageCode: LanguageCode;
  description?: string;
  physicalCategorySlug: string;
  fictionType?: "fiction" | "nonfiction";
  format?: Format;
  ageMinMonths?: number;
  ageMaxMonths?: number;
  readAloudMinutes?: number;
  visualMediaTypes?: IllustrationStyle[];
  visualRealism?: VisualRealism;
  tags?: string[];
  /** Phase 7's trust-boundary-checked cover, if any — see `displayCover.ts`.
   * Never the Drive original; never an ambiguous-candidate thumbnail. */
  displayCoverUrl?: string;
  provenance: ProvenanceInput[];
}

/**
 * Finalizes an existing Phase 7 `pending_review` placeholder book into a real
 * active catalog record (§11's "if a pending_review book already exists" branch)
 * — an UPDATE, never a second `books` row. Creates its first `book_copies` row
 * here (the placeholder never got one at Review Later time), matching "physical
 * copy is created exactly once." Returns `undefined` (not an exception) when the
 * book is no longer `pending_review` by the time this runs — a concurrent
 * resolution — so the caller can show the calm "already updated" message rather
 * than silently overwriting it.
 *
 * Correction pass fixes, both inside this one transaction:
 * 1. **Metadata parity** — now persists the exact same trusted-data set the
 *    ingestion-only `saveNewBook()` path does (subtitle, illustrators,
 *    publisher, ISBN-10/13, display cover), not a narrower subset.
 * 2. **Exactly-once concurrency** — the ingestion item is claimed (an atomic
 *    conditional UPDATE, `needs_review` -> `completed`) BEFORE any catalog
 *    mutation happens, not after. A concurrent resolution attempt gets zero
 *    claimed rows and returns immediately, having created nothing — the old
 *    order (copy insert, then a conditional ingestion-item update whose
 *    zero-row result was merely reported as an error) let a losing caller's
 *    copy insert survive even though it was told the item was already resolved.
 * 3. **Targeted review-flag resolution** — resolves only the flags a Review
 *    Later approval genuinely addresses (`FLAG_TYPES_RESOLVED_BY_REVIEW_LATER_APPROVAL`),
 *    never `missing_metadata`/`metadata_conflict`/other unrelated concerns.
 * 4. **Embedding invalidation** — clears any (here, always already-null)
 *    embedding state so a stale vector can never survive a searchable-content
 *    change, consistent with every other Phase 8 mutation.
 */
async function finalizePendingBook(db: Database, input: FinalizePendingBookInput): Promise<string | undefined> {
  return db.transaction(async (tx) => {
    const claimed = await tx
      .update(ingestionItems)
      .set({ status: "completed", completedAt: new Date() })
      .where(and(eq(ingestionItems.id, input.ingestionItemId), eq(ingestionItems.status, "needs_review")))
      .returning({ jobId: ingestionItems.jobId });
    if (claimed.length === 0) return undefined;

    const [category] = await tx
      .select({ id: physicalCategories.id, label: physicalCategories.label })
      .from(physicalCategories)
      .where(eq(physicalCategories.slug, input.physicalCategorySlug))
      .limit(1);
    if (!category) throw new Error(`Unknown physical category slug: ${input.physicalCategorySlug}`);

    const publisherId = input.publisherName ? await upsertPublisher(tx, input.publisherName) : null;

    const searchText = buildSearchIndexText({
      title: input.title,
      subtitle: input.subtitle,
      description: input.description,
      authors: input.authors,
      illustrators: input.illustrators,
      publisher: input.publisherName,
      categoryLabel: category.label,
      tags: input.tags ?? [],
      languageCode: input.languageCode,
      fictionType: input.fictionType,
      format: input.format,
      illustrationStyles: input.visualMediaTypes ?? [],
      visualRealism: input.visualRealism,
      ageMinMonths: input.ageMinMonths,
      ageMaxMonths: input.ageMaxMonths,
      readAloudMinutes: input.readAloudMinutes,
    });

    const updated = await tx
      .update(books)
      .set({
        title: input.title,
        normalizedTitle: normalizeTitle(input.title),
        sortTitle: computeSortTitle(input.title),
        subtitle: input.subtitle,
        shortDescription: input.description,
        languageCode: input.languageCode,
        fictionStatus: input.fictionType ?? "unknown_mixed",
        ageMinMonths: input.ageMinMonths,
        ageMaxMonths: input.ageMaxMonths,
        readAloudMinutesEstimate: input.readAloudMinutes != null ? input.readAloudMinutes.toFixed(1) : null,
        format: input.format,
        visualMediaType: input.visualMediaTypes,
        visualRealism: input.visualRealism,
        publisherId,
        isbn10: input.isbn10,
        isbn13: input.isbn13,
        physicalCategoryId: category.id,
        displayCoverUrl: input.displayCoverUrl,
        displayCoverSource: input.displayCoverUrl ? "external_provider_thumbnail" : undefined,
        reviewStatus: "active",
        verifiedAt: new Date(),
        searchText,
        updatedAt: new Date(),
      })
      .where(and(eq(books.id, input.bookId), eq(books.reviewStatus, "pending_review")))
      .returning({ id: books.id });

    if (updated.length === 0) {
      // The ingestion item was already successfully claimed above — a book
      // that vanished out from under it (archived by an unrelated action) is
      // a genuine anomaly, not a normal "already resolved" race. Throwing
      // rolls back the claim too, so the ingestion item stays `needs_review`
      // rather than being marked completed with nothing actually finalized.
      throw new Error("This book could not be finalized — it may have been changed by another action.");
    }
    const bookId = updated[0].id;

    await invalidateEmbedding(tx, bookId);

    await tx.delete(bookContributors).where(and(eq(bookContributors.bookId, bookId), eq(bookContributors.role, "author")));
    for (const [index, author] of input.authors.entries()) {
      const contributorId = await upsertContributor(tx, author);
      await tx
        .insert(bookContributors)
        .values({ bookId, contributorId, role: "author", sortOrder: index })
        .onConflictDoNothing();
    }

    await tx.delete(bookContributors).where(and(eq(bookContributors.bookId, bookId), eq(bookContributors.role, "illustrator")));
    for (const [index, illustrator] of (input.illustrators ?? []).entries()) {
      const contributorId = await upsertContributor(tx, illustrator);
      await tx
        .insert(bookContributors)
        .values({ bookId, contributorId, role: "illustrator", sortOrder: index })
        .onConflictDoNothing();
    }

    await tx.delete(bookTags).where(eq(bookTags.bookId, bookId));
    for (const tagName of input.tags ?? []) {
      const tagId = await upsertTag(tx, tagName);
      await tx.insert(bookTags).values({ bookId, tagId }).onConflictDoNothing();
    }

    await writeCurrentProvenance(tx, bookId, input.provenance);

    await tx
      .update(reviewFlags)
      .set({ status: "resolved", resolvedAt: new Date(), resolvedBy: ADMIN_ACTOR, resolutionNote: "Resolved by Review Later approval." })
      .where(and(eq(reviewFlags.bookId, bookId), eq(reviewFlags.status, "open"), inArray(reviewFlags.flagType, FLAG_TYPES_RESOLVED_BY_REVIEW_LATER_APPROVAL)));

    // Phase 9 addendum §10 — a bulk-imported item that landed in
    // needs_review still carries its originating job's `--location`
    // configuration (if any); an admin approving it later must not silently
    // lose that, since this is the only place its physical copy is actually
    // created.
    const initialLocationId = await getJobInitialLocationId(tx, claimed[0].jobId);
    const [copyRow] = await tx.insert(bookCopies).values({ bookId, sourceIngestionItemId: input.ingestionItemId, currentLocationId: initialLocationId ?? undefined }).returning({ id: bookCopies.id });

    await tx.update(ingestionItems).set({ resultingCopyId: copyRow.id }).where(eq(ingestionItems.id, input.ingestionItemId));
    await completeParentJob(tx, claimed[0].jobId);

    await tx.insert(auditLog).values({
      actorLabel: ADMIN_ACTOR,
      action: "review_later_approved",
      entityType: "book",
      entityId: bookId,
      detail: { title: input.title, ingestionItemId: input.ingestionItemId },
    });

    return bookId;
  });
}

// ---------------------------------------------------------------------------
// Duplicate resolution (§12/§13/§14) — the narrow set of approved outcomes for
// pending Phase 7 intake only. No general book-merge engine exists or is
// introduced here.
// ---------------------------------------------------------------------------

export interface ResolveDuplicateInput {
  ingestionItemId: string;
  action: DuplicateResolutionAction;
  /** Required for different_edition/different_language/false_match when a real
   * existing catalog book is the comparison target — omitted for `unresolved`,
   * and irrelevant for `same_edition` (that always targets whichever candidate
   * the admin is comparing against, passed here the same way). */
  existingBookId?: string;
  note?: string;
}

export type ResolveDuplicateResult = { ok: true } | { ok: false; error: "not_found" | "already_resolved" | "insufficient_data" | "invalid_target" | "invalid_input"; message: string };

/**
 * Resolves a possible-duplicate decision for a Review Later item (§12). Never a
 * general merge: SAME EDITION retains the existing canonical book, attaches a new
 * physical copy to it, and archives the ingestion's own `pending_review`
 * placeholder if one exists (never hard-deleted, never field-merged). Every other
 * outcome finalizes the pending/ingestion-only item as its own bibliographic
 * record via `approveReviewLater`-equivalent logic — callers should call
 * `approveReviewLater` themselves afterward for `different_edition`/
 * `different_language`/`false_match`/none of this function's job, since those
 * outcomes still need the admin's identity/category corrections. This function
 * only records the DUPLICATE DECISION itself and, for `same_edition`, performs
 * the copy-creation/placeholder-archival that decision implies.
 *
 * Correction pass: `existingBookId` is now validated BEFORE anything is
 * written (§8) — it must be one of the duplicate candidates this ingestion
 * item's own persisted draft actually recorded (`duplicateCandidateBookIds`),
 * a real non-archived book, and never the placeholder itself. Previously this
 * value was trusted as-is; the admin UI happens to only ever send a real
 * candidate id, but the Server Action is independently invokable with
 * anything. SAME EDITION additionally claims the ingestion item (an atomic
 * conditional UPDATE) BEFORE creating the physical copy, not after, so two
 * near-simultaneous resolutions of the same item can never both succeed (§7).
 */
export async function resolveDuplicate(db: Database, input: ResolveDuplicateInput): Promise<ResolveDuplicateResult> {
  if (!isValidId(input.ingestionItemId)) return { ok: false, error: "not_found", message: "This review item no longer exists." };
  if (!isValidDuplicateAction(input.action)) return { ok: false, error: "invalid_input", message: "Not a recognized duplicate decision." };

  const [item] = await db.select().from(ingestionItems).where(eq(ingestionItems.id, input.ingestionItemId)).limit(1);
  if (!item) return { ok: false, error: "not_found", message: "This review item no longer exists." };
  if (item.status !== "needs_review") {
    return { ok: false, error: "already_resolved", message: "This item was already resolved. Refresh to see the latest version." };
  }

  if (input.existingBookId) {
    if (!isUuid(input.existingBookId)) return { ok: false, error: "invalid_target", message: "That book selection isn't valid." };
    if (input.existingBookId === item.pendingBookId) {
      return { ok: false, error: "invalid_target", message: "A record can't be marked as a duplicate of itself." };
    }
    const draftForValidation = readIntakeDraft(item.intakeDraft);
    if (!draftForValidation || !draftForValidation.duplicateCandidateBookIds.includes(input.existingBookId)) {
      return { ok: false, error: "invalid_target", message: "That book isn't one of the possible matches recorded for this item." };
    }
    const [targetBook] = await db.select({ id: books.id, reviewStatus: books.reviewStatus }).from(books).where(eq(books.id, input.existingBookId)).limit(1);
    if (!targetBook || targetBook.reviewStatus === "archived") {
      return { ok: false, error: "invalid_target", message: "That book is no longer available to compare against." };
    }
  }

  const plan = planDuplicateResolution(input.action, item.pendingBookId != null);

  if (input.action === "same_edition") {
    if (!input.existingBookId) return { ok: false, error: "insufficient_data", message: "Choose which existing book this is a copy of." };
    const existingBookId = input.existingBookId;
    try {
      return await db.transaction(async (tx) => {
        // Claim the ingestion item FIRST, before any copy/book mutation — a
        // concurrent resolution attempt then gets zero claimed rows and exits
        // having created nothing at all (the previous order created the copy
        // BEFORE this check, so a losing concurrent caller's copy insert
        // survived even though it was told the item was already resolved).
        const claimed = await tx
          .update(ingestionItems)
          .set({ status: "completed", completedAt: new Date() })
          .where(and(eq(ingestionItems.id, input.ingestionItemId), eq(ingestionItems.status, "needs_review")))
          .returning({ jobId: ingestionItems.jobId });
        if (claimed.length === 0) {
          return { ok: false, error: "already_resolved", message: "This item was already updated. Refresh to see the latest version." };
        }

        const [existingBook] = await tx.select({ id: books.id, reviewStatus: books.reviewStatus }).from(books).where(eq(books.id, existingBookId)).limit(1);
        if (!existingBook || existingBook.reviewStatus === "archived") {
          throw new Error("The existing book to attach a copy to could not be found.");
        }

        // Phase 9 addendum §10 — same reasoning as `finalizePendingBook` above:
        // an existing-edition duplicate resolution is also a copy-creation
        // point for a bulk-imported item.
        const initialLocationId = await getJobInitialLocationId(tx, claimed[0].jobId);
        const [copyRow] = await tx
          .insert(bookCopies)
          .values({ bookId: existingBook.id, sourceIngestionItemId: input.ingestionItemId, currentLocationId: initialLocationId ?? undefined })
          .returning({ id: bookCopies.id });

        if (plan.archivePendingPlaceholder && item.pendingBookId) {
          await tx.update(books).set({ reviewStatus: "archived", updatedAt: new Date() }).where(eq(books.id, item.pendingBookId));
          await tx
            .update(reviewFlags)
            .set({ status: "resolved", resolvedAt: new Date(), resolvedBy: ADMIN_ACTOR, resolutionNote: "Resolved as a duplicate — same edition." })
            .where(and(eq(reviewFlags.bookId, item.pendingBookId), eq(reviewFlags.status, "open"), inArray(reviewFlags.flagType, FLAG_TYPES_RESOLVED_BY_SAME_EDITION_DUPLICATE)));
        }

        await tx.update(ingestionItems).set({ resultingCopyId: copyRow.id }).where(eq(ingestionItems.id, input.ingestionItemId));
        await completeParentJob(tx, claimed[0].jobId);

        await tx.insert(auditLog).values({
          actorLabel: ADMIN_ACTOR,
          action: "duplicate_resolved_same_edition",
          entityType: "book",
          entityId: existingBook.id,
          detail: { ingestionItemId: input.ingestionItemId, archivedPlaceholderBookId: plan.archivePendingPlaceholder ? item.pendingBookId : null, note: input.note ?? null },
        });

        return { ok: true };
      });
    } catch (error) {
      return { ok: false, error: "not_found", message: error instanceof Error ? error.message : "Couldn't resolve this duplicate. Please try again." };
    }
  }

  if (input.action === "unresolved") {
    // Explicitly a no-op on ingestion/book state — the item stays exactly as it
    // was, still pending, never silently advanced.
    return { ok: true };
  }

  // different_edition / different_language / false_match: record the relationship
  // only when a real existing comparison book was actually named (an admin may
  // also reach this outcome with no specific comparison target — e.g. dismissing
  // a same-title match as coincidental — in which case there is nothing to relate
  // two ids together, so no row is created, matching §14's "no nonsensical
  // self-relations"). `existingBookId` was already validated above.
  if (plan.createDuplicateRelationshipRow && input.existingBookId && item.pendingBookId) {
    await db.insert(bookDuplicates).values({
      bookIdA: item.pendingBookId,
      bookIdB: input.existingBookId,
      relationshipType: plan.relationshipType,
      detectedBy: "admin_manual",
      status: "confirmed",
      resolvedBy: ADMIN_ACTOR,
      resolvedAt: new Date(),
      notes: input.note,
    });
  }

  // Critical: the item's own STORED draft still carries whatever
  // `duplicateOutcome` Phase 7 last recorded (e.g. "ambiguous_similar_title") —
  // `approveReviewLater()`'s own unresolved-duplicate guard reads exactly that
  // field, so without clearing it here a subsequent approval attempt would stay
  // permanently blocked even though the admin just resolved the ambiguity.
  // Mirrors `markDifferentBookAction`'s existing Phase 7 convention (setting
  // `duplicateOutcome` to `"no_match"` once a human has explicitly decided this
  // is not the same book).
  const draft = readIntakeDraft(item.intakeDraft);
  if (draft) {
    draft.duplicateOutcome = "no_match";
    await db.update(ingestionItems).set({ intakeDraft: draft }).where(eq(ingestionItems.id, input.ingestionItemId));
  }

  await db.insert(auditLog).values({
    actorLabel: ADMIN_ACTOR,
    action: `duplicate_resolved_${input.action}`,
    entityType: "ingestion_item",
    entityId: input.ingestionItemId,
    detail: { existingBookId: input.existingBookId ?? null, note: input.note ?? null },
  });

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Basic admin metadata editor (§15/§16/§17)
// ---------------------------------------------------------------------------

export interface UpdateBookMetadataInput {
  bookId: string;
  patch: AdminMetadataPatch;
  /** Fields the admin explicitly confirmed WITHOUT changing (§17's "Verify"
   * control / "Keep current category") — becomes `human_verified`, never applied
   * to a field also present in `patch` (a change always wins as `human_corrected`). */
  explicitlyVerifiedFields?: MetadataFieldKey[];
  /** Optimistic-concurrency guard (§34) — when provided, the update only applies
   * if the book's `updated_at` still matches; otherwise this returns `stale`. */
  expectedUpdatedAt?: Date;
}

export type UpdateBookMetadataResult = { ok: true } | { ok: false; error: "not_found" | "stale" | "invalid_category" | "invalid_input"; message: string };

const INACTIVE_CATEGORY_MESSAGE = "That shelving category is no longer active. Choose a current category.";

/** Fields whose presence in a patch never changes the composed embedding
 * document (`lib/embeddings/document.ts`'s `EmbeddingDocumentInput`) — every
 * other field does, so any patch touching a field outside this set makes the
 * book's stored embedding stale and must invalidate it (§4). */
const EMBEDDING_IRRELEVANT_PATCH_FIELDS = new Set<keyof AdminMetadataPatch>(["isbn10", "isbn13"]);

function patchAffectsEmbeddingDocument(patch: AdminMetadataPatch): boolean {
  return (Object.keys(patch) as (keyof AdminMetadataPatch)[]).some((key) => !EMBEDDING_IRRELEVANT_PATCH_FIELDS.has(key));
}

/**
 * Which open review flag a field genuinely resolves once the admin either
 * CORRECTS it (changes its value) or explicitly VERIFIES it (keeps it
 * unchanged via a dedicated action) — only the two fields with an obvious,
 * unambiguous corresponding flag type. Touching description/title/etc. has no
 * corresponding "uncertain" flag today and resolves nothing extra.
 *
 * Final closure pass (§9): previously this only applied to explicit
 * verification — correcting an uncertain category or visual style (the far
 * more common real interaction: the admin sees "category needs confirmation,"
 * picks the RIGHT one, and saves) left the old `category_uncertain`/
 * `visual_style_uncertain` flag open, forcing a redundant second manual
 * Resolve click on a concern the correction itself already addressed.
 */
const FIELD_RESOLVES_UNCERTAINTY_FLAG_TYPE: Partial<Record<MetadataFieldKey, ReviewFlagType>> = {
  physical_category: "category_uncertain",
  visual_media_type: "visual_style_uncertain",
  visual_realism: "visual_style_uncertain",
};

/**
 * The one place an admin metadata correction becomes a real, coherent database
 * change (§15–§17, §32): core `books` columns, contributors, tags, and publisher
 * are all updated transactionally and consistently with a title/category/tag
 * change, provenance is written via the shared `writeCurrentProvenance` helper
 * using presence-based patch semantics (never `??`), and — outside the
 * transaction, but still before returning — deterministic search text is rebuilt
 * and a targeted embedding refresh is attempted (never blocking, never able to
 * fail the save itself).
 */
export async function updateBookMetadata(db: Database, input: UpdateBookMetadataInput): Promise<UpdateBookMetadataResult> {
  if (!isValidId(input.bookId)) return { ok: false, error: "not_found", message: "This book could not be found." };
  const verifiedFieldsInput = input.explicitlyVerifiedFields ?? [];
  const verifiedFieldsValidation = validateVerifiedFieldKeys(verifiedFieldsInput);
  if (verifiedFieldsValidation) return { ok: false, error: "invalid_input", message: verifiedFieldsValidation.message };

  const { patch } = input;
  const provenanceDecisions = resolveProvenanceForPatch(patch, verifiedFieldsInput);

  const result = await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(books).where(eq(books.id, input.bookId)).limit(1);
    if (!existing) return { ok: false as const, error: "not_found" as const, message: "This book could not be found." };
    if (input.expectedUpdatedAt && existing.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()) {
      return { ok: false as const, error: "stale" as const, message: "This record was changed since you loaded it. Refresh to see the latest version." };
    }

    const validationFailure = validateAdminMetadataPatch(patch, { ageMinMonths: existing.ageMinMonths, ageMaxMonths: existing.ageMaxMonths });
    if (validationFailure) return { ok: false as const, error: "invalid_input" as const, message: validationFailure.message };

    let categoryId = existing.physicalCategoryId;
    if (patch.physicalCategorySlug !== undefined) {
      if (patch.physicalCategorySlug === null) {
        return { ok: false as const, error: "invalid_category" as const, message: "A shelving category is required." };
      }
      const [category] = await tx.select({ id: physicalCategories.id, isActive: physicalCategories.isActive }).from(physicalCategories).where(eq(physicalCategories.slug, patch.physicalCategorySlug)).limit(1);
      if (!category) return { ok: false as const, error: "invalid_category" as const, message: "That category no longer exists." };
      // §4: a NEW assignment may never target an inactive category — a book
      // already assigned one (grandfathered before deactivation) keeps it
      // until explicitly re-categorized, but this correction is a fresh
      // assignment and must go through an active category only.
      if (!category.isActive) return { ok: false as const, error: "invalid_category" as const, message: INACTIVE_CATEGORY_MESSAGE };
      categoryId = category.id;
    }

    let publisherId = existing.publisherId;
    if (patch.publisherName !== undefined) {
      publisherId = patch.publisherName ? await upsertPublisher(tx, patch.publisherName) : null;
    }

    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.title !== undefined && patch.title) {
      update.title = patch.title;
      update.normalizedTitle = normalizeTitle(patch.title);
      update.sortTitle = computeSortTitle(patch.title);
    }
    if (patch.subtitle !== undefined) update.subtitle = patch.subtitle;
    if (patch.description !== undefined) update.shortDescription = patch.description;
    if (patch.languageCode !== undefined && patch.languageCode) update.languageCode = patch.languageCode;
    if (patch.fictionType !== undefined) update.fictionStatus = patch.fictionType ?? "unknown_mixed";
    if (patch.ageMinMonths !== undefined) update.ageMinMonths = patch.ageMinMonths;
    if (patch.ageMaxMonths !== undefined) update.ageMaxMonths = patch.ageMaxMonths;
    if (patch.readAloudMinutes !== undefined) update.readAloudMinutesEstimate = patch.readAloudMinutes != null ? patch.readAloudMinutes.toFixed(1) : null;
    if (patch.format !== undefined) update.format = patch.format;
    if (patch.visualMediaTypes !== undefined) update.visualMediaType = patch.visualMediaTypes;
    if (patch.visualRealism !== undefined) update.visualRealism = patch.visualRealism;
    if (patch.imprint !== undefined) update.imprint = patch.imprint;
    if (patch.isbn10 !== undefined) update.isbn10 = patch.isbn10;
    if (patch.isbn13 !== undefined) update.isbn13 = patch.isbn13;
    if (patch.physicalCategorySlug !== undefined) update.physicalCategoryId = categoryId;
    if (patch.publisherName !== undefined) update.publisherId = publisherId;

    await tx.update(books).set(update).where(eq(books.id, input.bookId));

    if (patch.authors !== undefined) {
      await tx.delete(bookContributors).where(and(eq(bookContributors.bookId, input.bookId), eq(bookContributors.role, "author")));
      for (const [index, author] of (patch.authors ?? []).entries()) {
        const contributorId = await upsertContributor(tx, author);
        await tx
          .insert(bookContributors)
          .values({ bookId: input.bookId, contributorId, role: "author", sortOrder: index })
          .onConflictDoNothing();
      }
    }
    if (patch.illustrators !== undefined) {
      await tx.delete(bookContributors).where(and(eq(bookContributors.bookId, input.bookId), eq(bookContributors.role, "illustrator")));
      for (const [index, illustrator] of (patch.illustrators ?? []).entries()) {
        const contributorId = await upsertContributor(tx, illustrator);
        await tx
          .insert(bookContributors)
          .values({ bookId: input.bookId, contributorId, role: "illustrator", sortOrder: index })
          .onConflictDoNothing();
      }
    }
    if (patch.tags !== undefined) {
      await tx.delete(bookTags).where(eq(bookTags.bookId, input.bookId));
      for (const tagName of patch.tags ?? []) {
        const tagId = await upsertTag(tx, tagName);
        await tx.insert(bookTags).values({ bookId: input.bookId, tagId }).onConflictDoNothing();
      }
    }

    await writeCurrentProvenance(
      tx,
      input.bookId,
      provenanceDecisions.map((d) => ({ fieldKey: d.fieldKey, sourceType: d.sourceType }))
    );

    const correctedFields = provenanceDecisions.filter((d) => d.sourceType === "human_corrected").map((d) => d.fieldKey);
    const verifiedFields = provenanceDecisions.filter((d) => d.sourceType === "human_verified").map((d) => d.fieldKey);

    // A field that was either CORRECTED (its value actually changed) or
    // explicitly VERIFIED (kept unchanged via a dedicated action) resolves
    // the one review flag type that concern unambiguously corresponds to —
    // e.g. correcting the category, or explicitly "Keep current category,"
    // both resolve `category_uncertain`. Never touches an unrelated flag type,
    // and never resolves a flag for a field with no corresponding entry in
    // `FIELD_RESOLVES_UNCERTAINTY_FLAG_TYPE` (§9).
    const addressedFlagTypes = [...new Set([...correctedFields, ...verifiedFields].map((f) => FIELD_RESOLVES_UNCERTAINTY_FLAG_TYPE[f]).filter((t): t is ReviewFlagType => t != null))];
    if (addressedFlagTypes.length > 0) {
      await tx
        .update(reviewFlags)
        .set({ status: "resolved", resolvedAt: new Date(), resolvedBy: ADMIN_ACTOR, resolutionNote: "Resolved by admin review." })
        .where(and(eq(reviewFlags.bookId, input.bookId), eq(reviewFlags.status, "open"), inArray(reviewFlags.flagType, addressedFlagTypes)));
    }

    // Invalidate any stale embedding in THIS SAME transaction as the
    // searchable-content change (§4) — a book whose composed document just
    // changed must never keep serving an old vector, even for the brief
    // window before the fire-and-forget refresh (if any) completes.
    if (patchAffectsEmbeddingDocument(patch)) {
      await invalidateEmbedding(tx, input.bookId);
    }

    // Truthful audit action (§8): a verify-only save (an empty/no-op patch,
    // only `explicitlyVerifiedFields`) must never be logged as
    // `metadata_corrected` — nothing was corrected. A correction-only save
    // stays `metadata_corrected`; a verify-only save is `metadata_verified`;
    // a save containing both is the bounded `metadata_updated`, with each
    // field attributed to exactly the thing that happened to it.
    let auditAction: string;
    let auditDetail: Record<string, unknown>;
    if (correctedFields.length > 0 && verifiedFields.length > 0) {
      auditAction = "metadata_updated";
      auditDetail = { correctedFields, verifiedFields };
    } else if (verifiedFields.length > 0) {
      auditAction = "metadata_verified";
      auditDetail = { verifiedFields };
    } else {
      auditAction = "metadata_corrected";
      auditDetail = { correctedFields };
    }

    await tx.insert(auditLog).values({
      actorLabel: ADMIN_ACTOR,
      action: auditAction,
      entityType: "book",
      entityId: input.bookId,
      detail: auditDetail,
    });

    return { ok: true as const };
  });

  if (result.ok) {
    await rebuildSearchTextForBooks(db, [input.bookId]);
    attemptTargetedEmbedding(db, input.bookId);
  }

  return result;
}

export interface ArchiveBookResult {
  ok: boolean;
  message?: string;
}

/** Archives an active/pending record (§30) — never a hard delete. Requires
 * confirmation at the UI layer; this function itself just performs the safe,
 * reversible status change and audits it. */
export async function archiveBook(db: Database, bookId: string, note?: string): Promise<ArchiveBookResult> {
  if (!isValidId(bookId)) return { ok: false, message: "This book could not be found." };

  const [existing] = await db.select({ id: books.id, reviewStatus: books.reviewStatus }).from(books).where(eq(books.id, bookId)).limit(1);
  if (!existing) return { ok: false, message: "This book could not be found." };
  if (existing.reviewStatus === "archived") return { ok: true };

  await db.update(books).set({ reviewStatus: "archived", updatedAt: new Date() }).where(eq(books.id, bookId));
  await db.insert(auditLog).values({ actorLabel: ADMIN_ACTOR, action: "book_archived", entityType: "book", entityId: bookId, detail: { note: note ?? null } });
  return { ok: true };
}

export interface DismissReviewFlagResult {
  ok: boolean;
  message?: string;
}

/** Resolves/dismisses exactly ONE review flag (§29) — never every flag on a book
 * merely because one problem was fixed. */
export async function resolveReviewFlag(db: Database, flagId: string, outcome: "resolved" | "dismissed", note?: string): Promise<DismissReviewFlagResult> {
  if (!isValidId(flagId)) return { ok: false, message: "This flag could not be found." };
  if (!isValidReviewFlagOutcome(outcome)) return { ok: false, message: "Not a recognized outcome." };

  const updated = await db
    .update(reviewFlags)
    .set({ status: outcome, resolvedAt: new Date(), resolvedBy: ADMIN_ACTOR, resolutionNote: note })
    .where(and(eq(reviewFlags.id, flagId), eq(reviewFlags.status, "open")))
    .returning({ id: reviewFlags.id, bookId: reviewFlags.bookId });
  if (updated.length === 0) return { ok: false, message: "This flag was already resolved. Refresh to see the latest version." };

  await db.insert(auditLog).values({
    actorLabel: ADMIN_ACTOR,
    action: outcome === "resolved" ? "review_flag_resolved" : "review_flag_dismissed",
    entityType: "review_flag",
    entityId: flagId,
    detail: { bookId: updated[0].bookId, note: note ?? null },
  });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Physical category administration (§19/§20/§21)
// ---------------------------------------------------------------------------

export interface CreateCategoryInput {
  label: string;
  description?: string;
  displayOrder?: number;
}

export type CreateCategoryResult = { ok: true; id: string; slug: string } | { ok: false; error: "invalid_label"; message: string };

export async function createCategory(db: Database, input: CreateCategoryInput): Promise<CreateCategoryResult> {
  const inputValidation = validateCategoryInput(input);
  if (inputValidation) return { ok: false, error: "invalid_label", message: inputValidation.message };
  const label = input.label.trim();
  if (!label) return { ok: false, error: "invalid_label", message: "A category name is required." };

  return db.transaction(async (tx) => {
    const existingSlugs = await tx.select({ slug: physicalCategories.slug }).from(physicalCategories);
    const slug = generateUniqueCategorySlug(label, new Set(existingSlugs.map((r) => r.slug)));

    const [row] = await tx
      .insert(physicalCategories)
      .values({ slug, label, description: input.description, displayOrder: input.displayOrder ?? 0 })
      .returning({ id: physicalCategories.id, slug: physicalCategories.slug });

    await tx.insert(auditLog).values({ actorLabel: ADMIN_ACTOR, action: "category_created", entityType: "physical_category", entityId: row.id, detail: { label, slug: row.slug } });
    return { ok: true, id: row.id, slug: row.slug };
  });
}

export interface UpdateCategoryInput {
  categoryId: string;
  /** Presence-based — omit to leave alone, per §16's shared patch philosophy. */
  label?: string;
  description?: string | null;
  displayOrder?: number;
}

export type UpdateCategoryResult = { ok: true } | { ok: false; error: "not_found" | "invalid_label"; message: string };

/**
 * Renaming NEVER touches `id` or `slug` (§19/§21) — only `label`/`description`/
 * `displayOrder` are ever written here. A label change rebuilds deterministic
 * search text (and invalidates any stale embedding, §4) for every book
 * currently in this category, since the category label is part of every
 * affected book's composed search/embedding document.
 *
 * Audit truthfulness correction (§10): this used to unconditionally log
 * `category_renamed` even for a guidance-only or display-order-only edit,
 * falsely claiming a rename that never happened. The audit action now
 * truthfully distinguishes what actually changed: `category_renamed` (label
 * only), `category_guidance_updated` (description only), or the bounded
 * `category_updated` (anything else, or more than one field at once) whose
 * detail lists exactly which fields changed — never a fabricated event.
 */
export async function updateCategory(db: Database, input: UpdateCategoryInput): Promise<UpdateCategoryResult> {
  if (!isValidId(input.categoryId)) return { ok: false, error: "not_found", message: "This category could not be found." };
  const inputValidation = validateCategoryInput(input);
  if (inputValidation) return { ok: false, error: "invalid_label", message: inputValidation.message };

  const outcome = await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(physicalCategories).where(eq(physicalCategories.id, input.categoryId)).limit(1);
    if (!existing) return { ok: false as const, error: "not_found" as const, message: "This category could not be found." };

    const labelChanged = input.label !== undefined && input.label.trim() !== existing.label;
    const descriptionChanged = input.description !== undefined && input.description !== existing.description;
    const displayOrderChanged = input.displayOrder !== undefined && input.displayOrder !== existing.displayOrder;

    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (input.label !== undefined) update.label = input.label.trim();
    if (input.description !== undefined) update.description = input.description;
    if (input.displayOrder !== undefined) update.displayOrder = input.displayOrder;

    await tx.update(physicalCategories).set(update).where(eq(physicalCategories.id, input.categoryId));

    let affectedBookIds: string[] = [];
    if (labelChanged) {
      const affected = await tx.select({ id: books.id }).from(books).where(eq(books.physicalCategoryId, input.categoryId));
      affectedBookIds = affected.map((b) => b.id);
      if (affectedBookIds.length > 0) await invalidateEmbeddings(tx, affectedBookIds);
    }

    const changedFields = [labelChanged && "label", descriptionChanged && "description", displayOrderChanged && "displayOrder"].filter((f): f is string => Boolean(f));
    let auditAction = "category_updated";
    if (changedFields.length === 1 && labelChanged) auditAction = "category_renamed";
    else if (changedFields.length === 1 && descriptionChanged) auditAction = "category_guidance_updated";

    await tx.insert(auditLog).values({
      actorLabel: ADMIN_ACTOR,
      action: auditAction,
      entityType: "physical_category",
      entityId: input.categoryId,
      detail: { changedFields, previousLabel: labelChanged ? existing.label : undefined, newLabel: labelChanged ? input.label : undefined, affectedBooks: affectedBookIds.length },
    });

    return { ok: true as const, affectedBookIds };
  });

  if (outcome.ok && outcome.affectedBookIds.length > 0) {
    await rebuildSearchTextForBooks(db, outcome.affectedBookIds);
    for (const bookId of outcome.affectedBookIds) attemptTargetedEmbedding(db, bookId);
  }

  return outcome.ok ? { ok: true } : outcome;
}

export type SetCategoryActiveResult =
  | { ok: true }
  | { ok: false; error: "not_found" | "blocked_referenced"; message: string; referencingBookCount?: number };

/**
 * Safe activation/deactivation (§20) — a category may never be deactivated while
 * any non-archived book still references it, so a currently-shelved book is
 * never silently reassigned to a hidden category. Activation has no such
 * restriction (making a retired category available again is always safe).
 */
export async function setCategoryActive(db: Database, categoryId: string, isActive: boolean): Promise<SetCategoryActiveResult> {
  if (!isValidId(categoryId)) return { ok: false, error: "not_found", message: "This category could not be found." };
  if (typeof isActive !== "boolean") return { ok: false, error: "not_found", message: "This category could not be found." };

  const [existing] = await db.select({ id: physicalCategories.id }).from(physicalCategories).where(eq(physicalCategories.id, categoryId)).limit(1);
  if (!existing) return { ok: false, error: "not_found", message: "This category could not be found." };

  if (!isActive) {
    const referencing = await db
      .select({ id: books.id })
      .from(books)
      .where(and(eq(books.physicalCategoryId, categoryId), eq(books.reviewStatus, "active")));
    const pendingReferencing = await db
      .select({ id: books.id })
      .from(books)
      .where(and(eq(books.physicalCategoryId, categoryId), eq(books.reviewStatus, "pending_review")));
    const referencingBookCount = referencing.length + pendingReferencing.length;
    if (referencingBookCount > 0) {
      return {
        ok: false,
        error: "blocked_referenced",
        message: `${referencingBookCount} book${referencingBookCount === 1 ? "" : "s"} still use this category. Re-categorize them before deactivating it.`,
        referencingBookCount,
      };
    }
  }

  await db.update(physicalCategories).set({ isActive, updatedAt: new Date() }).where(eq(physicalCategories.id, categoryId));
  await db.insert(auditLog).values({ actorLabel: ADMIN_ACTOR, action: isActive ? "category_activated" : "category_deactivated", entityType: "physical_category", entityId: categoryId, detail: {} });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Taxonomy suggestions (§24/§25/§26)
// ---------------------------------------------------------------------------

export type TaxonomyDecisionResult =
  | { ok: true; categoryId?: string; categorySlug?: string }
  | { ok: false; error: "not_found" | "already_decided" | "invalid_label" | "invalid_target"; message: string };

/** APPROVE — creates a brand-new category, only after the admin has confirmed
 * (and may have edited) its label/guidance; the CATEGORY is what actually gets
 * activated, and this admin action is what does it, never the AI/system that
 * proposed the concept (§25). */
export async function approveTaxonomySuggestion(
  db: Database,
  suggestionId: string,
  confirmedLabel: string,
  description?: string
): Promise<TaxonomyDecisionResult> {
  if (!isValidId(suggestionId)) return { ok: false, error: "not_found", message: "This suggestion could not be found." };
  const labelValidation = validateTaxonomyLabel(confirmedLabel);
  if (labelValidation) return { ok: false, error: "invalid_label", message: labelValidation.message };
  const label = confirmedLabel.trim();

  return db.transaction(async (tx) => {
    const [suggestion] = await tx.select().from(taxonomySuggestions).where(eq(taxonomySuggestions.id, suggestionId)).limit(1);
    if (!suggestion) return { ok: false, error: "not_found", message: "This suggestion could not be found." };
    if (suggestion.status !== "pending") return { ok: false, error: "already_decided", message: "This suggestion was already decided. Refresh to see the latest version." };

    const existingSlugs = await tx.select({ slug: physicalCategories.slug }).from(physicalCategories);
    const slug = generateUniqueCategorySlug(label, new Set(existingSlugs.map((r) => r.slug)));
    const [category] = await tx.insert(physicalCategories).values({ slug, label, description }).returning({ id: physicalCategories.id, slug: physicalCategories.slug });

    await tx
      .update(taxonomySuggestions)
      .set({ status: "approved", resolvedCategoryId: category.id, reviewedAt: new Date(), reviewedBy: ADMIN_ACTOR })
      .where(eq(taxonomySuggestions.id, suggestionId));

    await tx.insert(auditLog).values({
      actorLabel: ADMIN_ACTOR,
      action: "taxonomy_suggestion_approved",
      entityType: "taxonomy_suggestion",
      entityId: suggestionId,
      detail: { suggestedName: suggestion.suggestedName, resultingCategoryId: category.id, resultingSlug: category.slug },
    });

    return { ok: true, categoryId: category.id, categorySlug: category.slug };
  });
}

export async function rejectTaxonomySuggestion(db: Database, suggestionId: string, note?: string): Promise<TaxonomyDecisionResult> {
  return decideTaxonomySuggestion(db, suggestionId, "rejected", "taxonomy_suggestion_rejected", note);
}

export async function postponeTaxonomySuggestion(db: Database, suggestionId: string, note?: string): Promise<TaxonomyDecisionResult> {
  return decideTaxonomySuggestion(db, suggestionId, "postponed", "taxonomy_suggestion_postponed", note);
}

/** MERGE WITH EXISTING (§26) — the suggested concept doesn't warrant a new
 * category; the admin instead points it at an existing one. Records the chosen
 * category on the suggestion itself. Never moves any existing book's category
 * assignment — merging a SUGGESTION into an existing category is a taxonomy
 * decision about the concept, not a request to re-shelve anything. */
export async function mergeTaxonomySuggestionIntoCategory(db: Database, suggestionId: string, existingCategoryId: string, note?: string): Promise<TaxonomyDecisionResult> {
  if (!isValidId(suggestionId)) return { ok: false, error: "not_found", message: "This suggestion could not be found." };
  if (!isValidId(existingCategoryId)) return { ok: false, error: "invalid_target", message: "That category could not be found." };

  return db.transaction(async (tx) => {
    const [suggestion] = await tx.select().from(taxonomySuggestions).where(eq(taxonomySuggestions.id, suggestionId)).limit(1);
    if (!suggestion) return { ok: false, error: "not_found", message: "This suggestion could not be found." };
    if (suggestion.status !== "pending") return { ok: false, error: "already_decided", message: "This suggestion was already decided. Refresh to see the latest version." };

    const [category] = await tx.select({ id: physicalCategories.id, slug: physicalCategories.slug }).from(physicalCategories).where(eq(physicalCategories.id, existingCategoryId)).limit(1);
    if (!category) return { ok: false, error: "invalid_target", message: "That category could not be found." };

    await tx
      .update(taxonomySuggestions)
      .set({ status: "merged", resolvedCategoryId: category.id, decisionNote: note, reviewedAt: new Date(), reviewedBy: ADMIN_ACTOR })
      .where(eq(taxonomySuggestions.id, suggestionId));

    await tx.insert(auditLog).values({
      actorLabel: ADMIN_ACTOR,
      action: "taxonomy_suggestion_merged",
      entityType: "taxonomy_suggestion",
      entityId: suggestionId,
      detail: { suggestedName: suggestion.suggestedName, mergedIntoCategoryId: category.id, mergedIntoSlug: category.slug },
    });

    return { ok: true, categoryId: category.id, categorySlug: category.slug };
  });
}

async function decideTaxonomySuggestion(
  db: Database,
  suggestionId: string,
  status: "rejected" | "postponed",
  auditAction: string,
  note?: string
): Promise<TaxonomyDecisionResult> {
  if (!isValidId(suggestionId)) return { ok: false, error: "not_found", message: "This suggestion could not be found." };

  const updated = await db
    .update(taxonomySuggestions)
    .set({ status, decisionNote: note, reviewedAt: new Date(), reviewedBy: ADMIN_ACTOR })
    .where(and(eq(taxonomySuggestions.id, suggestionId), eq(taxonomySuggestions.status, "pending")))
    .returning({ id: taxonomySuggestions.id, suggestedName: taxonomySuggestions.suggestedName });
  if (updated.length === 0) return { ok: false, error: "already_decided", message: "This suggestion was already decided. Refresh to see the latest version." };

  await db.insert(auditLog).values({ actorLabel: ADMIN_ACTOR, action: auditAction, entityType: "taxonomy_suggestion", entityId: suggestionId, detail: { suggestedName: updated[0].suggestedName, note: note ?? null } });
  return { ok: true };
}
