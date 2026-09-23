import "./loadEnv";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import * as schema from "./schema";
import { books as fixtureBooks } from "../lib/catalog/fixtures";
import { PHYSICAL_CATEGORIES } from "../lib/catalog/categories";
import { normalizeTitle } from "../lib/search/normalize";
import { buildSearchIndexText } from "../lib/embeddings/document";
import type { Book, LanguageCode } from "../lib/catalog/types";

/**
 * DEVELOPMENT / DEMO DATA SEED — NOT CONFIRMED SSJC INVENTORY.
 *
 * Converts the Phase 2 fixture catalog (`src/lib/catalog/fixtures.ts`, unchanged and
 * still the single source of truth for the 48 development books) into the real
 * relational schema. Reproducibility strategy (Phase 4 brief §28): deterministic
 * **truncate-then-seed**, not upsert — every run starts every seeded table from empty
 * and reinserts the same data, so re-seeding is always predictable. This is safe
 * specifically because everything this script touches is development/demo data;
 * `npm run db:seed` must never be pointed at a database holding real inventory.
 *
 * Book UUIDs are fixed, hardcoded constants (`BOOK_ID_BY_SLUG` below) — not
 * `gen_random_uuid()` — so they stay identical across every reseed. Reading Lists and
 * anything else that references a book by ID keeps working across resets.
 */

const BOOK_ID_BY_SLUG: Record<string, string> = {
  "very-hungry-caterpillar": "f2cf8755-096f-48fa-be6a-f8fd315bdf6d",
  "brown-bear-brown-bear": "e7c32f6c-a10c-4e23-8f33-8e46ac8baf70",
  "grouchy-ladybug": "eeb1464b-2951-41b6-b40c-a0d1238a6527",
  "the-gruffalo": "855dd94e-5cc1-4eff-8cdd-9faf7a34a221",
  "pippi-longstocking": "b914117a-82ad-4a50-9b90-32ce642d997f",
  "alfie-atkins-wants-to-choose": "2ca5728f-5a52-4b6c-b871-5cdadf149541",
  "pettson-and-findus-rooster": "7e9c18f8-5906-4b36-8b3c-cb271a647e74",
  "goodnight-moon": "7b4d6fbf-1b02-422e-a56c-877140af8c70",
  "dont-let-pigeon-drive-bus": "a4c7983b-d62e-44b9-8900-7f8c4780e9d6",
  "should-i-share-my-ice-cream": "7e3f1111-0acd-415c-af6b-77f7e0888906",
  "spot-goes-to-the-farm": "d3e115ce-7c5d-4d2c-a38e-51722f1484b1",
  "where-the-wild-things-are": "e0b59bd7-c191-4589-891c-dd420de64109",
  "guess-how-much-i-love-you": "7ff32a95-cb30-40c0-b57f-a3e937b2a401",
  "the-rainbow-fish": "fd0db578-1a1b-46e6-9d99-dadb211e7916",
  "julias-house-for-lost-creatures": "3d2a3011-5eb6-4898-bdc4-62bb90a38e12",
  "the-snowy-day": "160f6456-4863-46da-92f1-64365a0b69db",
  "winters-quiet-sleep": "83a6b4fa-aceb-4cf1-93e2-287486f72b85",
  "amazing-animal-babies": "0892a148-827e-4cb9-a368-b159a5396607",
  "ocean-wonders": "e0503fd7-3d96-483c-8ef6-ba5894a478c4",
  "bugs-up-close": "d82611e3-52c5-4ea1-8e71-dda5cede3ef4",
  "dinosaur-bones": "0df9eac1-125b-4c53-9470-801dcd4adfa4",
  "dinosaur-adventure": "7196651e-eea4-44ae-a663-ef00f0797b20",
  "the-littlest-dinosaur": "6166414e-d792-4e88-9d95-b3cf0d326882",
  "my-first-book-of-shapes": "713ad20a-b296-4f21-a0d6-d657d7d0894b",
  "numbers-on-our-street": "56c455a2-b325-4a40-b519-4d2d7979859b",
  "how-plants-grow": "99e7f036-6884-4ed3-b08b-62d3c16be154",
  "machines-that-help-us": "94ac30c3-0db5-4fc5-a4ec-cbbba073e9b3",
  "global-families": "651dabff-29d7-431d-af6e-ed181f25b020",
  "celebrating-together": "ed0826c4-615a-4350-8b93-b48caf07af31",
  "un-dia-en-el-mercado": "e919a276-0058-4546-8dbd-782b2ca0ecd5",
  "mi-familia-y-yo": "f0040afd-172b-4471-85d1-6b3141aea2c2",
  elmer: "2376d4cc-1d91-477f-bec5-b60751033845",
  "froet-som-ville-blomstre": "4cd7cb3b-e568-4c1f-a7b6-a1ab7c5d154b",
  "bestefars-bat": "38be5fbc-ec62-4459-bf93-f7ab5a72ffe8",
  "den-lille-froe": "cf3caf6e-6799-4359-af4e-7fc9f9bbb641",
  "skoven-om-natten": "06045d79-3b4b-4ab5-afab-b2e6ad27f4cf",
  "larbre-magique": "f665dbe0-c000-4058-a21b-ae38b00e50c3",
  "the-napping-house": "d5449d06-af3d-4068-a026-09f73ed4f5f3",
  "blueberries-for-sal": "b4d6dd01-9852-4dc3-a0a7-44461a7194ef",
  corduroy: "dbf4a65b-f6a4-49c7-bcb0-2d217e73d856",
  "harold-and-the-purple-crayon": "5962e867-6b78-4743-9d75-0113751b8cca",
  ish: "9cee1e39-fdf3-40b2-93dd-e9bd3dd2053b",
  "the-dot": "f912de96-6e94-4254-807d-2541242d54fb",
  "music-and-movement": "13beeaf1-f21f-41bd-9006-25002712ff6d",
  "kitchen-helpers": "fc375959-af8a-4fd9-92c2-d51df4f83604",
  "community-helpers-on-our-street": "a6f8d4f0-8260-477c-9d7e-67d56c4b9ca6",
  "big-feelings-small-moments": "be66531e-09c6-44b5-ae3b-2a026c66227e",
  "friends-through-thick-and-thin": "df992e74-7da5-4f60-af20-f13155f9d1c1",
};

