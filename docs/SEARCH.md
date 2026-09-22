# Search

Status: **Phase 5 — real, database-backed hybrid search.** Replaces the Phase 2–4
`Postgres → BookRepository.listBooks() → in-memory searchBooks()` path (which loaded the
entire catalog into the Node process on every request) with a bounded, server/database-backed
retrieval pipeline sized for the catalog's real target scale (~1,500–5,000 books). The
deterministic ranking engine from Phase 2–4 (`lib/search/rank.ts`, `rankingConfig.ts`,
`intent.ts`, `explain.ts`) is **unchanged in kind** — it still runs, still scores free text
against structured fields, still produces grounded explanations — it is now one input to a
larger hybrid score that also includes real SQL retrieval signals (§9).

No generative AI is used anywhere in this pipeline. An optional embedding *provider* (§5) can
supply a vector for semantic retrieval, but nothing in this system asks a language model to
interpret a query, invent a book, or write an explanation. Every explanation is a deterministic
template (`lib/search/explain.ts`) built from fields that actually matched.

## §1 — Pipeline overview

```
Teacher query + selected filters (typed or voice — §10, identical either way)
        │
        ▼
SearchService.search({ query, filters, limit })         (lib/search/searchService.ts)
        │
        ├─ normalize + parse intent (unchanged from Phase 2–4: lib/search/intent.ts)
        │
        ▼
SearchRepository.findCandidates({ query, filters, queryEmbedding? })
        │  (src/db/repositories/searchRepository.ts — all SQL lives here)
        │
        ├─ hard filter conditions (§2)        — SQL WHERE, never an in-app .filter()
        ├─ exact/near-exact candidates (§3)   — title/ISBN/contributor/publisher equality
        ├─ full-text candidates (§3)          — Postgres FTS, OR-of-lexemes, ts_rank
        ├─ trigram candidates (§3)            — pg_trgm, typo tolerance
        └─ vector candidates (§5, optional)   — pgvector cosine distance, only if an
                                                 embedding provider is configured
        │
        ▼   merged into one Map<bookId, CandidateSignals> — a bounded set (≤ ~320 ids,
        │   never the full catalog; see the per-strategy LIMIT constants in
        │   searchRepository.ts)
        ▼
BookRepository.getBooksByIds(ids)   — projects ONLY the candidate ids into full `Book`
        │                              objects (never the whole catalog)
        ▼
combineScores() / rankScoredBooks()  (§9 — lib/search/hybridScore.ts)
        │   deterministic score (rank.ts, unchanged) + SQL retrieval signals,
        │   thresholded, deterministically tie-broken
        ▼
buildMatchExplanation()  — grounded, deterministic sentence (unchanged from Phase 2–4)
        ▼
limit/offset slice (§7) → SearchResultPage { results, totalQualifying, hasMore, facets }
        ▼
Find UI (app/(staff)/find/page.tsx, ResultsList, FilterDialog, SearchInput)
```

**Filters remain hard constraints; free-text query signals remain ranking-only** — the one
rule that resolves most of the design, unchanged from Phase 2–4. A book excluded by an
explicit filter never appears, however well it matches typed text; a book that merely fails to
match a *parsed* free-text signal (e.g. an age mentioned in a sentence) can still appear,
ranked lower.

**Catalog visibility.** Every query a teacher can trigger — search, autocomplete, facets — is
scoped to `review_status = 'active'` (`lib/catalog/visibility.ts`,
`TEACHER_VISIBLE_REVIEW_STATUS`), applied as the first SQL condition in
`SearchRepository`. `pending_review` and `archived` books never appear in any of these paths.
This does **not** apply to `BookRepository.getBookById()` / `listBooks()` — Book Detail and
Reading Lists must keep resolving a book regardless of its review status, since a teacher who
already has a book on a Reading List (or a direct link to it) must not see it vanish. See
`docs/DATA_MODEL.md` for the full review-status lifecycle and
`tests/integration/db/searchRepository.test.ts` for the tests proving non-active books never
leak into any teacher-facing search path.

## §2 — Layer 2: structured filtering

`buildHardFilterConditions(filters)` in `searchRepository.ts` builds real SQL `WHERE`
conditions — AND across filter groups, OR within a group — mirroring
`lib/search/filters.ts`'s `matchesFilters` semantics exactly (the two must never disagree; both
are covered by tests). Age uses representative-month-overlap against `ageMinMonths`/
`ageMaxMonths`; language matches the primary `books.language_code` OR an `EXISTS` against
`book_languages` (§ multilingual, below); fiction type / format / visual realism / duration
compare against the relevant column (duration compares against the generated
`read_duration_band` column — the single authority for duration bands, §incomplete metadata);
illustration styles use `array_overlaps`; author/illustrator/publisher/imprint use `EXISTS`
subqueries joining `book_contributors`/`contributors`/`publishers`.

No LLM is used or needed for structured filtering — every filter is either a UI-selected
value (checkbox/radio, unambiguous) or a deterministic phrase parsed from free text by
`lib/catalog/age.ts` / `lib/search/intent.ts` (age ranges like "2 to 5", explicit ages, duration
phrases, language names, illustration-style phrases — unchanged in kind from Phase 2–4, with
one Phase 5 addition: an age-range phrase like "2 to 5" now parses to a single representative
age via its midpoint, a documented ranking-only simplification, never a hard filter; a negative
lookahead prevents this colliding with duration ranges like "5 to 10 minutes").

