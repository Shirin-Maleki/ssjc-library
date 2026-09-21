import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { books } from "@/db/schema";
import { DrizzleBookRepository } from "@/db/repositories/bookRepository";
import { requireTestDatabaseUrl, createTestDb } from "./testDb";

const hasTestDb = (() => {
  try {
    requireTestDatabaseUrl();
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!hasTestDb)("DrizzleBookRepository (against a real, seeded Postgres database)", () => {
  const { db, client } = hasTestDb ? createTestDb() : ({} as ReturnType<typeof createTestDb>);
  const repository = hasTestDb ? new DrizzleBookRepository(db) : (undefined as unknown as DrizzleBookRepository);

  afterAll(async () => {
    if (hasTestDb) await client.end();
  });

  it("lists every seeded development book", async () => {
    // 48 real fixtures plus the 3 deliberate non-active/incomplete-metadata rows
    // `src/db/seed.ts` also inserts (Phase 5 correction pass) — `listBooks()` is the
    // Book Detail/Reading-Lists boundary and must keep resolving every book
    // regardless of review status; visibility scoping only applies to teacher
    // search (`TEACHER_VISIBLE_REVIEW_STATUS`, `src/db/repositories/searchRepository.ts`).
    const all = await repository.listBooks();
    expect(all.length).toBe(51);
  });

  it("projects a book's full teacher-relevant shape", async () => {
    const all = await repository.listBooks();
    const caterpillar = all.find((b) => b.title === "The Very Hungry Caterpillar");
    expect(caterpillar).toBeDefined();
    expect(caterpillar!.authors).toEqual(["Eric Carle"]);
    expect(caterpillar!.illustrators).toEqual(["Eric Carle"]);
    expect(caterpillar!.publisher).toBe("Philomel Books");
    expect(caterpillar!.physicalCategory).toBe("animals-nature");
    expect(caterpillar!.tags).toEqual(expect.arrayContaining(["caterpillars", "insects", "life cycle"]));
    expect(caterpillar!.illustrationStyles.sort()).toEqual(["collage", "painted"].sort());
    expect(caterpillar!.visualRealism).toBe("stylized_illustration");
  });

  it("preserves multi-author-role contributor ordering", async () => {
    const all = await repository.listBooks();
    const gruffalo = all.find((b) => b.title === "The Gruffalo");
    expect(gruffalo!.authors).toEqual(["Julia Donaldson"]);
    expect(gruffalo!.illustrators).toEqual(["Axel Scheffler"]);
  });

  it("derives copy count from real book_copies rows — a two-copy book returns 2", async () => {
    const all = await repository.listBooks();
    const caterpillar = all.find((b) => b.title === "The Very Hungry Caterpillar");
    const singleCopy = all.find((b) => b.title === "Brown Bear, Brown Bear, What Do You See?");
    expect(caterpillar!.copyCount).toBe(2);
    expect(singleCopy!.copyCount).toBe(1);
  });

  it("projects the deliberate multilingual seed example's additional languages itself — not merely visible via a raw book_languages query (Phase 4 correction pass)", async () => {
    // The whole point of this test is that DrizzleBookRepository's own projection
    // carries additionalLanguageCodes — a raw query against book_languages would
    // prove the row exists in the database but nothing about whether the repository
    // that Find/Book Detail actually use surfaces it.
    const all = await repository.listBooks();
    const guessHowMuch = all.find((b) => b.title === "Guess How Much I Love You")!;
    // Primary language is untouched by the multilingual projection.
    expect(guessHowMuch.languageCode).toBe("en");
    // Both additional languages seeded for this book — "sv" (one of the original six
    // fixture languages) and "de" (deliberately not one of them, proving the
    // centralized ISO 639-1 registry governs real records, not a hard-coded list).
    expect(guessHowMuch.additionalLanguageCodes?.sort()).toEqual(["de", "sv"]);
  });

  it("a single-language book's additionalLanguageCodes is undefined, not an empty array with a stray row", async () => {
    const all = await repository.listBooks();
    const caterpillar = all.find((b) => b.title === "The Very Hungry Caterpillar");
    expect(caterpillar!.additionalLanguageCodes).toBeUndefined();
  });

  it("getBookById fetches a single book by its real UUID", async () => {
    const all = await repository.listBooks();
    const first = all[0];
    const fetched = await repository.getBookById(first.id);
    expect(fetched?.title).toBe(first.title);
  });

  it("getBookById returns undefined for a missing UUID, not an error", async () => {
    const fetched = await repository.getBookById("00000000-0000-0000-0000-000000000000");
    expect(fetched).toBeUndefined();
  });

  it("a book with an unknown age (both bounds null) projects safely, not as a crash", async () => {
    const [row] = await db
      .insert(books)
      .values({
        title: "Unreviewed Import With No Age",
        normalizedTitle: "unreviewed import with no age",
        sortTitle: "Unreviewed Import With No Age",
        languageCode: "en",
      })
      .returning();
    const projected = await repository.getBookById(row.id);
    expect(projected?.ageMinMonths).toBeUndefined();
    expect(projected?.ageMaxMonths).toBeUndefined();
    await db.delete(books).where(eq(books.id, row.id));
  });

  it("projects a real display_cover_url when the row has one (Phase 7 correction pass §2)", async () => {
    const [row] = await db
      .insert(books)
      .values({
        title: "Book With A Real Display Cover",
        normalizedTitle: "book with a real display cover",
        sortTitle: "Book With A Real Display Cover",
        languageCode: "en",
        displayCoverUrl: "https://covers.openlibrary.org/b/id/999-M.jpg",
        displayCoverSource: "external_provider_thumbnail",
      })
      .returning();
    const projected = await repository.getBookById(row.id);
    expect(projected?.cover.displayUrl).toBe("https://covers.openlibrary.org/b/id/999-M.jpg");
    await db.delete(books).where(eq(books.id, row.id));
  });

  it("leaves cover.displayUrl undefined (never a placeholder string) for a book with no display cover", async () => {
    const all = await repository.listBooks();
    const gruffalo = all.find((b) => b.title === "The Gruffalo");
    expect(gruffalo!.cover.displayUrl).toBeUndefined();
  });
});