/** A small number of explicit, deliberate development-only additions (Phase 4 brief
 * §28) — the 48 fixture books are each single-language; these rows exercise the
 * genuinely relational `book_languages` multilingual case without fabricating new
 * books. Not implying the school actually owns a Swedish/German "Guess How Much I
 * Love You" or a French "The Rainbow Fish"; this is seed/test data. "de" (German) is
 * deliberately included alongside the original six fixture languages — proof that
 * `src/lib/catalog/languages.ts`'s centralized ISO 639-1 registry, not a hard-coded
 * six-language list, is what actually governs a real database record (Phase 4
 * correction pass, docs/DECISIONS.md). */
const ADDITIONAL_LANGUAGES: Record<string, string[]> = {
  "guess-how-much-i-love-you": ["sv", "de"],
  "the-rainbow-fish": ["fr"],
};

/** A few books get a second physical copy so derived copy-count logic has something
 * real to compute against (Phase 4 brief §28). */
const BOOKS_WITH_TWO_COPIES = new Set(["very-hungry-caterpillar", "the-gruffalo", "goodnight-moon"]);

/**
 * Deliberately partial and mixed, by design (Phase 9 addendum) — real
 * dev-fixture coverage for the Move/Return workflow needs a book whose copies
 * span multiple real locations (`very-hungry-caterpillar`: two named
 * locations, exercising "ask which source"), a book with one named location
 * plus one copy left genuinely unassigned (`the-gruffalo`: also the exact
 * fixture `e2eFixtures.ts` uses for photo-match E2E coverage), and books with
 * no entry at all (every other seeded book, including `goodnight-moon`,
 * despite also having two copies) — every copy of those stays with
 * `current_location_id` left `null`, the same honest "not recorded" state a
 * real pre-migration copy would have. Never assumed to be Corridor 218 or
 * anywhere else just because it's unassigned.
 */