**Structured intent needs its own SQL candidate query, not just a ranking bonus.** A real
regression was found via the evaluation harness (§11): a query like "a book for a 4 year old"
shares almost no literal vocabulary with a given age-appropriate book's title/description, so
once retrieval moved from "score the whole catalog" to "score only SQL-bounded candidates," an
age-appropriate book with zero keyword overlap was never retrieved as a candidate at all — the
deterministic age-intent bonus never got a chance to apply, silently regressing a real Phase
2–4 capability. Fixed by `buildIntentConditions()` (`searchRepository.ts`): whenever
`parseSearchIntent()` recognizes an age/duration/language/illustration-style/visual-realism
phrase, a dedicated, bounded SQL query retrieves every book matching *that one structured
signal* (mirroring the hard-filter predicates structurally, OR'd together instead of AND'ed)
and merges them into the candidate set with no retrieval-signal bump of their own — their score
comes entirely from the unchanged deterministic `scoreBook()` intent bonus, exactly reproducing
Phase 2–4's behavior. Verified directly: before the fix, "a book for a 4 year old" produced 4
SQL candidates (only those sharing an incidental word like "book"); after the fix, 38 (the real
count of age-4-appropriate books in the seeded catalog). See
`tests/integration/db/searchRepository.test.ts`, "structured free-text intent produces real
candidates, not just a ranking bonus."

**Hard constraint vs. strong structured fit vs. soft preference (Phase 5 correction pass).**
Every structured signal this system recognizes falls into exactly one of three tiers, and the
distinction is load-bearing — a signal never silently moves from one tier to another:

| Tier | What it means | Examples |
|---|---|---|
| **Hard constraint** | An explicit UI Filter selection. Enforced as a real SQL `WHERE` condition (`buildHardFilterConditions`); a book failing it is excluded, full stop, regardless of how well it matches the free-text query. | Any checkbox/radio in the Filters dialog: language, age, fiction type, format, category, duration, visual realism, illustration style, author/illustrator/publisher. |
| **Strong structured fit** | A phrase *parsed from free text* that resolves to the same underlying dimension as a hard constraint, scored with a weight in the same "strong" tier as author/category/tag matching (`RANKING_WEIGHTS`) and retrieved via its own bounded SQL candidate query (`buildIntentConditions`) — but never enforced as exclusion. A book that doesn't match still can appear; it just doesn't get the bonus. | Age point/range ("age 4", "2 to 5"), language name ("a Swedish book"), duration phrase ("a 5 minute read"), illustration-style phrase ("watercolor books"), visual-realism phrase ("real photos"). |
| **Soft preference** | A literal keyword match against a label/value, weighted "medium" (format/fiction-type) or "weak" (description keyword) — the least precise signals, present mostly to avoid missing an obvious literal mention. | The literal words "fiction"/"nonfiction" in a query; a format name like "picture book"/"board book"; a category name like "animals" (matched against the category slug's words). |

No tier ever converts an ambiguous natural-language hint into a silent hard filter — only an
explicit Filter selection excludes a book. See `tests/unit/search/intent.test.ts` and
`tests/unit/search/rank.test.ts` for direct coverage of every named example above (age range,
fiction/nonfiction, format, category, real photos, watercolor, collage), and
`tests/evaluation/dataset.ts`'s "structured" category for end-to-end cases against a real
database.

## §3 — Layer 3: Postgres full-text + trigram retrieval

**Full-text search.** `books.search_text` (populated by `buildSearchIndexText()`,
`lib/embeddings/document.ts`) is a generated `search_vector` `tsvector` column
(`to_tsvector('english', search_text)`, `GENERATED ALWAYS AS ... STORED`), indexed with a GIN
index. Deliberately **not** the same text as the semantic embedding document (§5) — see the
dedicated note on `search_text` below.

Retrieval uses an **OR of the query's own stemmed lexemes**
(`to_tsquery('english', array_to_string(tsvector_to_array(to_tsvector('english', query)), ' |
'))`), not `plainto_tsquery`'s implicit AND. This was a real bug found during E2E testing: a
five-word descriptive query like "animal books with real photos" returned **zero** results
under AND semantics, because no single book's document contained every one of those words
verbatim (the literal word "book" appears in no book's own document — it's a generic word
about the query, not the content). Rebuilding the tsquery as an OR of the same lexemes
correctly surfaces real matches, with `ts_rank` (which already rewards matching more of the
query's terms) still ranking a five-lexeme match above a one-lexeme one.

An OR query alone is too permissive on its own, though — a **meaningful-overlap gate**
(`ftsHasMeaningfulOverlap()`) requires at least 2 of a multi-word query's lexemes to actually
appear in a candidate row (or all of them, when the query has fewer than two). This was added
after a second real bug: the filler query "something to read please" incidentally matched two
unrelated books purely because their descriptions happened to contain the ordinary word
"read" — a single incidental word match is not a genuine full-text match. Verified directly: a
real multi-word topical query like "animal books with real photos" easily clears "≥2 of 4
lexemes" for the actually-relevant books, while single-word coincidences never do.

**Why `search_text` excludes field labels.** An earlier version of `search_text` reused the
labeled, prose-style text meant for the embedding document ("Read-aloud length: Under 5
minutes", etc.). This caused every single seeded book to full-text-match any query containing
the ordinary word "read", because the structural label "Read-aloud length" is present in
literally every record — a label carries zero discriminative value for literal lexeme
matching, however useful it is for a semantic embedding model reading prose. `search_text` is
therefore built by `buildSearchIndexText()`, a distinct function from
`buildEmbeddingDocument()`: same underlying fields, same stable order, but **values only, no
labels** — title, subtitle, authors, illustrators, publisher/imprint, category, tags,
languages, fiction type, format, illustration styles, visual realism, description. Classifier
fields (type/format/visual style) are already reachable through Layer 2's structured filters;
free text search only needs the genuinely distinguishing content.

**Trigram fuzzy matching.** `pg_trgm`'s `similarity()` provides typo tolerance FTS' exact-lexeme
matching misses. Compared against `books.title` and (separately) `contributors.name` — **not**
`search_text` — because a short misspelled word compared against a long multi-field document
dilutes to a near-zero similarity score even for the correct book. Verified directly against
the dev database: `similarity(title, 'caterpilar')` for "The Very Hungry Caterpillar" scores
0.357; `similarity(title, 'grufalo')` for "The Gruffalo" scores 0.5; unrelated titles score
under 0.1 for the same queries. `TRGM_SIMILARITY_FLOOR = 0.2` sits well below real typo matches
and well above noise.

`books_title_trgm_idx`/`contributors_name_trgm_idx` (GIN, `gin_trgm_ops`) index the columns
these queries actually compare against. **A real, measured gap found via `EXPLAIN ANALYZE` at a
realistic scale (not just the 48–51-row dev seed)**: a synthetic ~2,551-row test catalog showed
that filtering with `similarity(title, query) > floor` never used the trigram index at all —
Postgres only index-accelerates the `%`/`<%`/`%>` trigram *operators*, not an arbitrary
function-call comparison, however numerically identical. The query ran as a full sequential
scan: 6.7ms to find a single matching row. Switching the `WHERE` clause to the indexable
`title % query` form, under a transaction-scoped `SET LOCAL pg_trgm.similarity_threshold`
matching `TRGM_SIMILARITY_FLOOR` (while still computing/ordering by the exact `similarity()`
value), let the planner use the index automatically: **0.16ms for the identical query, a ~40x
improvement** that matters more as the catalog grows toward its ~5,000-book target. The `SET
LOCAL` is wrapped in `db.transaction()` in `findCandidates()` specifically so it can never leak
to another query sharing the same pooled connection afterward.

**Exact/near-exact matching** (title equality/prefix, ISBN-10/13 digit equality, exact
contributor-or-publisher name) is a separate, unbounded-priority candidate source — a known-item
query like an ISBN or an author's full name should never depend on FTS/trgm heuristics at all.

**Title-exact matching uses one canonical normalizer on both sides (Phase 5 correction pass).**
The exact-title candidate query previously compared `books.normalized_title` (written at seed/
backfill time via `normalizeTitle()` — lowercased, leading-article-stripped, diacritic-stripped)
against a bare `trimmed.toLowerCase()` on the query side — no article-stripping, no diacritic
handling. A query that still carried its own leading article ("The Very Hungry Caterpillar")
therefore failed to exact-match the stored, article-stripped value ("very hungry caterpillar").
Fixed by exporting `normalizeTitle()` from `lib/search/normalize.ts` (previously a private
function inside `seed.ts`) and calling the exact same function on the query side
(`eq(books.normalizedTitle, normalizeTitle(trimmed))`) — never two subtly different
title-normalization implementations. See `tests/unit/search/normalize.test.ts` and
`tests/evaluation/dataset.ts`'s "known-item-normalized-title-no-article" case.

**Field weighting.** No raw provenance, audit, review-status, or operational metadata is ever
part of `search_text` — only teacher-facing content fields, the same fields
`lib/catalog/types.ts`'s `Book` type exposes.

**Migration-upgrade backfill and ongoing search-text maintenance (Phase 5 correction pass).**
Migration `0001` added `books.search_text` as a nullable column — correct for a from-zero
migrate-then-seed database (nothing to backfill), but silently wrong for an already-populated
Phase 4 database: its existing rows would keep a NULL `search_text` (and therefore an empty
generated `search_vector`, disabling full-text discovery for every pre-existing book) until
something happened to reseed them, with no visible error. Two distinct, clearly separated
mechanisms fix this:

1. **Automatic upgrade backfill, folded into `npm run db:migrate` itself.** After running the
   schema migrations, `src/db/migrate.ts` calls `rebuildSearchText(db, { mode: "missing" })`
   (`lib/search/searchTextMaintenance.ts`), which finds every book with a NULL `search_text` and
   computes it using the exact same `buildSearchIndexText()` function (and the same relational
   data sourcing — contributors by role/order, publisher, category label, tags, primary +
   additional languages) that `seed.ts` already uses. A from-zero database finds nothing to do
   (a fast no-op); a populated Phase 4 database gets every existing book backfilled, as part of
   the same command that's already the documented upgrade step — never a second manual step
   someone could forget. Deterministic and idempotent by construction (re-running it finds
   nothing left to update).
2. **`npm run search:rebuild-text`** (`scripts/search/rebuildSearchText.ts`) — the controlled
   command for the ongoing maintenance case: a book's metadata changed through a path that
   didn't already recompute `search_text` (a bulk import, a direct edit), and its conventional-
   search text is now stale. `--mode=missing` (default, matches the migration's own scope) or
   `--mode=all` (every book — the right choice after editing `buildSearchIndexText`'s
   composition itself). **Distinct from `npm run embeddings:generate`**: this command never
   calls an embedding provider, needs no `GEMINI_API_KEY`, and only ever touches `search_text`.
   Rebuilding `search_text` for an edited book also makes any of its existing stored embeddings
   detectably stale — `buildEmbeddingDocument()`'s `sourceHash` is computed from the same
   underlying fields, so `embeddings:generate --mode=stale` independently notices the mismatch
   on its own next run. The two commands compose; they are never conflated.

   **Phase 8 correction pass — live Find never reads a stale vector in the meantime.** The
   `--mode=stale` hash comparison above is an *offline batch-detection* convention (a script run
   a human triggers later); it was never consulted by the live semantic-retrieval query itself,
   which simply trusts any non-null `books.embedding`. That gap meant an admin metadata/category
   edit could rebuild `search_text` immediately while the OLD embedding vector kept actively
   influencing semantic Find results until someone happened to run a stale-mode backfill. Every
   Phase 8 admin mutation that changes embedding-document content (`updateBookMetadata`, a
   category label rename affecting its books, Review Later finalization) now clears
   `embedding`/`embedding_model`/`embedding_dimension`/`embedding_composition_version`/
   `embedding_source_hash`/`embedding_generated_at` to `null` — via the one shared
   `src/lib/admin/embeddingInvalidation.ts` helper — in the SAME transaction as the content
   change, before the fire-and-forget targeted refresh is even attempted. A book with a cleared
   embedding simply has no semantic signal (conventional full-text/trigram search is completely
   unaffected) until the next successful refresh or backfill — the same normal, honest state a
   never-yet-embedded book is already in, never a fabricated or silently-stale one.

**Why a script, not a third `.sql` migration file, for the backfill logic itself.** The
composition (which relational data feeds `search_text`, in what order) already lives in one
place, `buildSearchIndexText()` — reimplementing that same logic in raw SQL for a migration file
would create a second, drift-prone implementation of the exact kind of duplication this
correction pass separately fixed for title normalization (see above). `rebuildSearchText()` is
still a genuinely forward-only, deterministic, idempotent operation, and running it is mandatory
(not optional) as part of `db:migrate` on any existing database — it is simply implemented as a
data operation triggered by the migration command, not as DDL inside a `.sql` file.

Proven end to end by `tests/integration/db/migrationUpgrade.test.ts`: a fresh database is
brought to exactly the Phase 4 (migration `0000`) schema state with real relational data
inserted directly (no `search_text` column exists yet at that point), the real Phase 5
migrations are applied via drizzle's own `migrate()`, and the test confirms `search_text` is
NULL immediately after (reproducing the bug), then populated correctly by the backfill —
including title, contributor, publisher, category, tag, and additional-language content, all
verified as genuinely full-text-searchable afterward — with the book's id, its `book_copies` row,
and its Reading List reference all unchanged throughout.

## §4 — Architecture boundary

`SearchService` (`lib/search/searchService.ts`, `import "server-only"`) is the **only**
search-facing boundary the Find page talks to. It never exposes SQL, Drizzle query builders, or
vector-distance internals to the UI — the Find page and its client components
(`SearchInput`, `FilterDialog`, `ResultsList`, `CategoryQuickPills`) only ever see plain
TypeScript types (`SearchResultRow`, `SearchResultPage`, `FacetCounts`).

`SearchRepository` (`src/db/repositories/searchRepository.ts`) owns every SQL statement in the
search path. `BookRepository.getBookById()` remains the separate, unscoped boundary Book Detail
and Reading Lists use (§1, visibility). `createSearchService()`
(`src/db/repositories/index.ts`) wires the two together with the category list, fetched fresh
per call rather than cached as a stale singleton.

A dedicated `SearchService.getFacets()` method exists specifically so the true empty-Find-page
state (no query, no filters) never triggers a full candidate-book fetch/projection just to
render the Filters dialog's option lists — it queries only the lightweight facet rows
(`SearchRepository.getVisibleBookFacetRows()`), never `getBooksByIds()`. The Find page calls
`getFacets()` when there's no query and no active filter, and `search()` only when there's real
intent to search for.

## §5 — Layer 4: optional semantic retrieval

**pgvector, same database, no separate vector store.** `books.embedding` is a native
`vector(768)` column (via Drizzle's built-in `vector()` column builder) in the same Postgres
database as everything else — no separate vector database. 768 is a storage *contract*
(`EMBEDDING_DIMENSIONS`, `src/db/schema/books.ts`) matching Gemini's `gemini-embedding-2`
output dimensionality; changing providers/dimensions would require a new migration and a full
re-backfill, not a silent reinterpretation of existing vectors. Retrieval performs an exact
vector scan (`embedding <=> queryEmbedding::vector`, cosine distance) rather than an approximate
index — at this catalog's target scale (~1,500–5,000 rows), an exact scan is fast and correct;
an ANN index (ivfflat/hnsw) is deferred until a measurement at real scale justifies the
approximation.

Alongside `embedding`, four metadata columns record exactly what produced it:
`embedding_model`, `embedding_dimension`, `embedding_composition_version`,
`embedding_source_hash`, `embedding_generated_at` — the composition version and hash are what
let the backfill script distinguish "this book's embedding used an old document composition"
from "this book's data changed since its embedding was made" (§ embedding generation, below).

**Provider abstraction.** `lib/embeddings/provider.ts` defines a small `EmbeddingProvider`
interface (`modelId`, `dimensions`, `embedDocuments`, `embedQuery`) with three typed errors
(`EmbeddingProviderUnavailableError`, `EmbeddingProviderConfigError`,
`EmbeddingProviderRequestError`). Two implementations exist:

- `GeminiEmbeddingProvider` (`lib/embeddings/geminiProvider.ts`) — a production adapter using
  plain `fetch()` (no SDK) against `gemini-embedding-2`'s REST endpoint, a 3-second timeout via
  `AbortController`, and `outputDimensionality: 768`. Requires `GEMINI_API_KEY`. **Implements an
  explicit asymmetric retrieval input contract (Phase 5 correction pass)**: `embedQuery()` and
  `embedDocuments()` previously sent the exact same unlabeled text through the same code path —
  no distinction between "this is a query" and "this is a document being indexed," even though
  Google's own retrieval guidance is that the two should be formatted differently so the model
  produces embeddings actually optimized for each role. `gemini-embedding-2` (unlike the older
  `gemini-embedding-001`, which exposes a discrete `task_type` request field) documents this as a
  plain-text instruction prefix embedded in the content itself: a document being indexed is sent
  as `"title: none | text: {content}"` (Google's own guidance for when no separate title field is
  used — the real title already appears as the first line of `buildEmbeddingDocument()`'s own
  composed text); a search query is sent as `"task: search result | query: {content}"`. Sourced
  from `ai.google.dev/gemini-api/docs/embeddings` and Google's "Gemini Embedding 2" model
  announcement. **Live-provider validated (2026-09-17)** against a real `GEMINI_API_KEY`: both
  `embedContent` (single query) and `batchEmbedContents` (document batch) succeed, return exactly
  768 finite values per input, and a direct cosine-similarity check between the two input
  formattings of the same underlying text (0.98, not 1.0) confirms the asymmetric prefixes are
  genuinely accepted and produce related-but-different embeddings — the documented contract, as
  implemented, matches the live API. This formatting change is what a real Gemini call actually
  embeds, even though `buildEmbeddingDocument()`'s own output text and `sourceHash` are unchanged
  — `EMBEDDING_COMPOSITION_VERSION` was bumped 1 → 2 specifically so any embedding generated
  before this change is detectably stale. See `tests/unit/embeddings/geminiProvider.test.ts`
  (proves the two paths send genuinely different request bodies, with a mocked `fetch`) and
  `docs/DECISIONS.md` for the live-call evidence itself.

  **Rate-limit handling (added during real-provider validation, 2026-09-17).** Live testing
  produced real, reproducible `HTTP 429` responses from Gemini under repeated calls in a short
  window. Both `embedOne` and `embedDocuments` now retry through `fetchWithRetry` — up to 2
  retries, honoring a numeric `Retry-After` header when present or falling back to 1.5s, and only
  for `429`/`503` — before surfacing the real HTTP error. See
  `tests/unit/embeddings/geminiProvider.test.ts` ("retry on rate limit / transient overload").
- `FakeEmbeddingProvider` (`lib/embeddings/fakeProvider.ts`) — a deterministic, SHA-256-seeded,
  L2-normalized pseudo-embedding provider, **test-only**. It is never wired into
  `getConfiguredEmbeddingProvider()` and never produces a real search result; it exists purely
  so the retrieval/storage/scoring code paths have deterministic, fast, offline test coverage
  for "an embedding is present" without a real API key.

`getConfiguredEmbeddingProvider()` (`lib/embeddings/index.ts`, `import "server-only"`) reads
`GEMINI_API_KEY` and returns `undefined` — never throws — when it's absent or construction
fails. **A ChatGPT, Claude, or Gemini chat subscription is not an API credential**; only a real
`GEMINI_API_KEY` (a Google AI Studio / Vertex API key) activates semantic retrieval.

**Graceful degradation is a hard requirement, not a nice-to-have.** `SearchService`'s private
`tryEmbedQuery()` wraps any embedding call in try/catch and returns `undefined` on any failure,
timeout, or absent provider — conventional search (structured filters + FTS + trigram +
exact-match, §2/§3) always completes and always returns real results with zero dependency on an
embedding provider being configured. Semantic retrieval only ever **adds** candidates on top;
it never replaces or gates conventional retrieval, and a teacher never sees an error, a
"semantic search unavailable" message, or any other visible sign that a provider call failed —
it fails silently into "no semantic signal for this query," exactly as if no candidates had
come from that branch.

**No raw query persistence.** A teacher's search query is never written to a table by default —
embedding calls are ephemeral, request-scoped.

**Deterministic embedding document.** `buildEmbeddingDocument()` (`lib/embeddings/document.ts`)
is the one function that composes a book's embedding input — stable field order, alphabetically
sorted tags, no raw database ids or provenance fields — returning
`{ text, version: EMBEDDING_COMPOSITION_VERSION, sourceHash }`. `sourceHash` is a SHA-256 of
`text`, independent of `version` (which only changes when the composition itself changes, not
when one book's data does) — together they let a backfill script tell "never embedded," "data
changed since the last embedding" (hash mismatch), and "composition changed since the last
embedding" (version mismatch) apart. Snapshot-tested (`tests/unit/embeddings/document.test.ts`)
for byte-identical output given identical input.

**Real semantic-quality validation: performed (2026-09-17), with real evidence and real limits.**
With a real `GEMINI_API_KEY`, all 49 active development-catalog books were embedded
(`npm run embeddings:generate`, composition version 2) — 49/49 succeeded, metadata
(model/dimension/version/hash/timestamp) verified per row, a repeated run against the same data
is a clean no-op, and a live edit→rebuild→restore cycle on one book's description correctly
flagged exactly that book as stale and then correctly cleared once restored. Pending/archived
books were confirmed untouched. See `docs/IMPLEMENTATION_STATUS.md` and `docs/DECISIONS.md` for
the full validation report, exploratory-query findings, and two ranking corrections this pass
made from that real evidence (the meaningful-distance ceiling, and a stop-word fix) — see §9.
This is genuine measured evidence, not a claim that the semantic layer is now perfect: at this
embedding model and this catalog's scale (~49 books), a query's real cosine distances against
the whole catalog cluster tightly enough that "the closest available real answer" and "generic
noise" overlap, and no single distance threshold perfectly separates every case (§9). Deterministic
fake embeddings elsewhere in this codebase still exist and still prove storage/retrieval/scoring
*mechanics* only — the distinction documented here is between that and this section's real
semantic-*quality* evidence.

## §6 — Autocomplete

Server-side, authenticated, bounded, and backed by real active-catalog values —
`autocompleteAction()` (`lib/search/autocompleteAction.ts`, a `"use server"` action) calls
`requireStaffSession()` independently (the same pattern established for Reading Lists' Server
Actions) and delegates to `SearchRepository.autocomplete()`, which runs seven parallel, bounded,
visibility-scoped queries — title, author, illustrator, publisher, category (`ILIKE`), tag/topic
(`ILIKE` against `tags` scoped to visible books via `book_tags`), and language (Phase 5
correction pass: `AutocompleteRow`'s type always declared "topic" and "language" as real
suggestion types, but nothing ever produced them — a real gap between the implementation and its
own report). Language matching is necessarily a two-step process: display names live only in
the centralized ISO 639-1 registry (`lib/catalog/languages.ts`), not the database, so SQL first
gathers the small, visibility-scoped, bounded *set* of codes actually in use (primary `books.
language_code` UNION additional `book_languages.language_code`, both restricted to visible
books), and only that small set — never the full catalog — is matched against the query by
display name in application code. A tag or language used only by a `pending_review`/`archived`
book must never surface here; a language used only as an ADDITIONAL (never primary) language on
a visible book still must. Never a full-catalog fetch. Client-side prefix-first / type-priority
/ alphabetical ordering is applied in the action itself before returning at most 8 rows — see
`tests/integration/db/searchRepository.test.ts` ("topic/tag and language autocomplete"),
`tests/unit/search/autocompleteAction.test.ts` (ordering logic), and
`tests/unit/components/SearchInput.autocomplete.test.tsx` (the type label actually renders).

`SearchInput` debounces keystrokes 200ms before calling the action, and guards against
out-of-order responses with a monotonically increasing request-id ref: if a slower, earlier
request resolves after a faster, later one, its result is discarded. No suggestion request
fires for fewer than 2 characters. A failed or slow autocomplete call never blocks typed
Enter-to-search, which remains fully independent.

## §7 — Facets and pagination

**Facets** are computed at the database boundary, never by loading every `Book` object.
`SearchRepository.getVisibleBookFacetRows()` returns lightweight per-book rows (language,
additional languages, fiction status, format, visual media type, visual realism,
read-duration-band, category, authors, illustrators, publisher) for every visible book, and
`buildFacetsFromRows()` (`searchService.ts`) computes distinct values/labels/sorting directly
from those rows. **Chosen behavior: facets reflect the full active catalog, not the
currently-filtered result set** — a teacher who has filtered to "Swedish" still sees every
other language as a choice, so switching languages doesn't require clearing filters first. An
`isDefined` guard excludes `undefined` values (incomplete metadata, §incomplete metadata) from
every facet's option list, so "Not specified" never becomes a synthetic, misleading filter
choice.

**Pagination for a free-text query.** "The database performs the limiting" refers to *candidate
bounding*, not a literal single SQL `LIMIT` on the final ranked page: each retrieval strategy in
`SearchRepository` caps how many rows it contributes (`FTS_CANDIDATE_LIMIT=150`,
`TRGM_CANDIDATE_LIMIT=80` each, `VECTOR_CANDIDATE_LIMIT=60`, `EXACT_CANDIDATE_LIMIT=30` — a few
hundred rows at most, never the full catalog), those bounded candidates are the only rows ever
projected into full `Book` objects or scored, and the final `.slice(0, limit)` for a given page
operates over that already-small, already-bounded set — never over a client-side copy of the
entire catalog. This is a deliberate, documented design choice: true SQL-side `OFFSET`/`LIMIT`
final-rank pagination isn't used because the final rank depends on the TypeScript-side hybrid
score (§9), which combines signals SQL alone can't compute; bounding candidate retrieval away
from the full catalog is what actually matters for the "never ship/score the whole catalog"
invariant, and is fully achieved. `totalQualifying` for a free-text query is therefore the
number of candidates that cleared the relevance threshold *within that bounded retrieval pool*
— a real number, but not a literal catalog-wide count, and never claimed as one (see
`SearchService.SearchResultPage`'s own doc comment).

**Pagination for queryless (filter-only) browsing is a real, bounded, database-side-ordered
page — a genuine gap fixed in the Phase 5 correction pass, not a restatement of the above.**
The original implementation's queryless path (`findCandidates()`'s empty-query branch) selected
every matching book id with no `LIMIT` at all, `SearchService` then projected *all* of them into
full `Book` objects via `getBooksByIds()`, sorted the entire set in memory by `sort_title`, and
only *then* sliced to the requested `limit` — a filter-only search, and every "Show More" click
on one, silently re-did that full unbounded retrieval and projection on every request. Fixed
with two new `SearchRepository` methods used only for this case:
`findVisibleBookIdsPage({ filters, limit })` (`ORDER BY sort_title LIMIT (limit + 1)` — one extra
row, never returned, just enough to answer `hasMore`; no `OFFSET`, since `limit` here is always
"how many total to show so far," the same increasing-bounded-limit model the with-query path
already uses for "Show More") and `countVisibleBooks(filters)` (a real `COUNT(*)` — the true,
exact total, unlike the candidate-pool-bounded number above). `SearchService.browseByFiltersOnly()`
calls both, then projects (`getBooksByIds`) *only* the bounded page's ids — never the full
matching set. Proven at a real scale (`tests/integration/db/boundedPagination.test.ts`: 300
synthetic active books sharing one category) with a `vi.spyOn(bookRepository, "getBooksByIds")`
assertion that a 5-result page calls it with exactly 5 ids (never 300), and that a 15-result
"Show More" page calls it with exactly 15 (never 300) — the actual proof, not just an inference
from the query shape.

"Show More" (`ResultsList.tsx`) triggers a real server re-search — `router.push()` to the same
Find URL with a larger `?n=` limit (`RESULT_LIMIT_STEP = 10` per click,
`INITIAL_RESULT_LIMIT = 5`, capped at `MAX_RESULT_LIMIT = 105`) — not a client-side slice of an
already-fully-fetched array. `parseLimit()` (`urlParams.ts`) clamps and defaults the `?n=` URL
parameter, so a malformed or out-of-range value in the URL degrades safely rather than crashing
or requesting an unbounded page. Result order is stable across pages (same score/tie-break
function on every request for the same query+filters), and Book Detail's `?from=` return-context
parameter is unaffected by the limit value.

## §8 — Find UX and error handling

No redesign: every existing screen and state from Phase 2–4 is preserved (empty state, zero
results, filter dialog, mobile drawer, Book Detail return context, URL-backed state). Phase 5
adds calm handling for failure modes that didn't previously exist because there was no database
or network call in the path: a database error during search, autocomplete, or facet loading
degrades to a plain "couldn't complete that search right now, try again" message — never a raw
SQL error, stack trace, or technical term (no "vector," "embedding," "cosine similarity," "SQL,"
or model id is ever shown to a teacher). A malformed URL filter value is parsed defensively and
either ignored or clamped, never allowed to crash the page (§7, `parseLimit`; see also
`lib/search/filters.ts`'s parsing).

## §9 — Layer 5: hybrid scoring

`combineScores()` (`lib/search/hybridScore.ts`) combines the unchanged Phase 2–4 deterministic
score (`scoreBook()`, `rank.ts`) with additive, capped SQL-retrieval-signal bonuses
(`RETRIEVAL_SIGNAL_WEIGHTS`, `rankingConfig.ts`):

| Signal | Weight | Notes |
|---|---|---|
| `exactRetrievalMatch` | 100 | Matches `exactTitle`'s weight deliberately — exists for cases (e.g. a bare ISBN) where the deterministic free-text pass has no field to compare a digit string against, so retrieval is the *only* place this signal exists. |
| `fullTextRank` | 30 (scaled/clamped) | `ts_rank` is small and unbounded above; scaled (`× 3`) and clamped so even an unusually high rank can't approach `exactTitle`. |
| `trigramSimilarity` | 25 | `similarity()` is already 0–1; used directly. |
| `semanticSimilarity` | 20 | `1 − cosine distance`, clamped to distances under `MAX_MEANINGFUL_VECTOR_DISTANCE` (0.30); deliberately the smallest weight — semantic retrieval is additive, never a substitute for a real keyword/structured signal. |

Every component is named and independently inspectable — there is no single opaque blended
number. Absence of a signal (not an FTS/trgm/vector candidate) contributes exactly 0, never a
fabricated placeholder. `rankScoredBooks()` filters to `score > MINIMUM_MEANINGFUL_SCORE`
(`rankingConfig.ts`) and sorts by score descending with a deterministic alphabetical
(`sortTitle`) tie-break — identical inputs always produce identical output ordering.

**The meaningful-distance ceiling, calibrated from real evidence (2026-09-17).** A cosine distance
at or above `MAX_MEANINGFUL_VECTOR_DISTANCE` contributes nothing at all — without a real ceiling
here, a barely-related book still adds a small positive number and clears
`MINIMUM_MEANINGFUL_SCORE` on pure noise. This value went through two real-provider corrections
in one validation pass:
1. The original placeholder, `1`, never actually gated anything — a live manual product check
   returned 49/49 catalog books as "matches" for a real exploratory query.
2. A first correction to `0.36` (from real cross-query distance measurements) was itself
   re-measured against a *known-item* title query and found to still let 31/49 books — almost the
   whole catalog, none thematically related — clear the ceiling, visible directly in a product
   screenshot ("35 matches" for a single-title lookup).
3. Cross-referencing three distinct real queries' full distance distributions (one known-item
   title, two exploratory themes) showed the same shape every time: a small number of genuinely
   strong matches at 0.17–0.28, then a dense, near-universal noise floor starting around 0.30–0.32
   that most of the catalog falls into regardless of actual relevance, because short
   children's-book descriptions embed into a tight region of this model's space at this catalog's
   scale. **`0.30`** is the current value — chosen to sit just below that noise floor. See
   `hybridScore.ts`'s own comment and `docs/DECISIONS.md` for the full measurement, and the
   accepted trade-off it reflects: an exploratory query whose only real catalog answer is a weak,
   semantic-only match (no deterministic keyword/tag overlap) may now surface fewer results, or
   none — not a bug, since exact/deterministic signals are designed to dominate, and every
   genuinely relevant result found during validation also carried real deterministic overlap.

**A second, independent real bug found during the same validation pass: a generic-word substring
collision.** The word "very" (not previously a stop word) is a literal substring of "every" and
"everyday" — real Gemini embeddings surfaced this concretely when the known-item query "The Very
Hungry Caterpillar" was falsely boosted by an unrelated book's "everyday life" tag and by
description text containing "every", through the tag/description matchers' intentionally loose
substring rule (§ below). Fixed by adding "very" to `STOP_WORDS`
(`lib/search/normalize.ts`) — the same fix class as "age" (inside "courage") and "day" (inside
"everyday", found and fixed for category/format matching specifically in the same pass, via a new
`containsAnyWholeWordToken()` helper used only for category/format, where a small fixed
vocabulary makes whole-word matching safe without losing tag/title/description's intentional
plural/typo tolerance — e.g. "animal" → "animals").

**Exact-known-item dominance and no padding.** An `exactRetrievalMatch` (100) or a strong
deterministic exact-title match already dominates any purely fuzzy/semantic signal by
construction (the weight table above). Weak or irrelevant candidates are never padded into a
result set to reach a target count — a real bug found in exactly this area during testing (§3:
"something to read please" incidentally matching two books through the literal word "read")
was fixed by preventing the *signal itself* from being generated for an incidental single-word
overlap (`ftsHasMeaningfulOverlap`, §3), not by inflating the score threshold, since a blanket
threshold increase would have also suppressed genuinely weak-but-real trigram typo matches
(which correctly score as low as ~0.2 similarity by design).

## §10 — Voice search parity

Voice search (`lib/voice/`, `SearchInput.tsx`) is unchanged in structure from Phase 3: a final
transcript is placed into the same query state and passed through the exact same
`navigate()` → `buildFindHref()` → `/find?q=...` → `SearchService.search()` path a typed Enter
uses. There is no voice-only semantic/LLM path, no separate ranking, and no transcript
persistence — everything in §1–§9 above applies identically regardless of whether the words
came from typing or speech.

## §11 — Evaluation

A committed, human-readable evaluation dataset and command (`npm run evaluate:search`) validate
the pipeline against known expectations, distinct from the seeded development catalog. See
`tests/evaluation/` and `docs/TESTING.md` for the exact case format and how to run it. **41
cases** (expanded from an initial 13 in the Phase 5 correction pass) across four reported
categories:

- **known_item** (11) — exact title, a title without its own leading article (proving the
  normalization fix above), a title with trailing punctuation, author, illustrator, publisher,
  ISBN-10, ISBN-13, a title typo, a contributor-name typo, and a diacritic-insensitive query.
- **structured** (14) — a primary-language native-script title query, an additional-language-only
  free-text query, an explicit language filter, two distinct explicit ages, an age-range phrase,
  and hard filters for fiction type, format, category, duration, visual realism, two illustration
  styles, and three simultaneous filters together.
- **safety** (11) — the generic-filler-query and pending/archived-exclusion regressions from the
  original 13, plus: incomplete metadata never satisfying a duration/realism/fiction-type filter
  it doesn't actually have a value for, an incompatible filter combination, a hard category filter
  never overridden by strong thematic relevance (the closest this environment can get to proving
  "hard filters never yield to semantic similarity" without a real embedding provider), an exact
  title/contributor outranking weaker matches, and an explicit case confirming the
  provider-absence fallback preserves normal conventional results.
- **exploratory** (5) — friendship/sharing, winter atmosphere, and a curriculum/concept query
  against real fixtures, plus two development-only evaluation fixtures
  (`EVALUATION_ONLY_FIXTURE_BOOKS` in `searchEvaluation.eval.ts`, inserted and removed by that
  file alone, never part of `src/db/seed.ts`) for gentle daily separation/goodbye and
  starting-school anxiety — themes the real 48-book catalog has no credible match for.

Reported per-category (recall, prohibited violations) and in aggregate (recall, top-1, **top-5**,
prohibited violations) — not one aggregate recall number alone. Results are reported honestly:
the harness's own `beforeAll` (2026-09-17 real-provider validation) now checks for a real
`GEMINI_API_KEY` and, when present, generates real embeddings for that run's own seeded+fixture
books before the cases run, printing which mode actually ran (`REAL HYBRID` vs.
`conventional-only`) in the report's final line — never silently claimed. When no key is
configured, every case still runs conventional-only and is reported as such, and deterministic
fake embeddings elsewhere in this codebase still prove storage/retrieval/scoring mechanics only,
never semantic-quality evidence. **This test issues one live query-embedding call per dataset
case (41 total) in a tight loop, and its own document-embedding generation is a further ~50-book
batch call — real API usage far denser than any real user's search pattern, and it has visibly
hit provider rate limits under repeated back-to-back runs during validation** (mitigated, not
eliminated, by `geminiProvider.ts`'s retry-with-backoff); the test's own timeout was raised to
120s to give real calls, including retries, realistic room. A genuine regression fails this suite
loudly — cases are not adjusted to make a run pass; every fix in this correction pass to a
genuinely wrong expected value (e.g. an alphabetical-tie assumption that didn't match the real
top-10) is recorded in the case's own comment, distinct from a case that exposed a real product
bug (the structured-intent-candidate regression this suite caught before it shipped in the
original Phase 5 work, and the meaningful-distance-ceiling / "very"-stop-word bugs the real-provider
validation pass caught — §9).

## Multilingual parity

The Phase 4 ISO 639-1 language registry (`lib/catalog/languages.ts`) is the single source of
truth everywhere in Phase 5 — no second/DB-backed language table was reintroduced. A book's
primary language (`books.language_code`) and its additional languages (`book_languages`) are
both searchable: free-text language-intent matching, hard filtering (§2), the embedding
document (§5), and facets (§7) all check primary-or-additional, not primary alone.

## Incomplete metadata

Fiction type, format, visual realism, and read-aloud duration are all optional
(`lib/catalog/types.ts`) — an unrecorded value is represented as `undefined`, never coerced
into a value that looks confirmed ("nonfiction," "other," "mixed," or "0 minutes"). Display
falls back to the literal string "Not specified" (`lib/catalog/labels.ts`,
`NOT_SPECIFIED`). An active filter on one of these fields never matches a book with an
unrecorded value for it (`lib/search/filters.ts`'s `orMatch`), and facets never offer a
synthetic "unknown" option (`isDefined` guard, §7). `getReadDurationBand()`
(`lib/catalog/duration.ts`) is the single canonical authority for duration bands on the
TypeScript side, mirroring the database's generated `read_duration_band` column exactly — both
return `undefined`/`NULL` for a missing estimate rather than defaulting to a band.

## Targeted single-book embedding (Phase 7)

Add a Book needs one new book's embedding immediately after it saves — not a
nightly/batch rebuild, and never a whole-catalog backfill for one book.
`src/lib/embeddings/generation.ts`'s `generateEmbeddingForBook(db, provider, bookId)`
is the targeted primitive this calls: reuses the same `buildEmbeddingDocument()`
composition every other embedding path uses, but scoped to one already-fetched
book. It never throws on provider failure — returns `{ succeeded: false, error }`
instead — because embedding failure must never block or roll back book creation
(`docs/DECISIONS.md`/`docs/AI_PIPELINE.md`: "BOOK CREATION STILL SUCCEEDS"
regardless of embedding outcome). `confirmSaveAction` calls it fire-and-forget
after the save transaction has already committed, swallowing any error — a
teacher is never shown a technical embedding failure, and the existing embedding
backfill script (`npm run embeddings:generate --mode=missing`) recovers any book
this leaves without one.

## What's deliberately not here

No generative/LLM query interpretation, no LLM-written explanations, no separate vector
database, no production search telemetry, no Google Sheets ingestion, no Admin Review
workflow changes. These were out of scope through Phase 5; Phase 7 added Google Drive as a
source-photo store (`docs/GOOGLE_INTEGRATION.md`) and the targeted embedding call above, but
did not otherwise change this document's search/ranking architecture. See
`docs/IMPLEMENTATION_STATUS.md` for the phase roadmap.
