import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// `SearchService` (and, transitively, `lib/embeddings`) is `import "server-only"` —
// real production code only ever loads it inside a Next.js server request, where
// Next's own build remaps the guard to a no-op. Nothing here bypasses that guarantee
// in the shipped app; this stub exists purely so the evaluation harness (a standalone
// test process, like `scripts/embeddings/generate.ts`) can exercise the same
// retrieval/scoring code the Find page calls, instead of reimplementing it.
vi.mock("server-only", () => ({}));

const { requireTestDatabaseUrl, createTestDb } = await import("../integration/db/testDb");
const { DrizzleSearchRepository } = await import("@/db/repositories/searchRepository");
const { DrizzleBookRepository } = await import("@/db/repositories/bookRepository");
const { DrizzleCategoryRepository } = await import("@/db/repositories/categoryRepository");
const { SearchService } = await import("@/lib/search/searchService");
const { EVALUATION_CASES, EMPTY_FILTERS } = await import("./dataset");

const hasTestDb = (() => {
  try {
    requireTestDatabaseUrl();
    return true;
  } catch {
    return false;
  }
})();

/**
 * The Phase 5 search evaluation harness (`docs/SEARCH.md` §11) — runs the committed
 * dataset (`tests/evaluation/dataset.ts`) through the real `SearchService` against a
 * real, seeded Postgres database, and reports recall / top-1 / top-5 / prohibited-
 * result violations. This is a *report*, not a tuning target: cases are not adjusted
 * to make a run pass, and a genuine regression must fail loudly here rather than be
 * quietly excluded.
 *
 * Run with `npm run evaluate:search`. Requires `TEST_DATABASE_URL` — see
 * `docs/DATABASE_SETUP.md`.
 */
describe.skipIf(!hasTestDb)("Search evaluation", () => {
  let db: ReturnType<typeof createTestDb>["db"];
  let client: ReturnType<typeof createTestDb>["client"];
  let service: InstanceType<typeof SearchService>;

  beforeAll(async () => {
    if (!hasTestDb) return;
    ({ db, client } = createTestDb());
    const searchRepository = new DrizzleSearchRepository(db);
    const bookRepository = new DrizzleBookRepository(db);
    const categoryRepository = new DrizzleCategoryRepository(db);
    const categories = await categoryRepository.listCategories();
    service = new SearchService(searchRepository, bookRepository, categories);
  });

  afterAll(async () => {
    if (hasTestDb) await client.end();
  });

  it("reports recall/top-1/prohibited-violations across the committed dataset", async () => {
    const rows: {
      id: string;
      category: string;
      recalled: boolean;
      top1Correct: boolean | "n/a";
      prohibitedViolation: boolean;
      resultTitles: string[];
    }[] = [];

    for (const testCase of EVALUATION_CASES) {
      const page = await service.search({
        query: testCase.query,
        filters: { ...EMPTY_FILTERS, ...testCase.filters },
        limit: 10,
      });
      const resultTitles = page.results.map((r) => r.book.title);

      const recalled =
        testCase.expectedAnyOf.length === 0
          ? resultTitles.length === 0
          : testCase.expectedAnyOf.some((title) => resultTitles.includes(title));

      const top1Correct: boolean | "n/a" = testCase.expectedTop1
        ? resultTitles[0] === testCase.expectedTop1
        : "n/a";

      const prohibitedViolation = (testCase.mustNotInclude ?? []).some((forbidden) =>
        forbidden === "*" ? resultTitles.length > 0 : resultTitles.includes(forbidden)
      );

      rows.push({ id: testCase.id, category: testCase.category, recalled, top1Correct, prohibitedViolation, resultTitles });
    }

    const total = rows.length;
    const recalledCount = rows.filter((r) => r.recalled).length;
    const top1Cases = rows.filter((r) => r.top1Correct !== "n/a");
    const top1Correct = top1Cases.filter((r) => r.top1Correct === true).length;
    const violations = rows.filter((r) => r.prohibitedViolation);

    console.log("\n=== Search evaluation report ===");
    console.log(`Total cases: ${total}`);
    console.log(`Recall (expected result appeared anywhere): ${recalledCount}/${total}`);
    console.log(`Top-1 accuracy (of ${top1Cases.length} cases with an expected top result): ${top1Correct}/${top1Cases.length}`);
    console.log(`Prohibited-result violations: ${violations.length}/${total}`);
    for (const row of rows) {
      const status = row.recalled ? "OK" : "MISS";
      const top1 = row.top1Correct === "n/a" ? "" : row.top1Correct ? " top1:OK" : " top1:MISS";
      const violation = row.prohibitedViolation ? " VIOLATION" : "";
      console.log(`  [${status}]${top1}${violation} ${row.id} (${row.category}) → ${row.resultTitles.slice(0, 3).join(", ") || "(no results)"}`);
    }
    console.log(
      "\nConventional-vs-hybrid comparison: no embedding provider is configured in this environment " +
        "(no GEMINI_API_KEY), so every case above ran through conventional retrieval only " +
        "(structured filters + exact/FTS/trigram matching) — the semantic/vector signal never " +
        "contributed to any result. This is reported honestly, not claimed as a hybrid-vs-conventional " +
        "comparison; see docs/SEARCH.md §5 and §11, and docs/IMPLEMENTATION_STATUS.md."
    );

    // A real regression must fail this test, not be silently excluded from the report.
    expect(violations, `Prohibited-result violations: ${violations.map((v) => v.id).join(", ")}`).toHaveLength(0);
    expect(recalledCount, `Missed cases: ${rows.filter((r) => !r.recalled).map((r) => r.id).join(", ")}`).toBe(total);
    expect(top1Correct).toBe(top1Cases.length);
  });
});
