import { afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { books } from "@/db/schema";
import { createTestDb, requireTestDatabaseUrl } from "./testDb";

const hasTestDb = (() => {
  try {
    requireTestDatabaseUrl();
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!hasTestDb)("Migration / schema (against a real Postgres database)", () => {
  const { db, client } = hasTestDb ? createTestDb() : ({} as ReturnType<typeof createTestDb>);

  afterAll(async () => {
    if (hasTestDb) await client.end();
  });

  it("the approved 24-table schema exists (Phase 9 addendum added library_locations)", async () => {
    const rows = await db.execute<{ count: string }>(
      sql`select count(*)::text as count from information_schema.tables where table_schema = 'public'`
    );
    expect(Number(rows[0].count)).toBe(24);
  });

  it("rejects an age_min greater than age_max (check constraint)", async () => {
    await expect(
      db.insert(books).values({
        title: "Invalid Age Book",
        normalizedTitle: "invalid age book",
        sortTitle: "Invalid Age Book",
        languageCode: "en",
        ageMinMonths: 60,
        ageMaxMonths: 24,
      })
    ).rejects.toThrow();
  });

  it("rejects a negative age_min_months (check constraint)", async () => {
    await expect(
      db.insert(books).values({
        title: "Negative Age Book",
        normalizedTitle: "negative age book",
        sortTitle: "Negative Age Book",
        languageCode: "en",
        ageMinMonths: -1,
      })
    ).rejects.toThrow();
  });

  it("rejects an age_max_months beyond the 216-month upper bound (check constraint)", async () => {
    await expect(
      db.insert(books).values({
        title: "Too Old Book",
        normalizedTitle: "too old book",
        sortTitle: "Too Old Book",
        languageCode: "en",
        ageMaxMonths: 300,
      })
    ).rejects.toThrow();
  });

  it("allows a legitimately incomplete record — no age, no publisher, no category", async () => {
    const [row] = await db
      .insert(books)
      .values({
        title: "Totally Unreviewed Import",
        normalizedTitle: "totally unreviewed import",
        sortTitle: "Totally Unreviewed Import",
        languageCode: "en",
      })
      .returning();
    expect(row.ageMinMonths).toBeNull();
    expect(row.ageMaxMonths).toBeNull();
    expect(row.publisherId).toBeNull();
    expect(row.physicalCategoryId).toBeNull();
    await db.delete(books).where(sql`${books.id} = ${row.id}`);
  });

  it("enforces the partial unique index on isbn_13 (only when present)", async () => {
    const isbn = "978-0-00-000000-0";
    const [first] = await db
      .insert(books)
      .values({ title: "ISBN A", normalizedTitle: "isbn a", sortTitle: "ISBN A", languageCode: "en", isbn13: isbn })
      .returning();

    await expect(
      db.insert(books).values({ title: "ISBN B", normalizedTitle: "isbn b", sortTitle: "ISBN B", languageCode: "en", isbn13: isbn })
    ).rejects.toThrow();

    // Multiple records with NO isbn13 must NOT collide with each other on NULL.
    await db.insert(books).values({ title: "No ISBN A", normalizedTitle: "no isbn a", sortTitle: "No ISBN A", languageCode: "en" });
    await db.insert(books).values({ title: "No ISBN B", normalizedTitle: "no isbn b", sortTitle: "No ISBN B", languageCode: "en" });

    await db.delete(books).where(sql`${books.title} in ('ISBN A', 'No ISBN A', 'No ISBN B')`);
    await db.delete(books).where(sql`${books.id} = ${first.id}`);
  });

  it("enforces foreign keys — a book_copies row cannot reference a nonexistent book", async () => {
    const { bookCopies } = await import("@/db/schema");
    await expect(db.insert(bookCopies).values({ bookId: "00000000-0000-0000-0000-000000000000" })).rejects.toThrow();
  });
});