const COPY_LOCATION_SLUGS_BY_BOOK: Record<string, string[]> = {
  "very-hungry-caterpillar": ["corridor-218", "blue-room"],
  "the-gruffalo": ["forest-room"],
};

function readAloudMinutesEstimate(book: Book): string | null {
  // numeric(4,1) column — drizzle-orm/postgres-js expects numeric values as strings.
  // None of the 48 real fixtures are missing this, but the type now genuinely
  // allows it (Phase 5 correction pass) — never coerced to 0, which would silently
  // satisfy an "Under 5 minutes" search.
  return book.readAloudMinutes != null ? book.readAloudMinutes.toFixed(1) : null;
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL must be set. See docs/DATABASE_SETUP.md.");
  }

  const client = postgres(connectionString, { max: 1 });
  const db = drizzle(client, { schema });

  console.log(`Seeding ${fixtureBooks.length} development books (truncate-then-seed)...`);

  await db.execute(sql`
    truncate table
      book_identity_candidates, metadata_provider_cache,
      ingestion_items, ingestion_jobs,
      book_copies, book_sheet_sync,
      reading_list_items, reading_lists,
      review_flags, book_duplicates, book_field_provenance,
      taxonomy_suggestions,
      book_tags, tags,
      book_languages,
      book_contributors, contributors,
      books,
      publishers, physical_categories, library_locations,
      audit_log, login_attempts, system_settings
    restart identity cascade
  `);

  // 1. Physical categories — development taxonomy only, see docs/DATA_MODEL.md §12.
  const categoryIdBySlug = new Map<string, string>();
  const categoryLabelBySlug = new Map<string, string>();
  for (const category of PHYSICAL_CATEGORIES) {
    const [row] = await db
      .insert(schema.physicalCategories)
      .values({ slug: category.id, label: category.label })
      .returning({ id: schema.physicalCategories.id });
    categoryIdBySlug.set(category.id, row.id);
    categoryLabelBySlug.set(category.id, category.label);
  }

  // 1b. Library locations — development fixture spaces only (Phase 9 addendum:
  // physical copy locations), NOT the school's confirmed physical spaces —
  // exactly the same "development, not confirmed inventory" caveat this whole
  // file already carries for categories/books. Exists so the Move/Return
  // workflow (and its tests) have real, deterministic multi-location data:
  // "Corridor 218" is one of these three purely because it's the exact
  // example the addendum itself uses, never because it's been confirmed as
  // this school's real corridor.
  const DEV_FIXTURE_LOCATIONS: { slug: string; displayName: string; locationType: "corridor" | "classroom" | "other" }[] = [
    { slug: "corridor-218", displayName: "Corridor 218", locationType: "corridor" },
    { slug: "blue-room", displayName: "Blue Room", locationType: "classroom" },
    { slug: "forest-room", displayName: "Forest Room", locationType: "classroom" },
  ];
  const locationIdBySlug = new Map<string, string>();
  for (const location of DEV_FIXTURE_LOCATIONS) {
    const [row] = await db
      .insert(schema.libraryLocations)
      .values({ slug: location.slug, displayName: location.displayName, locationType: location.locationType })
      .returning({ id: schema.libraryLocations.id });
    locationIdBySlug.set(location.slug, row.id);
  }

  // 2. Publishers.
  const publisherIdByName = new Map<string, string>();
  for (const name of new Set(fixtureBooks.map((b) => b.publisher))) {
    const [row] = await db
      .insert(schema.publishers)
      .values({ name, normalizedName: name.toLowerCase() })
      .returning({ id: schema.publishers.id });
    publisherIdByName.set(name, row.id);
  }

  // 3. Contributors.
  const contributorIdByName = new Map<string, string>();
  const contributorNames = new Set<string>();
  for (const book of fixtureBooks) {
    book.authors.forEach((name) => contributorNames.add(name));
    (book.illustrators ?? []).forEach((name) => contributorNames.add(name));
  }
  for (const name of contributorNames) {
    const [row] = await db
      .insert(schema.contributors)
      .values({ name, normalizedName: name.toLowerCase() })
      .returning({ id: schema.contributors.id });
    contributorIdByName.set(name, row.id);
  }

  // 4. Tags.
  const tagIdByName = new Map<string, string>();
  const tagNames = new Set<string>();
  for (const book of fixtureBooks) book.tags.forEach((tag) => tagNames.add(tag));
  for (const name of tagNames) {
    const [row] = await db
      .insert(schema.tags)
      .values({ name, normalizedName: name.toLowerCase() })
      .returning({ id: schema.tags.id });
    tagIdByName.set(name, row.id);
  }

  // 5. Books, plus their join-table rows.
  for (const book of fixtureBooks) {
    const bookId = BOOK_ID_BY_SLUG[book.id];
    if (!bookId) throw new Error(`No stable UUID assigned for fixture book "${book.id}" — add one to BOOK_ID_BY_SLUG.`);

    const additionalLanguageCodes = (ADDITIONAL_LANGUAGES[book.id] ?? []) as LanguageCode[];
    const searchText = buildSearchIndexText({
      title: book.title,
      subtitle: book.subtitle,
      description: book.description,
      authors: book.authors,
      illustrators: book.illustrators,
      publisher: book.publisher,
      imprint: book.imprint,
      categoryLabel: categoryLabelBySlug.get(book.physicalCategory),
      tags: book.tags,
      languageCode: book.languageCode,
      additionalLanguageCodes,
      fictionType: book.fictionType,
      format: book.format,
      illustrationStyles: book.illustrationStyles,
      visualRealism: book.visualRealism,
      ageMinMonths: book.ageMinMonths,
      ageMaxMonths: book.ageMaxMonths,
      readAloudMinutes: book.readAloudMinutes,
    });

    await db.insert(schema.books).values({
      id: bookId,
      title: book.title,
      subtitle: book.subtitle,
      normalizedTitle: normalizeTitle(book.title),
      sortTitle: book.sortTitle,
      shortDescription: book.description,
      languageCode: book.languageCode,
      // Every one of the 48 real fixtures has a concrete fictionType; the fallback
      // only exists to satisfy the type (Phase 5 made this field optional to
      // represent genuinely unknown records — see the dedicated incomplete-metadata
      // seed book below for real coverage of that path).
      fictionStatus: book.fictionType ?? "unknown_mixed",
      ageMinMonths: book.ageMinMonths,
      ageMaxMonths: book.ageMaxMonths,
      readAloudMinutesEstimate: readAloudMinutesEstimate(book),
      format: book.format,
      visualMediaType: book.illustrationStyles,
      visualRealism: book.visualRealism,
      publisherId: publisherIdByName.get(book.publisher),
      publicationYear: book.publicationYear,
      physicalCategoryId: categoryIdBySlug.get(book.physicalCategory),
      isbn10: book.isbn10,
      isbn13: book.isbn13,
      reviewStatus: "active",
      verifiedAt: new Date(),
      searchText,
    });

    let sortOrder = 0;
    for (const name of book.authors) {
      await db
        .insert(schema.bookContributors)
        .values({ bookId, contributorId: contributorIdByName.get(name)!, role: "author", sortOrder: sortOrder++ });
    }
    let illustratorOrder = 0;
    for (const name of book.illustrators ?? []) {
      await db.insert(schema.bookContributors).values({
        bookId,
        contributorId: contributorIdByName.get(name)!,
        role: "illustrator",
        sortOrder: illustratorOrder++,
      });
    }

    for (const tagName of book.tags) {
      await db.insert(schema.bookTags).values({ bookId, tagId: tagIdByName.get(tagName)! });
    }

    for (const languageCode of additionalLanguageCodes) {
      await db.insert(schema.bookLanguages).values({ bookId, languageCode });
    }

    const copyCount = BOOKS_WITH_TWO_COPIES.has(book.id) ? 2 : 1;
    const copyLocationSlugs = COPY_LOCATION_SLUGS_BY_BOOK[book.id] ?? [];
    for (let i = 0; i < copyCount; i += 1) {
      const locationSlug = copyLocationSlugs[i];
      await db.insert(schema.bookCopies).values({
        bookId,
        homeLocation: "Preschool Library",
        currentLocationId: locationSlug ? locationIdBySlug.get(locationSlug) : undefined,
      });
    }
  }

  // 6. Deliberate non-active and incomplete-metadata records (Phase 5 correction
  // pass) — not derived from fixtures.ts, since these specifically exist to prove
  // catalog-visibility scoping and "unknown metadata is never invented" behavior
  // against a real database, not just in-memory unit fixtures. Never shown to
  // teacher search/autocomplete/facets; see docs/DATA_MODEL.md's visibility section
  // and tests/integration/db/searchRepository.test.ts.
  const anyCategoryId = [...categoryIdBySlug.values()][0];
  await db.insert(schema.books).values({
    id: "10000000-0000-0000-0000-000000000001",
    title: "Pending Review Test Book",
    normalizedTitle: normalizeTitle("Pending Review Test Book"),
    sortTitle: "Pending Review Test Book",
    languageCode: "en",
    physicalCategoryId: anyCategoryId,
    reviewStatus: "pending_review",
    searchText: buildSearchIndexText({
      title: "Pending Review Test Book",
      authors: [],
      tags: [],
      languageCode: "en",
      illustrationStyles: [],
    }),
  });
  await db.insert(schema.books).values({
    id: "10000000-0000-0000-0000-000000000002",
    title: "Archived Test Book",
    normalizedTitle: normalizeTitle("Archived Test Book"),
    sortTitle: "Archived Test Book",
    languageCode: "en",
    physicalCategoryId: anyCategoryId,
    reviewStatus: "archived",
    searchText: buildSearchIndexText({
      title: "Archived Test Book",
      authors: [],
      tags: [],
      languageCode: "en",
      illustrationStyles: [],
    }),
  });
  // Active, but every "can be unknown" field genuinely is — no fictionStatus,
  // format, visualRealism, age, or duration recorded. This must still search,
  // display, and facet safely: "Not specified" everywhere, never a fabricated
  // "nonfiction"/"other"/"mixed"/"under 5 minutes".
  await db.insert(schema.books).values({
    id: "10000000-0000-0000-0000-000000000003",
    title: "Book With Incomplete Metadata",
    normalizedTitle: normalizeTitle("Book With Incomplete Metadata"),
    sortTitle: "Book With Incomplete Metadata",
    languageCode: "en",
    physicalCategoryId: anyCategoryId,
    reviewStatus: "active",
    // fictionStatus defaults to "unknown_mixed"; format/visualRealism/age/duration
    // all left NULL.
    searchText: buildSearchIndexText({
      title: "Book With Incomplete Metadata",
      authors: [],
      tags: [],
      languageCode: "en",
      illustrationStyles: [],
    }),
  });

  console.log(`Seed complete: ${fixtureBooks.length} books, ${categoryIdBySlug.size} categories, ` +
    `${publisherIdByName.size} publishers, ${contributorIdByName.size} contributors, ${tagIdByName.size} tags, ` +
    `3 deliberate non-active/incomplete-metadata test books.`);

  await client.end();
}

main().catch((error) => {
  console.error("Seed failed:", error);
  process.exit(1);
});
