import { inArray, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import { books, physicalCategories, taxonomySuggestions } from "@/db/schema";

/**
 * Real, database-measured category management data (Phase 8, §19/§23) — every
 * number here is a live count, never an inferred/estimated "quality score" or
 * AI opinion about whether a category is "too broad."
 */
export interface CategoryHealthRow {
  id: string;
  slug: string;
  label: string;
  description: string | null;
  displayOrder: number;
  isActive: boolean;
  activeBookCount: number;
  pendingReviewBookCount: number;
  /** Mirrors the exact rule `setCategoryActive()` enforces (§20) — surfaced here
   * so the UI can disable the deactivate control and explain why, before the
   * admin even attempts it. */
  canDeactivate: boolean;
}

export async function listCategoriesWithHealth(db: Database): Promise<CategoryHealthRow[]> {
  const categories = await db.select().from(physicalCategories);
  if (categories.length === 0) return [];

  const counts = await db
    .select({ categoryId: books.physicalCategoryId, reviewStatus: books.reviewStatus, count: sql<number>`count(*)::int` })
    .from(books)
    .where(inArray(books.physicalCategoryId, categories.map((c) => c.id)))
    .groupBy(books.physicalCategoryId, books.reviewStatus);

  const activeCountById = new Map<string, number>();
  const pendingCountById = new Map<string, number>();
  for (const row of counts) {
    if (!row.categoryId) continue;
    if (row.reviewStatus === "active") activeCountById.set(row.categoryId, row.count);
    if (row.reviewStatus === "pending_review") pendingCountById.set(row.categoryId, row.count);
  }

  return categories
    .map((category) => {
      const activeBookCount = activeCountById.get(category.id) ?? 0;
      const pendingReviewBookCount = pendingCountById.get(category.id) ?? 0;
      return {
        id: category.id,
        slug: category.slug,
        label: category.label,
        description: category.description,
        displayOrder: category.displayOrder,
        isActive: category.isActive,
        activeBookCount,
        pendingReviewBookCount,
        canDeactivate: activeBookCount + pendingReviewBookCount === 0,
      };
    })
    .sort((a, b) => a.displayOrder - b.displayOrder || a.label.localeCompare(b.label));
}

export interface TaxonomySuggestionRow {
  id: string;
  suggestedName: string;
  reason: string;
  status: "pending" | "approved" | "rejected" | "merged" | "postponed";
  supportingBooks: { id: string; title: string }[];
  decisionNote: string | null;
  resolvedCategoryLabel?: string;
  createdAt: Date;
  reviewedAt: Date | null;
}

/** Real, already-persisted suggestions only — never a live full-catalog AI
 * analysis run on demand (§24/§28: "do not run a real collection-wide taxonomy
 * analysis"). Supporting book titles are resolved for display so the admin never
 * sees a raw book id. */
export async function listTaxonomySuggestionsWithBooks(db: Database): Promise<TaxonomySuggestionRow[]> {
  const suggestions = await db.select().from(taxonomySuggestions);
  if (suggestions.length === 0) return [];

  const allSupportingIds = [...new Set(suggestions.flatMap((s) => s.supportingBookIds))];
  const resolvedCategoryIds = [...new Set(suggestions.map((s) => s.resolvedCategoryId).filter((id): id is string => id != null))];

  const [supportingBookRows, categoryRows] = await Promise.all([
    allSupportingIds.length > 0 ? db.select({ id: books.id, title: books.title }).from(books).where(inArray(books.id, allSupportingIds)) : Promise.resolve([]),
    resolvedCategoryIds.length > 0 ? db.select({ id: physicalCategories.id, label: physicalCategories.label }).from(physicalCategories).where(inArray(physicalCategories.id, resolvedCategoryIds)) : Promise.resolve([]),
  ]);
  const titleById = new Map(supportingBookRows.map((b) => [b.id, b.title]));
  const categoryLabelById = new Map(categoryRows.map((c) => [c.id, c.label]));

  return suggestions
    .map((s) => ({
      id: s.id,
      suggestedName: s.suggestedName,
      reason: s.reason,
      status: s.status,
      supportingBooks: s.supportingBookIds.map((id) => ({ id, title: titleById.get(id) ?? "Untitled" })),
      decisionNote: s.decisionNote,
      resolvedCategoryLabel: s.resolvedCategoryId ? categoryLabelById.get(s.resolvedCategoryId) : undefined,
      createdAt: s.createdAt,
      reviewedAt: s.reviewedAt,
    }))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

