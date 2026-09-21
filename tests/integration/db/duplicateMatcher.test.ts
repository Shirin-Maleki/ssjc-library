import { describe, expect, it, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { books } from "@/db/schema/books";
import { findDuplicateCandidates } from "@/lib/intake/duplicateMatcher";
import { requireTestDatabaseUrl, createTestDb } from "./testDb";
import { normalizeTitle } from "@/lib/search/normalize";
import { computeSortTitle } from "@/lib/catalog/sortTitle";

/**
 * Real-database duplicate-detection coverage (Phase 7, §17 of the phase brief)
 * against the actual seeded catalog (`src/db/seed.ts`'s Phase 2 fixtures) — "The
 * Gruffalo" (Julia Donaldson, English, ISBN 9780333710937) is real seeded data used
 * here as a known, stable duplicate-matching target, not a book this test creates
 * or mutates. Real trigram similarity scores below were measured directly against
 * this database (`similarity('A Gruffalo Story', 'The Gruffalo')`), not assumed.
 */
const hasTestDb = (() => {
  try {
    requireTestDatabaseUrl();
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!hasTestDb)("findDuplicateCandidates (against a real Postgres database)", () => {
  const { db, client } = hasTestDb ? createTestDb() : ({} as ReturnType<typeof createTestDb>);

  afterAll(async () => {
    if (hasTestDb) await client.end();
  });

  it("finds an exact ISBN match as exact_copy_same_edition, detected by isbn_match", async () => {
    const result = await findDuplicateCandidates(db, { title: "Some Other Title Entirely", isbn13: "9780333710937" });
    expect(result.outcome).toBe("exact_copy_same_edition");
    expect(result.candidates[0].detectedBy).toBe("isbn_match");
    expect(result.candidates[0].book.title).toBe("The Gruffalo");
  });

  it("finds an exact title+author+language match as exact_copy_same_edition without an ISBN", async () => {
    const result = await findDuplicateCandidates(db, { title: "The Gruffalo", authors: ["Julia Donaldson"], languageCode: "en" });
    expect(result.outcome).toBe("exact_copy_same_edition");
    expect(result.candidates[0].detectedBy).toBe("title_author_match");
  });

  it("classifies a same title+author but different language as same_work_different_language", async () => {
    const result = await findDuplicateCandidates(db, { title: "The Gruffalo", authors: ["Julia Donaldson"], languageCode: "sv" });
    expect(result.outcome).toBe("same_work_different_language");
  });

  it("classifies a same title with no author overlap as same_title_different_edition", async () => {
    const result = await findDuplicateCandidates(db, { title: "The Gruffalo", authors: ["A Completely Different Author"] });
    expect(result.outcome).toBe("same_title_different_edition");
  });

  it("classifies a merely similar (not same) title as ambiguous_similar_title, never automatically merged", async () => {
    const result = await findDuplicateCandidates(db, { title: "A Gruffalo Story", authors: ["Julia Donaldson"] });
    expect(result.outcome).toBe("ambiguous_similar_title");
  });

  it("returns no_match for a genuinely unrelated title, never a fabricated candidate", async () => {
    const result = await findDuplicateCandidates(db, { title: "Zzyxqplorp The Interdimensional Toaster Repair Manual" });
    expect(result.outcome).toBe("no_match");
    expect(result.candidates).toEqual([]);
  });

  it("never returns a candidate for a book that is archived, even on an exact ISBN match", async () => {
    const archivedTitle = "Zqxlwv Archived Test Fixture Book";
    const archivedIsbn13 = "9999999999999";
    const [inserted] = await db
      .insert(books)
      .values({
        title: archivedTitle,
        normalizedTitle: normalizeTitle(archivedTitle),
        sortTitle: computeSortTitle(archivedTitle),
        languageCode: "en",
        isbn13: archivedIsbn13,
        reviewStatus: "archived",
      })
      .returning({ id: books.id });

    try {
      const result = await findDuplicateCandidates(db, { title: archivedTitle, isbn13: archivedIsbn13 });
      expect(result.outcome).toBe("no_match");
      expect(result.candidates).toEqual([]);
    } finally {
      await db.delete(books).where(eq(books.id, inserted.id));
    }
  });
});
