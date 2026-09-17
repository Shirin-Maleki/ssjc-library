import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { rebuildSearchText } from "@/lib/search/searchTextMaintenance";
import { buildEmbeddingDocument } from "@/lib/embeddings/document";
import { DrizzleBookRepository } from "@/db/repositories/bookRepository";
import { requireTestDatabaseUrl } from "./testDb";

const hasTestDb = (() => {
  try {
    requireTestDatabaseUrl();
    return true;
  } catch {
    return false;
  }
})();

/** Migration 0000's own `folderMillis` (`drizzle/meta/_journal.json`, entry idx 0's
 * "when") — inserting a tracking row with this exact `created_at` value makes
 * drizzle's migrator treat migration 0000 as already applied and everything after
 * it (0001, 0002 — the actual Phase 5 migrations) as pending, without needing a
 * second, stripped-down copy of the migrations folder. See `pg-core/dialect.js`'s
 * `migrate()`: it only ever compares `created_at` against each migration's own
 * folder timestamp, never re-validates the hash of an already-applied migration. */
const MIGRATION_0000_FOLDER_MILLIS = 1789527467955;

/**
 * Proves the exact scenario the Phase 5 correction pass exists to fix: applying the
 * Phase 5 migrations to an already-populated Phase 4 database (never a from-zero
 * migrate-then-seed database) must not leave existing books with a NULL
 * `search_text` / empty `search_vector`. See docs/SEARCH.md §3 and
 * docs/DECISIONS.md.
 */
