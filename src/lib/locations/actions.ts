"use server";

import { db } from "@/db/client";
import { requireStaffSession } from "@/lib/auth/guards";
import { isUuid } from "@/lib/utils/uuid";
import { prepareAnalysisImage, resolveRotationHint } from "@/lib/intake/imagePrep";
import { classifyVisionFailure } from "@/lib/intake/visionFailureClassification";
import { isE2EFakeProvidersEnabled, buildFakeCoverEvidence } from "@/lib/intake/e2eFixtures";
import type { AnalysisRotationDegrees } from "@/lib/intake/draft";
import { getConfiguredBookIntelligenceProvider } from "@/lib/ai";
import { createSearchService, locationRepository, type LibraryLocationOption } from "@/db/repositories";
import { EMPTY_FILTERS } from "@/lib/search/filters";
import { getCopyLocationSummary, moveCopy, type CopyLocationCount } from "./persistence";

/**
 * The Move/Return workflow's Server Action boundary (Phase 9 addendum §3) —
 * mirrors `src/lib/intake/actions.ts`'s own convention exactly: every export
 * independently calls `requireStaffSession()` first, thin functions that
 * validate/authorize then delegate to a domain module.
 *
 * Deliberately NOT the Add Book pipeline (§4 of the addendum): no metadata-
 * provider reconciliation, no duplicate analysis, no category/enrichment
 * suggestion, no embedding generation. The book already exists — this module
 * only ever reads the catalog and, once a teacher explicitly confirms both
 * the book and the destination, mutates exactly one `book_copies` row.
 */

interface ActionFailure {
  ok: false;
  category: string;
  message: string;
}

function failure(category: string, message: string): ActionFailure {
  return { ok: false, category, message };
}

const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);
const MAX_PHOTO_BYTES = 25 * 1024 * 1024;
const MAX_MATCH_CANDIDATES = 5;

export interface MoveMatchCandidate {
  bookId: string;
  title: string;
  authors: string[];
  displayCoverUrl: string | null;
}

export type IdentifyBookForMoveResult = ActionFailure | { ok: true; candidates: MoveMatchCandidate[]; capturedTitle: string | null };

/**
 * Step 1 (§3/§4): extracts only enough visible identity evidence from a photo
 * to search the existing catalog for it, via the exact same `analyzeCover`
 * vision call and `SearchService` hybrid search Find itself uses — never a
 * second, parallel matching implementation. The photo's bytes are never
 * uploaded to Drive, written to disk, or persisted anywhere; they exist only
 * in memory for this one request (§4: "does not need to become a permanent
 * Drive source image... avoid an ever-growing archive of checkout/return
 * photos"). No `ingestion_item`, no `books` row, no embedding — of any kind —
 * is ever created by this action.
 */
export async function identifyBookForMoveAction(formData: FormData): Promise<IdentifyBookForMoveResult> {
  await requireStaffSession();

  const file = formData.get("photo");
  if (!(file instanceof File)) return failure("invalid_input", "No photo was provided.");
  if (!ALLOWED_MIME_TYPES.has(file.type)) return failure("invalid_input", "That file type isn't supported.");
  if (file.size === 0 || file.size > MAX_PHOTO_BYTES) return failure("invalid_input", "That photo couldn't be used.");

  const rotationRaw = formData.get("rotationDegrees");
  const rotationDegrees: AnalysisRotationDegrees = rotationRaw === "90" || rotationRaw === "180" || rotationRaw === "270" ? (Number(rotationRaw) as 90 | 180 | 270) : 0;

  let visibleTitle: string | null;
  let visibleAuthors: string[] | null;

  if (isE2EFakeProvidersEnabled()) {
    // Same filename-keyed fixture seam Add Book's E2E coverage already uses
    // (`e2eFixtures.ts`) — a filename containing "gruffalo" matches the real
    // seeded "The Gruffalo" book exactly, letting this workflow's E2E test
    // exercise a real match against the real seeded catalog with zero live
    // Gemini calls.
    const evidence = buildFakeCoverEvidence(file.name);
    visibleTitle = evidence.visibleTitle;
    visibleAuthors = evidence.visibleAuthors;
  } else {
    const aiProvider = getConfiguredBookIntelligenceProvider();
    if (!aiProvider) return failure("configuration_missing", "Book identification isn't configured.");

    const bytes = Buffer.from(await file.arrayBuffer());
    const analysisImage = await prepareAnalysisImage(bytes, file.type, rotationDegrees);
    const rotationHint = resolveRotationHint(analysisImage, rotationDegrees);

    try {
      // `activeCategories: []` — this call's own enrichment/category-
      // suggestion half of the response is never read below; only
      // `coverEvidence` (the strict visible-evidence extraction) is used.
      const analysis = await aiProvider.analyzeCover({ imageBytes: analysisImage.bytes, mimeType: analysisImage.mimeType, teacherRotationHintDegrees: rotationHint, activeCategories: [] });
      visibleTitle = analysis.coverEvidence.visibleTitle;
      visibleAuthors = analysis.coverEvidence.visibleAuthors;
    } catch (error) {
      const classified = classifyVisionFailure(error);
      return failure(classified.category, classified.message);
    }
  }

  if (!visibleTitle?.trim()) {
    // Never guess — an unreadable/blank cover simply yields no candidates,
    // never a fabricated match (§3: "Never silently move a book based only on
    // AI confidence").
    return { ok: true, candidates: [], capturedTitle: null };
  }

  const query = [visibleTitle, ...(visibleAuthors ?? [])].join(" ");
  const searchService = await createSearchService();
  const page = await searchService.search({ query, filters: EMPTY_FILTERS, limit: MAX_MATCH_CANDIDATES });

  return {
    ok: true,
    capturedTitle: visibleTitle,
    candidates: page.results.map(({ book }) => ({ bookId: book.id, title: book.title, authors: book.authors, displayCoverUrl: book.cover.displayUrl ?? null })),
  };
}

export async function listActiveLocationsAction(): Promise<LibraryLocationOption[]> {
  await requireStaffSession();
  return locationRepository.listActiveLocations();
}

export async function getCopyLocationSummaryAction(bookId: string): Promise<CopyLocationCount[]> {
  await requireStaffSession();
  if (!isUuid(bookId)) return [];
  return getCopyLocationSummary(db, bookId);
}

export interface MoveCopyActionInput {
  bookId: string;
  fromLocationId: string | null;
  toLocationId: string;
}

export type MoveCopyActionResult = ActionFailure | { ok: true; fromLabel: string; toLabel: string };

/** Step 2 — the one real mutation this whole workflow ever performs, and only
 * after a teacher has explicitly confirmed both the book and the destination
 * (§3: "Never silently move a book"). */
export async function moveCopyAction(input: MoveCopyActionInput): Promise<MoveCopyActionResult> {
  await requireStaffSession();
  if (!isUuid(input.bookId) || !isUuid(input.toLocationId)) return failure("invalid_input", "That selection isn't valid.");
  if (input.fromLocationId !== null && !isUuid(input.fromLocationId)) return failure("invalid_input", "That selection isn't valid.");

  const result = await moveCopy(db, { bookId: input.bookId, fromLocationId: input.fromLocationId, toLocationId: input.toLocationId, actorLabel: "teacher" });
  if (!result.ok) return failure(result.error, result.message);
  return { ok: true, fromLabel: result.fromLabel, toLabel: result.toLabel };
}
