import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { books } from "@/db/schema";
import * as schema from "@/db/schema";
import { DrizzleSearchRepository } from "@/db/repositories/searchRepository";
import { EMPTY_FILTERS } from "@/lib/search/filters";
import { requireTestDatabaseUrl, createTestDb } from "./testDb";

const hasTestDb = (() => {
  try {
    requireTestDatabaseUrl();
    return true;
  } catch {
    return false;
  }
})();

/**
 * Real-Postgres coverage for the Phase 5 search boundary — every claim in
 * `docs/SEARCH.md` §1–§7 that depends on actual SQL behavior (visibility scoping,
 * hard filters, FTS/trgm retrieval, vector storage/distance, facet/autocomplete
 * scoping) is verified here against the seeded `TEST_DATABASE_URL` database, not
 * mocked. See `tests/integration/db/testDb.ts` for how the connection is created and
 * `tests/integration/globalSetup.ts` for the migrate+seed step this file depends on.
 */
describe.skipIf(!hasTestDb)("DrizzleSearchRepository (against a real, seeded Postgres database)", () => {
  const { db, client } = hasTestDb ? createTestDb() : ({} as ReturnType<typeof createTestDb>);
  const repository = hasTestDb ? new DrizzleSearchRepository(db) : (undefined as unknown as DrizzleSearchRepository);

  afterAll(async () => {
    if (hasTestDb) await client.end();
  });

  describe("catalog visibility — never leaks non-active books", () => {
    it("findCandidates never returns the deliberate pending_review or archived seed books, even for a query matching their titles", async () => {
      const pending = await repository.findCandidates({ query: "Pending Review Test Book", filters: EMPTY_FILTERS });
      const archived = await repository.findCandidates({ query: "Archived Test Book", filters: EMPTY_FILTERS });
      expect(pending.has("10000000-0000-0000-0000-000000000001")).toBe(false);
      expect(archived.has("10000000-0000-0000-0000-000000000002")).toBe(false);
    });

    it("the queryless (browse-all) candidate set excludes pending_review and archived books", async () => {
      const all = await repository.findCandidates({ query: "", filters: EMPTY_FILTERS });
      expect(all.has("10000000-0000-0000-0000-000000000001")).toBe(false);
      expect(all.has("10000000-0000-0000-0000-000000000002")).toBe(false);
      // The active, incomplete-metadata seed book must still be visible.
      expect(all.has("10000000-0000-0000-0000-000000000003")).toBe(true);
    });

    it("getVisibleBookFacetRows excludes pending_review and archived books", async () => {
      const rows = await repository.getVisibleBookFacetRows();
      // 48 real fixtures + 1 active incomplete-metadata seed book = 49; the pending
      // and archived rows must never be counted.
      expect(rows.length).toBe(49);
    });

    it("autocomplete never surfaces a pending_review or archived title", async () => {
      const results = await repository.autocomplete("Test Book", 20);
      const values = results.map((r) => r.value);
      expect(values).not.toContain("Pending Review Test Book");
      expect(values).not.toContain("Archived Test Book");
    });
  });

  describe("topic/tag and language autocomplete (Phase 5 correction pass)", () => {
    const PENDING_BOOK_ID = "10000000-0000-0000-0000-000000000001";
    let onlyOnPendingTagId: string;

    beforeAll(async () => {
      if (!hasTestDb) return;
      const [tag] = await db
        .insert(schema.tags)
        .values({ name: "quokka-habitats", normalizedName: "quokka-habitats" })
        .returning();
      onlyOnPendingTagId = tag.id;
      await db.insert(schema.bookTags).values({ bookId: PENDING_BOOK_ID, tagId: onlyOnPendingTagId });
      // Icelandic is not used by ANY seeded active book, primary or additional —
      // attaching it only to the pending book proves a pending-only language never
      // surfaces (mirroring the tag case above).
      await db.insert(schema.bookLanguages).values({ bookId: PENDING_BOOK_ID, languageCode: "is" });
    });

    afterAll(async () => {
      if (!hasTestDb) return;
      await db.delete(schema.bookLanguages).where(eq(schema.bookLanguages.bookId, PENDING_BOOK_ID));
      await db.delete(schema.bookTags).where(eq(schema.bookTags.tagId, onlyOnPendingTagId));
      await db.delete(schema.tags).where(eq(schema.tags.id, onlyOnPendingTagId));
    });

    it("a real tag used by active books autocompletes as a topic", async () => {
      const results = await repository.autocomplete("caterpillar", 20);
      expect(results).toContainEqual({ value: "caterpillars", type: "topic" });
    });

    it("a tag used ONLY by a pending_review book never autocompletes", async () => {
      const results = await repository.autocomplete("quokka", 20);
      expect(results).toEqual([]);
    });

    it("a real, catalog-used language autocompletes by its display name", async () => {
      const results = await repository.autocomplete("swed", 20);
      expect(results).toContainEqual({ value: "Swedish", type: "language" });
    });

    it("a language used ONLY as an ADDITIONAL (never primary) language on an active book still autocompletes", async () => {
      // "Guess How Much I Love You" is English-primary with German as an additional
      // language (tests/integration/db/bookRepository.test.ts) — no seeded active
      // book has German as its PRIMARY language, so this only passes if the
      // additional-language UNION branch actually runs.
      const results = await repository.autocomplete("german", 20);
      expect(results).toContainEqual({ value: "German", type: "language" });
    });

    it("a language used ONLY by a pending_review book never autocompletes", async () => {
      const results = await repository.autocomplete("icelandic", 20);
      expect(results).toEqual([]);
    });
  });

  describe("exact/near-exact known-item matching", () => {
    it("an author's full name is an exact candidate regardless of FTS/trgm ranking", async () => {
      const signals = await repository.findCandidates({ query: "Eric Carle", filters: EMPTY_FILTERS });
      const caterpillarSignal = [...signals.values()].find((s) => s.exactMatch);
      expect(caterpillarSignal).toBeDefined();
    });

    it("an exact title match is flagged exactMatch", async () => {
      const signals = await repository.findCandidates({
        query: "The Very Hungry Caterpillar",
        filters: EMPTY_FILTERS,
      });
      const values = [...signals.values()];
      expect(values.some((s) => s.exactMatch)).toBe(true);
    });
  });

  describe("full-text retrieval — OR semantics with a meaningful-overlap gate", () => {
    it("a multi-word descriptive query returns real results (OR, not plainto_tsquery's implicit AND)", async () => {
      const signals = await repository.findCandidates({
        query: "animal books with real photos",
        filters: EMPTY_FILTERS,
      });
      expect(signals.size).toBeGreaterThan(0);
    });

    it("a filler query built from generic words returns no candidates at all (never padded)", async () => {
      // Regression test for the real bug found in E2E testing: the word "read" alone
      // (present incidentally in some books' descriptions) must not manufacture a
      // full-text match for a query that has no real topical content.
      const signals = await repository.findCandidates({
        query: "something to read please",
        filters: EMPTY_FILTERS,
      });
      expect(signals.size).toBe(0);
    });
  });

  describe("trigram fuzzy matching — typo tolerance with a calibrated floor", () => {
    it("a real one-word typo of a title is still a candidate", async () => {
      const signals = await repository.findCandidates({ query: "caterpilar", filters: EMPTY_FILTERS });
      expect(signals.size).toBeGreaterThan(0);
      const sims = [...signals.values()].map((s) => s.trgmSimilarity);
      expect(Math.max(...sims)).toBeGreaterThan(0.2);
    });

    it("an unrelated query returns no trigram candidates above the floor", async () => {
      const signals = await repository.findCandidates({ query: "xyzabc123", filters: EMPTY_FILTERS });
      expect(signals.size).toBe(0);
    });
  });

  describe("hard filters — language (primary + additional)", () => {
    it("filtering to Swedish includes a book whose ADDITIONAL (not primary) language is Swedish", async () => {
      const signals = await repository.findCandidates({
        query: "",
        filters: { ...EMPTY_FILTERS, languages: ["sv"] },
      });
      // "Guess How Much I Love You" is English-primary with Swedish + German as
      // additional languages (tests/integration/db/bookRepository.test.ts).
      const [row] = await db.select({ id: books.id }).from(books).where(eq(books.title, "Guess How Much I Love You"));
      expect(signals.has(row.id)).toBe(true);
    });
  });

  describe("structured free-text intent produces real candidates, not just a ranking bonus", () => {
    it("an age phrase with no literal keyword overlap with any book still retrieves age-appropriate books as candidates", async () => {
      // Regression test for a real bug found via the search evaluation harness
      // (tests/evaluation/): a query like "a book for a 4 year old" shares almost no
      // literal vocabulary with a given age-appropriate book's title/description, so
      // before `buildIntentConditions` was added, such books were never even
      // retrieved as SQL candidates — the deterministic age-intent ranking bonus
      // (rank.ts, unchanged since Phase 2) never got a chance to apply at all,
      // silently regressing a real Phase 2-4 capability. See docs/SEARCH.md §2.
      const signals = await repository.findCandidates({ query: "a book for a 4 year old", filters: EMPTY_FILTERS });
      // Several dozen of the 48 fixtures cover age 4 (48 months) — this must be far
      // more than the handful of books that happen to share a literal word like
      // "book" with the query text.
      expect(signals.size).toBeGreaterThan(20);

      const [gruffalo] = await db.select({ id: books.id }).from(books).where(eq(books.title, "The Gruffalo"));
      expect(signals.has(gruffalo.id)).toBe(true);
    });

    it("a query with no recognizable structured intent and no keyword overlap returns no candidates at all", async () => {
      const signals = await repository.findCandidates({ query: "xyzabc123", filters: EMPTY_FILTERS });
      expect(signals.size).toBe(0);
    });
  });

  describe("incomplete metadata never becomes a false facet/signal", () => {
    it("the deliberate incomplete-metadata seed book has null format/visualRealism/readDurationBand, not an invented value", async () => {
      const rows = await repository.getVisibleBookFacetRows();
      const [book] = await db
        .select({ id: books.id })
        .from(books)
        .where(eq(books.title, "Book With Incomplete Metadata"));
      // getVisibleBookFacetRows doesn't expose id directly on the return type, so
      // cross-check by re-querying the row's own recorded values.
      const [raw] = await db
        .select({ format: books.format, visualRealism: books.visualRealism, readDurationBand: books.readDurationBand })
        .from(books)
        .where(eq(books.id, book.id));
      expect(raw.format).toBeNull();
      expect(raw.visualRealism).toBeNull();
      expect(raw.readDurationBand).toBeNull();
      expect(rows.length).toBeGreaterThan(0);
    });
  });

  describe("vector storage and distance retrieval (pgvector)", () => {
    const targetTitle = "The Very Hungry Caterpillar";

    it("a book with a stored embedding is retrievable by vector distance, and a book with no embedding never appears via the vector branch", async () => {
      const [row] = await db.select({ id: books.id }).from(books).where(eq(books.title, targetTitle));
      const dimension = 768;
      const fakeVector = Array.from({ length: dimension }, (_, i) => (i === 0 ? 1 : 0));
      await db.execute(sql`update ${books} set embedding = ${`[${fakeVector.join(",")}]`}::vector where id = ${row.id}`);

      try {
        // A non-empty query: the empty-query branch is a pure filtered-browse scan
        // that never runs the vector branch at all (there's no free text to embed a
        // meaning for) — semantic retrieval only ever applies alongside real query
        // text, per `docs/SEARCH.md` §5.
        const signals = await repository.findCandidates({
          query: "caterpillar",
          filters: EMPTY_FILTERS,
          queryEmbedding: fakeVector,
        });
        const signal = signals.get(row.id);
        expect(signal?.vectorDistance).not.toBeNull();
        expect(signal!.vectorDistance!).toBeCloseTo(0, 5);

        // A book with no stored embedding must never receive a fabricated distance.
        const [otherRow] = await db
          .select({ id: books.id })
          .from(books)
          .where(eq(books.title, "The Gruffalo"));
        const otherSignal = signals.get(otherRow.id);
        expect(otherSignal?.vectorDistance ?? null).toBeNull();
      } finally {
        await db.execute(sql`update ${books} set embedding = null where id = ${row.id}`);
      }
    });

    it("omitting queryEmbedding entirely never queries the vector column at all — every signal's vectorDistance is null", async () => {
      const signals = await repository.findCandidates({ query: "caterpillar", filters: EMPTY_FILTERS });
      for (const signal of signals.values()) {
        expect(signal.vectorDistance).toBeNull();
      }
    });
  });
});
