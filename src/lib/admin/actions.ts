"use server";

import { db } from "@/db/client";
import { requireAdminSession } from "@/lib/auth/guards";
import type { TeacherEdits } from "@/lib/intake/draft";
import type { DuplicateResolutionAction } from "./duplicateResolution";
import type { AdminMetadataPatch } from "./adminPatch";
import type { MetadataFieldKey } from "@/lib/metadata/fieldRegistry";
import { loadAdminReviewQueue } from "./reviewQueueSource";
import { loadAdminReviewDetail, type AdminReviewDetail } from "./reviewDetail";
import {
  approveReviewLater,
  archiveBook,
  approveTaxonomySuggestion,
  createCategory,
  mergeTaxonomySuggestionIntoCategory,
  postponeTaxonomySuggestion,
  rejectTaxonomySuggestion,
  resolveDuplicate,
  resolveReviewFlag,
  setCategoryActive,
  updateBookMetadata,
  updateCategory,
  type ApproveReviewLaterResult,
  type ArchiveBookResult,
  type CreateCategoryResult,
  type DismissReviewFlagResult,
  type ResolveDuplicateResult,
  type SetCategoryActiveResult,
  type TaxonomyDecisionResult,
  type UpdateBookMetadataResult,
  type UpdateCategoryResult,
} from "./persistence";
import type { AdminReviewItem } from "./reviewQueue";
import { categoryRepository, locationRepository, type LibraryLocationOption } from "@/db/repositories";
import { listCategoriesWithHealth, listTaxonomySuggestionsWithBooks, type CategoryHealthRow, type TaxonomySuggestionRow } from "./categoryHealth";
import {
  createLocation,
  updateLocation,
  setLocationActive,
  listLocationsWithUsage,
  type CreateLocationResult,
  type UpdateLocationResult,
  type SetLocationActiveResult,
  type LocationType,
} from "@/lib/locations/persistence";

/**
 * The Phase 8 admin Server Action boundary — mirrors `src/lib/intake/actions.ts`'s
 * own convention exactly: thin functions that validate/authorize, then delegate
 * to `persistence.ts`. Every single export here calls `requireAdminSession()`
 * FIRST, independently of whether the caller went through a protected page — an
 * admin Server Action is directly invokable on its own (§4).
 */

export async function listAdminReviewItemsAction(): Promise<AdminReviewItem[]> {
  await requireAdminSession();
  return loadAdminReviewQueue(db);
}

export async function getAdminReviewDetailAction(key: string): Promise<AdminReviewDetail | undefined> {
  await requireAdminSession();
  return loadAdminReviewDetail(db, key);
}

export interface ApproveReviewLaterActionInput {
  ingestionItemId: string;
  edits: TeacherEdits;
  categorySlug: string;
}

export async function approveReviewLaterAction(input: ApproveReviewLaterActionInput): Promise<ApproveReviewLaterResult> {
  await requireAdminSession();
  return approveReviewLater(db, input);
}

export interface ResolveDuplicateActionInput {
  ingestionItemId: string;
  action: DuplicateResolutionAction;
  existingBookId?: string;
  note?: string;
}

export async function resolveDuplicateAction(input: ResolveDuplicateActionInput): Promise<ResolveDuplicateResult> {
  await requireAdminSession();
  return resolveDuplicate(db, input);
}

export interface UpdateBookMetadataActionInput {
  bookId: string;
  patch: AdminMetadataPatch;
  explicitlyVerifiedFields?: MetadataFieldKey[];
  expectedUpdatedAt?: string;
}

export async function updateBookMetadataAction(input: UpdateBookMetadataActionInput): Promise<UpdateBookMetadataResult> {
  await requireAdminSession();
  return updateBookMetadata(db, {
    bookId: input.bookId,
    patch: input.patch,
    explicitlyVerifiedFields: input.explicitlyVerifiedFields,
    expectedUpdatedAt: input.expectedUpdatedAt ? new Date(input.expectedUpdatedAt) : undefined,
  });
}

