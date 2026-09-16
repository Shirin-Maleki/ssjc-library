// Deliberately no `import "server-only"` here — that guard lives on `src/db/client.ts`
// alone, the one place the real app constructs a live connection. `server-only`'s
// resolution only recognizes Next.js's own server-build condition, so it throws
// unconditionally under Vitest; keeping it off repository classes (which only ever
// receive an already-constructed `Database` via constructor injection, real or test)
// is what keeps `tests/integration/db/*.test.ts` able to import and exercise them
// directly. A "use client" file can still never reach a live connection through this
// class, since the only way to get one is importing `client.ts`, which still throws.
import { eq, inArray } from "drizzle-orm";
import type { Database } from "../client";
import {
  bookContributors,
  bookCopies,
  books,
  bookTags,
  contributors,
  physicalCategories,
  publishers,
  tags,
} from "../schema";
import type { Book, FictionType, Format, IllustrationStyle, LanguageCode, VisualRealism } from "@/lib/catalog/types";

/**
 * The catalog data-access boundary (Phase 4 brief §29) — the only thing Find, Book
 * Detail, autocomplete, and facets know about. Nothing above this layer sees a
 * Drizzle row shape or writes SQL; everything is projected into the exact same `Book`
 * domain shape `src/lib/search/**` already expects, so **no search/ranking code
 * changes for Phase 4** (docs/DECISIONS.md, "Find a Book: an interim
 * Postgres → Book[] → existing searchBooks() pipeline").
 *
 * At this catalog size (development data, dozens of rows), fetching the full catalog
 * and letting the existing deterministic `searchBooks()` filter/rank it in
 * application code is the Phase 4 brief's explicitly accepted interim architecture —
 * pushing filtering/ranking into SQL is Phase 5's job, not this one.
 */
export interface BookRepository {
  listBooks(): Promise<Book[]>;
  getBookById(id: string): Promise<Book | undefined>;
}

/** Deterministic per-book placeholder-cover variant, replacing the fixture-only
 * `cover.variant` field that has no home in the real schema (it's a Phase 2 UI
 * placeholder concern, not bibliographic data — see docs/DECISIONS.md). Hashing the
 * book's real UUID keeps `BookCover`'s existing four-composition cycle stable across
 * requests without storing anything. */
function coverVariantFromId(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return hash % 4;
}

const FICTION_STATUS_FALLBACK: FictionType = "nonfiction";
const FORMAT_FALLBACK: Format = "other";
const VISUAL_REALISM_FALLBACK: VisualRealism = "mixed";

type BookRow = typeof books.$inferSelect;

export class DrizzleBookRepository implements BookRepository {
  constructor(private readonly db: Database) {}

  async listBooks(): Promise<Book[]> {
    const rows = await this.db.select().from(books);
    return this.projectMany(rows);
  }

  async getBookById(id: string): Promise<Book | undefined> {
    const rows = await this.db.select().from(books).where(eq(books.id, id)).limit(1);
    if (rows.length === 0) return undefined;
    const [projected] = await this.projectMany(rows);
    return projected;
  }

