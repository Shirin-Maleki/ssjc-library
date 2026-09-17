import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { books, physicalCategories } from "@/db/schema";
import { DrizzleSearchRepository } from "@/db/repositories/searchRepository";
import { DrizzleBookRepository } from "@/db/repositories/bookRepository";
import { DrizzleCategoryRepository } from "@/db/repositories/categoryRepository";
import { EMPTY_FILTERS } from "@/lib/search/filters";
import { requireTestDatabaseUrl, createTestDb } from "./testDb";

// `SearchService` is `import "server-only"` — real production code only ever loads
// it inside a Next.js server request, where Next's own build remaps the guard to a
// no-op. Stubbed here purely so this standalone Vitest process can exercise it, the
// same pattern already used by `tests/evaluation/searchEvaluation.eval.ts`.
vi.mock("server-only", () => ({}));
const { SearchService } = await import("@/lib/search/searchService");

const hasTestDb = (() => {
  try {
    requireTestDatabaseUrl();
    return true;
  } catch {
    return false;
  }
})();

const SYNTHETIC_CATEGORY_SLUG = "bounded-pagination-scale-test";
const SYNTHETIC_BOOK_COUNT = 300;

/**
 * Proves the Phase 5 correction pass's queryless-browse fix at a scale the normal
 * 48-book seed can never expose: 300 synthetic active books sharing one category,
 * substantially more than any single retrieval-strategy candidate limit elsewhere
 * in this codebase — a real, meaningful "substantially more rows than the normal
 * seed" scale (docs/SEARCH.md §7). Requesting a 5-result filtered page must never
 * fetch/project more than 6 rows (`limit + 1`, the `hasMore` sentinel), regardless
 * of how many of the 300 actually match.
 */
describe.skipIf(!hasTestDb)("Bounded queryless-browse pagination at scale", () => {
  const { db, client } = hasTestDb ? createTestDb() : ({} as ReturnType<typeof createTestDb>);
  const searchRepository = hasTestDb ? new DrizzleSearchRepository(db) : (undefined as unknown as DrizzleSearchRepository);
  const bookRepository = hasTestDb ? new DrizzleBookRepository(db) : (undefined as unknown as DrizzleBookRepository);

  beforeAll(async () => {
    if (!hasTestDb) return;
    await db
      .insert(physicalCategories)
      .values({ slug: SYNTHETIC_CATEGORY_SLUG, label: "Bounded Pagination Scale Test" })
      .onConflictDoNothing();
    const [category] = await db
      .select({ id: physicalCategories.id })
      .from(physicalCategories)
      .where(eq(physicalCategories.slug, SYNTHETIC_CATEGORY_SLUG));

    const rows = Array.from({ length: SYNTHETIC_BOOK_COUNT }, (_, i) => {
      // Zero-padded so sort_title order is predictable and stable across runs.
      const title = `Scale Test Book ${String(i).padStart(4, "0")}`;
      return {
        title,
        normalizedTitle: title.toLowerCase(),
        sortTitle: title,
        shortDescription: "A synthetic book inserted purely to test bounded pagination at scale.",
        languageCode: "en" as const,
        fictionStatus: "fiction" as const,
        physicalCategoryId: category.id,
        reviewStatus: "active" as const,
      };
    });
    await db.insert(books).values(rows);
  });

  afterAll(async () => {
    if (!hasTestDb) return;
    const [category] = await db
      .select({ id: physicalCategories.id })
      .from(physicalCategories)
      .where(eq(physicalCategories.slug, SYNTHETIC_CATEGORY_SLUG));
    if (category) {
      await db.delete(books).where(eq(books.physicalCategoryId, category.id));
      await db.delete(physicalCategories).where(eq(physicalCategories.id, category.id));
    }
    await client.end();
  });

  it("findVisibleBookIdsPage never returns more than limit+1 rows, however many books actually match", async () => {
    const { ids, hasMore } = await searchRepository.findVisibleBookIdsPage({
      filters: { categories: [SYNTHETIC_CATEGORY_SLUG] },
      limit: 5,
    });
    expect(ids.length).toBe(5);
    expect(hasMore).toBe(true);
  });

  it("findVisibleBookIdsPage returns sort_title order, so the same page is always deterministic", async () => {
    const { ids } = await searchRepository.findVisibleBookIdsPage({
      filters: { categories: [SYNTHETIC_CATEGORY_SLUG] },
      limit: 3,
    });
    const projected = await bookRepository.getBooksByIds(ids);
    const titlesById = new Map(projected.map((b) => [b.id, b.title]));
    expect(ids.map((id) => titlesById.get(id))).toEqual([
      "Scale Test Book 0000",
      "Scale Test Book 0001",
      "Scale Test Book 0002",
    ]);
  });

  it("countVisibleBooks returns the real, exact total — not a capped candidate-pool size", async () => {
    const total = await searchRepository.countVisibleBooks({ categories: [SYNTHETIC_CATEGORY_SLUG] });
    expect(total).toBe(SYNTHETIC_BOOK_COUNT);
  });

  it("hasMore is false once the requested limit reaches the real total", async () => {
    const { ids, hasMore } = await searchRepository.findVisibleBookIdsPage({
      filters: { categories: [SYNTHETIC_CATEGORY_SLUG] },
      limit: SYNTHETIC_BOOK_COUNT,
    });
    expect(ids.length).toBe(SYNTHETIC_BOOK_COUNT);
    expect(hasMore).toBe(false);
  });

  it("SearchService.search() for a queryless filtered browse projects only the bounded page, never the full 300-book match set", async () => {
    const categoryRepository = new DrizzleCategoryRepository(db);
    const categories = await categoryRepository.listCategories();

    const projectSpy = vi.spyOn(bookRepository, "getBooksByIds");
    const service = new SearchService(searchRepository, bookRepository, categories);

    const page = await service.search({ query: "", filters: { ...EMPTY_FILTERS, categories: [SYNTHETIC_CATEGORY_SLUG] }, limit: 5 });

    expect(page.results.length).toBe(5);
    expect(page.totalQualifying).toBe(SYNTHETIC_BOOK_COUNT);
    expect(page.hasMore).toBe(true);

    // The actual proof: getBooksByIds — the only place full relational projection
    // happens — was called with exactly the 5 bounded ids, never all 300 matches.
    expect(projectSpy).toHaveBeenCalledTimes(1);
    expect(projectSpy.mock.calls[0][0]).toHaveLength(5);

    projectSpy.mockRestore();
  });

  it("Show More (a larger limit) still only projects the newly bounded set, not the full match set", async () => {
    const categoryRepository = new DrizzleCategoryRepository(db);
    const categories = await categoryRepository.listCategories();
    const projectSpy = vi.spyOn(bookRepository, "getBooksByIds");
    const service = new SearchService(searchRepository, bookRepository, categories);

    const page = await service.search({ query: "", filters: { ...EMPTY_FILTERS, categories: [SYNTHETIC_CATEGORY_SLUG] }, limit: 15 });

    expect(page.results.length).toBe(15);
    expect(page.totalQualifying).toBe(SYNTHETIC_BOOK_COUNT);
    expect(page.hasMore).toBe(true);
    expect(projectSpy.mock.calls[0][0]).toHaveLength(15);

    projectSpy.mockRestore();
  });
});