describe.skipIf(!hasTestDb)("Migration upgrade: populated Phase 4 database -> Phase 5", () => {
  const dbName = "ssjc_migration_upgrade_test";
  // Guarded the same way every other integration test file guards its own use of
  // `requireTestDatabaseUrl()` — `describe.skipIf` still evaluates this callback
  // body to register (skipped) tests even when there's no test database, so this
  // must never throw at definition time.
  const baseUrl = hasTestDb ? new URL(requireTestDatabaseUrl()) : new URL("postgres://placeholder/placeholder");
  const adminUrl = new URL(baseUrl.toString());
  adminUrl.pathname = "/postgres";
  const targetUrl = new URL(baseUrl.toString());
  targetUrl.pathname = `/${dbName}`;

  let db: ReturnType<typeof drizzle<typeof schema>>;
  let client: ReturnType<typeof postgres>;
  let bookId: string;
  let categoryId: string;
  let publisherId: string;
  let authorId: string;
  let illustratorId: string;

  beforeAll(async () => {
    if (!hasTestDb) return;

    const admin = postgres(adminUrl.toString(), { max: 1 });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName}`);
    await admin.unsafe(`CREATE DATABASE ${dbName}`);
    await admin.end();

    client = postgres(targetUrl.toString(), { max: 1 });
    db = drizzle(client, { schema });

    // 1. Bring the fresh database to exactly the Phase 4 (migration 0000) schema
    // state by running its raw SQL directly — not through drizzle's migrator, since
    // we want fine control over which migrations are "already applied" below.
    const migration0000 = await import("node:fs/promises").then((fs) =>
      fs.readFile("drizzle/0000_left_nocturne.sql", "utf-8")
    );
    for (const statement of migration0000.split("--> statement-breakpoint")) {
      const trimmed = statement.trim();
      if (trimmed) await client.unsafe(trimmed);
    }

    // Record that migration 0000 is already applied (see this file's own comment on
    // MIGRATION_0000_FOLDER_MILLIS) — this is what makes the real `migrate()` call
    // below apply only 0001/0002, exactly reproducing "upgrading an existing Phase 4
    // database," not a from-zero migration.
    await client.unsafe(`CREATE SCHEMA IF NOT EXISTS drizzle`);
    await client.unsafe(
      `CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)`
    );
    await client.unsafe(
      `INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('phase-4-baseline', ${MIGRATION_0000_FOLDER_MILLIS})`
    );

    // 2. Insert REAL, representative Phase 4 relational book data — exactly the
    // shape a live Phase 4 database would already contain, with no search_text/
    // embedding columns to write to yet (they don't exist at this schema version).
    const [category] = await client`
      insert into physical_categories (slug, label) values ('animals-nature', 'Animals & Nature') returning id
    `;
    categoryId = category.id;
    const [publisher] = await client`
      insert into publishers (name, normalized_name) values ('Philomel Books', 'philomel books') returning id
    `;
    publisherId = publisher.id;
    const [author] = await client`
      insert into contributors (name, normalized_name) values ('Eric Carle', 'eric carle') returning id
    `;
    authorId = author.id;
    illustratorId = authorId; // Eric Carle is both, matching the real fixture.

    const [book] = await client`
      insert into books (
        title, subtitle, normalized_title, sort_title, short_description, language_code,
        fiction_status, age_min_months, age_max_months, format, physical_category_id,
        publisher_id, review_status, verified_at
      ) values (
        'The Very Hungry Caterpillar', null, 'very hungry caterpillar', 'Very Hungry Caterpillar',
        'A very hungry caterpillar eats its way through a week of food before becoming a butterfly.',
        'en', 'fiction', 24, 60, 'picture_book', ${categoryId}, ${publisherId}, 'active', now()
      ) returning id
    `;
    bookId = book.id;

    await client`insert into book_contributors (book_id, contributor_id, role, sort_order) values (${bookId}, ${authorId}, 'author', 0)`;
    await client`insert into book_contributors (book_id, contributor_id, role, sort_order) values (${bookId}, ${illustratorId}, 'illustrator', 0)`;
    const [tag] = await client`insert into tags (name, normalized_name) values ('caterpillars', 'caterpillars') returning id`;
    await client`insert into book_tags (book_id, tag_id) values (${bookId}, ${tag.id})`;
    // A real multilingual example: primary English, additional Spanish — proves the
    // backfilled search_text includes an ADDITIONAL, not just the primary, language.
    await client`insert into book_languages (book_id, language_code) values (${bookId}, 'es')`;
    await client`insert into book_copies (book_id, home_location) values (${bookId}, 'Preschool Library')`;

    // A Reading List referencing this book — proves the upgrade never disturbs
    // existing Reading List data.
    const [list] = await client`
      insert into reading_lists (name, created_by) values ('Migration Upgrade Test List', 'Test Teacher') returning id
    `;
    await client`insert into reading_list_items (list_id, book_id) values (${list.id}, ${bookId})`;
  });

  afterAll(async () => {
    if (!hasTestDb) return;
    await client.end();
    const admin = postgres(adminUrl.toString(), { max: 1 });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName}`);
    await admin.end();
  });

  it("applying the Phase 5 migrations (0001, 0002) to this populated Phase 4 database succeeds without reseeding or destroying data", async () => {
    await migrate(db, { migrationsFolder: "./drizzle" });

    const [row] = await client`select id, title from books where id = ${bookId}`;
    expect(row.id).toBe(bookId);
    expect(row.title).toBe("The Very Hungry Caterpillar");
  });

  it("immediately after migrating (before any backfill), the existing book's search_text is NULL and search_vector matches nothing — reproducing the exact bug this pass fixes", async () => {
    const [row] = await client`select search_text, search_vector from books where id = ${bookId}`;
    expect(row.search_text).toBeNull();
    // search_vector is GENERATED ALWAYS AS to_tsvector('english', coalesce(search_text, ''))
    // — a NULL search_text produces an EMPTY tsvector (postgres represents this as
    // '', not a SQL NULL), which correctly matches no full-text query at all.
    const [match] = await client`
      select id from books where id = ${bookId} and search_vector @@ to_tsquery('english', 'caterpillar')
    `;
    expect(match).toBeUndefined();
  });

  it("running the migration-upgrade backfill (mode: missing) populates search_text for the existing book, using the same relational data buildSearchIndexText composes elsewhere", async () => {
    const result = await rebuildSearchText(db, { mode: "missing" });
    expect(result.updated).toBeGreaterThanOrEqual(1);

    const [row] = await client`select search_text from books where id = ${bookId}`;
    expect(row.search_text).not.toBeNull();
    expect(row.search_text).toContain("The Very Hungry Caterpillar");
    expect(row.search_text).toContain("Eric Carle");
    expect(row.search_text).toContain("Philomel Books");
    expect(row.search_text).toContain("Animals & Nature");
    expect(row.search_text).toContain("caterpillars");
    expect(row.search_text).toContain("Spanish"); // the additional language, not just English
    expect(row.search_text).toContain("becoming a butterfly");
  });

  it("the generated search_vector now supports real full-text retrieval across title, tag, category, contributor, description, and the additional language", async () => {
    const queries = ["caterpillar", "carle", "philomel", "animals", "butterfly", "spanish"];
    for (const query of queries) {
      const [row] = await client`
        select id from books
        where id = ${bookId} and search_vector @@ to_tsquery('english', array_to_string(tsvector_to_array(to_tsvector('english', ${query})), ' | '))
      `;
      expect(row, `expected "${query}" to full-text match the backfilled book`).toBeDefined();
    }
  });

  it("running the backfill again is a no-op (idempotent) — nothing left to update", async () => {
    const result = await rebuildSearchText(db, { mode: "missing" });
    expect(result.considered).toBe(0);
  });

  it("existing book id, copy count, and the Reading List reference all survive the upgrade unchanged", async () => {
    const [copyCount] = await client`select count(*)::int from book_copies where book_id = ${bookId}`;
    expect(copyCount.count).toBe(1);

    const [listItem] = await client`
      select rli.book_id, rl.name from reading_list_items rli
      inner join reading_lists rl on rl.id = rli.list_id
      where rli.book_id = ${bookId}
    `;
    expect(listItem.book_id).toBe(bookId);
    expect(listItem.name).toBe("Migration Upgrade Test List");
  });

  it("rebuilding search text after a metadata change updates conventional search AND makes an existing embedding detectably stale via source-hash mismatch", async () => {
    // Simulate a pre-existing embedding, computed from the book's data BEFORE the
    // edit below — exactly what a real embeddings:generate run would have stored.
    const bookRepository = new DrizzleBookRepository(db);
    const before = await bookRepository.getBookById(bookId);
    const beforeDocument = buildEmbeddingDocument({
      title: before!.title,
      description: before!.description,
      authors: before!.authors,
      illustrators: before!.illustrators,
      publisher: before!.publisher,
      categoryLabel: "Animals & Nature",
      tags: before!.tags,
      languageCode: before!.languageCode,
      additionalLanguageCodes: before!.additionalLanguageCodes,
      fictionType: before!.fictionType,
      illustrationStyles: before!.illustrationStyles,
    });
    await client`
      update books set embedding_source_hash = ${beforeDocument.sourceHash}, embedding_composition_version = ${beforeDocument.version}
      where id = ${bookId}
    `;

    // A real metadata edit — the kind of change that must be reflected in
    // conventional search and must invalidate the stored embedding.
    const newDescription = "A tiny, always-hungry caterpillar nibbles through a whole week of food before its transformation.";
    await client`update books set short_description = ${newDescription} where id = ${bookId}`;

    const result = await rebuildSearchText(db, { mode: "all", bookIds: [bookId] });
    expect(result.updated).toBe(1);

    const [row] = await client`select search_text, embedding_source_hash, embedding_composition_version from books where id = ${bookId}`;
    expect(row.search_text).toContain("transformation");
    expect(row.search_text).not.toContain("becoming a butterfly");

    // The staleness check embeddings:generate --mode=stale performs: recompute
    // today's document hash for the book's CURRENT data and compare against what's
    // stored. It must now disagree, proving the edit is detectable.
    const after = await bookRepository.getBookById(bookId);
    const afterDocument = buildEmbeddingDocument({
      title: after!.title,
      description: after!.description,
      authors: after!.authors,
      illustrators: after!.illustrators,
      publisher: after!.publisher,
      categoryLabel: "Animals & Nature",
      tags: after!.tags,
      languageCode: after!.languageCode,
      additionalLanguageCodes: after!.additionalLanguageCodes,
      fictionType: after!.fictionType,
      illustrationStyles: after!.illustrationStyles,
    });
    expect(afterDocument.sourceHash).not.toBe(row.embedding_source_hash);
  });
});