  /** Batch-loads every relation for a set of book rows (contributors, tags,
   * languages, copy counts, publisher/category names) in a handful of queries total,
   * not one per book — the N+1 query this avoids matters even at this catalog size. */
  private async projectMany(rows: BookRow[]): Promise<Book[]> {
    if (rows.length === 0) return [];
    const bookIds = rows.map((row) => row.id);
    const publisherIds = [...new Set(rows.map((row) => row.publisherId).filter((id): id is string => id != null))];
    const categoryIds = [...new Set(rows.map((row) => row.physicalCategoryId).filter((id): id is string => id != null))];

    const [contributorRows, tagRows, copyRows, publisherRows, categoryRows] = await Promise.all([
      this.db
        .select({
          bookId: bookContributors.bookId,
          role: bookContributors.role,
          sortOrder: bookContributors.sortOrder,
          name: contributors.name,
        })
        .from(bookContributors)
        .innerJoin(contributors, eq(contributors.id, bookContributors.contributorId))
        .where(inArray(bookContributors.bookId, bookIds)),
      this.db
        .select({ bookId: bookTags.bookId, name: tags.name })
        .from(bookTags)
        .innerJoin(tags, eq(tags.id, bookTags.tagId))
        .where(inArray(bookTags.bookId, bookIds)),
      this.db
        .select({ bookId: bookCopies.bookId })
        .from(bookCopies)
        .where(inArray(bookCopies.bookId, bookIds)),
      publisherIds.length > 0
        ? this.db.select().from(publishers).where(inArray(publishers.id, publisherIds))
        : Promise.resolve([]),
      categoryIds.length > 0
        ? this.db.select().from(physicalCategories).where(inArray(physicalCategories.id, categoryIds))
        : Promise.resolve([]),
    ]);

    const publisherNameById = new Map(publisherRows.map((row) => [row.id, row.name]));
    const categorySlugById = new Map(categoryRows.map((row) => [row.id, row.slug]));

    const authorsByBook = new Map<string, string[]>();
    const illustratorsByBook = new Map<string, string[]>();
    for (const row of contributorRows.sort((a, b) => a.sortOrder - b.sortOrder)) {
      const target = row.role === "illustrator" ? illustratorsByBook : row.role === "author" ? authorsByBook : null;
      if (!target) continue;
      const list = target.get(row.bookId) ?? [];
      list.push(row.name);
      target.set(row.bookId, list);
    }

    const tagsByBook = new Map<string, string[]>();
    for (const row of tagRows) {
      const list = tagsByBook.get(row.bookId) ?? [];
      list.push(row.name);
      tagsByBook.set(row.bookId, list);
    }

    const copyCountByBook = new Map<string, number>();
    for (const row of copyRows) {
      copyCountByBook.set(row.bookId, (copyCountByBook.get(row.bookId) ?? 0) + 1);
    }

    return rows.map((row) => this.projectOne(row, {
      authors: authorsByBook.get(row.id) ?? [],
      illustrators: illustratorsByBook.get(row.id),
      tags: tagsByBook.get(row.id) ?? [],
      copyCount: copyCountByBook.get(row.id) ?? 0,
      publisherName: row.publisherId ? publisherNameById.get(row.publisherId) : undefined,
      categorySlug: row.physicalCategoryId ? categorySlugById.get(row.physicalCategoryId) : undefined,
    }));
  }

  private projectOne(
    row: BookRow,
    related: {
      authors: string[];
      illustrators: string[] | undefined;
      tags: string[];
      copyCount: number;
      publisherName: string | undefined;
      categorySlug: string | undefined;
    }
  ): Book {
    return {
      id: row.id,
      title: row.title,
      subtitle: row.subtitle ?? undefined,
      sortTitle: row.sortTitle,
      authors: related.authors,
      illustrators: related.illustrators && related.illustrators.length > 0 ? related.illustrators : undefined,
      publisher: related.publisherName ?? "",
      imprint: row.imprint ?? undefined,
      languageCode: row.languageCode as LanguageCode,
      description: row.shortDescription ?? "",
      ageMinMonths: row.ageMinMonths ?? undefined,
      ageMaxMonths: row.ageMaxMonths ?? undefined,
      // `unknown_mixed` has no equivalent in the teacher-facing UI yet — no Phase 4
      // seed data produces it; see docs/DECISIONS.md for why this narrow gap is an
      // accepted, documented limitation rather than a new UI concept invented here.
      fictionType: row.fictionStatus === "unknown_mixed" ? FICTION_STATUS_FALLBACK : row.fictionStatus,
      format: row.format ?? FORMAT_FALLBACK,
      physicalCategory: related.categorySlug ?? "",
      tags: related.tags,
      illustrationStyles: (row.visualMediaType ?? []) as IllustrationStyle[],
      visualRealism: (row.visualRealism ?? VISUAL_REALISM_FALLBACK) as VisualRealism,
      readAloudMinutes: row.readAloudMinutesEstimate ? Number(row.readAloudMinutesEstimate) : 0,
      cover: { variant: coverVariantFromId(row.id) },
      publicationYear: row.publicationYear ?? undefined,
      copyCount: related.copyCount,
    };
  }
}