export async function archiveBookAction(bookId: string, note?: string): Promise<ArchiveBookResult> {
  await requireAdminSession();
  return archiveBook(db, bookId, note);
}

export async function resolveReviewFlagAction(flagId: string, outcome: "resolved" | "dismissed", note?: string): Promise<DismissReviewFlagResult> {
  await requireAdminSession();
  return resolveReviewFlag(db, flagId, outcome, note);
}

// --- Category management -----------------------------------------------------

export async function listCategoriesWithHealthAction(): Promise<CategoryHealthRow[]> {
  await requireAdminSession();
  return listCategoriesWithHealth(db);
}

export interface CreateCategoryActionInput {
  label: string;
  description?: string;
  displayOrder?: number;
}

export async function createCategoryAction(input: CreateCategoryActionInput): Promise<CreateCategoryResult> {
  await requireAdminSession();
  return createCategory(db, input);
}

export interface UpdateCategoryActionInput {
  categoryId: string;
  label?: string;
  description?: string | null;
  displayOrder?: number;
}

export async function updateCategoryAction(input: UpdateCategoryActionInput): Promise<UpdateCategoryResult> {
  await requireAdminSession();
  return updateCategory(db, input);
}

export async function setCategoryActiveAction(categoryId: string, isActive: boolean): Promise<SetCategoryActiveResult> {
  await requireAdminSession();
  return setCategoryActive(db, categoryId, isActive);
}

// --- Taxonomy suggestions -----------------------------------------------------

export async function listTaxonomySuggestionsAction(): Promise<TaxonomySuggestionRow[]> {
  await requireAdminSession();
  return listTaxonomySuggestionsWithBooks(db);
}

export async function approveTaxonomySuggestionAction(suggestionId: string, confirmedLabel: string, description?: string): Promise<TaxonomyDecisionResult> {
  await requireAdminSession();
  return approveTaxonomySuggestion(db, suggestionId, confirmedLabel, description);
}

export async function rejectTaxonomySuggestionAction(suggestionId: string, note?: string): Promise<TaxonomyDecisionResult> {
  await requireAdminSession();
  return rejectTaxonomySuggestion(db, suggestionId, note);
}

export async function postponeTaxonomySuggestionAction(suggestionId: string, note?: string): Promise<TaxonomyDecisionResult> {
  await requireAdminSession();
  return postponeTaxonomySuggestion(db, suggestionId, note);
}

export async function mergeTaxonomySuggestionAction(suggestionId: string, existingCategoryId: string, note?: string): Promise<TaxonomyDecisionResult> {
  await requireAdminSession();
  return mergeTaxonomySuggestionIntoCategory(db, suggestionId, existingCategoryId, note);
}

export async function listActiveCategoriesForAdminAction() {
  await requireAdminSession();
  return categoryRepository.listActiveCategories();
}

// --- Location management (Phase 9 addendum §8) --------------------------------

export async function listLocationsWithUsageAction() {
  await requireAdminSession();
  return listLocationsWithUsage(db);
}

export interface CreateLocationActionInput {
  displayName: string;
  locationType?: LocationType;
}

export async function createLocationAction(input: CreateLocationActionInput): Promise<CreateLocationResult> {
  await requireAdminSession();
  return createLocation(db, input);
}

export interface UpdateLocationActionInput {
  locationId: string;
  displayName?: string;
  locationType?: LocationType;
}

export async function updateLocationAction(input: UpdateLocationActionInput): Promise<UpdateLocationResult> {
  await requireAdminSession();
  return updateLocation(db, input);
}

export async function setLocationActiveAction(locationId: string, isActive: boolean): Promise<SetLocationActiveResult> {
  await requireAdminSession();
  return setLocationActive(db, locationId, isActive);
}

export async function listActiveLocationsForAdminAction(): Promise<LibraryLocationOption[]> {
  await requireAdminSession();
  return locationRepository.listActiveLocations();
}
