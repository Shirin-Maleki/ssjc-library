# Search

Status: Phase 2 — a real, deterministic (no AI) search/ranking engine, built and tested
against a development fixture catalog. This is the subsystem Phase 5 will extend with real
database queries and, optionally, an embeddings-based semantic layer — the interfaces
documented here (`searchBooks`, `Filters`, `SearchResult`) are the seam that stays stable
across that change.

## Pipeline

```
Teacher query + selected filters
        │
        ▼
matchesFilters()  — hard AND/OR constraints (lib/search/filters.ts)
        │
        ▼
rankBooks()  — scores the filtered set against the free-text query (lib/search/rank.ts)
        │        ├─ exact/prefix/partial title matching
        │        ├─ author / illustrator / publisher matching (whole-name, see below)
        │        ├─ category / tag / description keyword matching
        │        ├─ format / fiction-type keyword matching
        │        └─ structured intent bonuses (age, duration, realism, language,
        │           illustration style) — see lib/search/intent.ts
        ▼
buildMatchExplanation()  — a grounded sentence from the fields that actually matched
        ▼
searchBooks()  — the single entry point the UI calls (lib/search/searchBooks.ts)
```

**Filters are hard constraints; free-text query signals are ranking-only.** This is the one
rule that resolves most of the design: a book excluded by an explicit filter selection never
appears, no matter how well it matches the typed query; a book that merely fails to match a
*parsed* signal from free text (e.g. an age mentioned in the sentence) can still appear,
just ranked lower. "Filters act as explicit constraints. Text-query signals determine
relevance/ranking among eligible books" is enforced structurally by `searchBooks()` running
`matchesFilters` first and `rankBooks` only on what survives.

## Meaningful matches, not padded results

`rankBooks` excludes any book scoring at or below zero — there is no minimum result count. A
query built entirely from generic words ("something to read please") normalizes to zero
meaningful tokens and returns zero results, by design (see "Real bugs found by testing"
below for why generic words are excluded, not just deprioritized). Browsing by filters alone,
with an empty query, returns every book that passes the filters, sorted alphabetically by
`sortTitle` — there's no query-relevance score to sort by, so alphabetical is the honest
default rather than an arbitrary one.

## Ranking weights — one file, `lib/search/rankingConfig.ts`

Every numeric weight lives there and only there. Roughly: exact title match > title
prefix/partial > author/illustrator/publisher/category/tag/language-intent/age-intent/
illustration-style-intent/visual-realism-intent/duration-intent (all "strong," deliberately
close in weight) > format/fiction-type ("medium") > description keyword (a weak supporting
signal, since it's the least precise: a plain substring match against free descriptive
prose). If a result ordering ever looks wrong, this file is the first place to check.

## Named-entity matching: whole name, not any shared word

Author/illustrator/publisher matching requires every word of the entity's own name to appear
among the query's tokens (`matchesWholeEntityName` in `rank.ts`) — not "any single token in
common." This was a real bug caught by testing against the actual fixture catalog: an
any-token-in-common rule made "books by Eric Carle" also match "Eric Hill" (a different
author, sharing only the first name). Title, tag, and category matching intentionally keep
the looser any-token/substring rule, since partial keyword matches are exactly what's wanted
there (e.g. "animal" should match the tag "animals").

## Structured intent from free text (`lib/search/intent.ts`)

A handful of real phrasings, not general NLP:

| Intent | Recognizes | Example |
|---|---|---|
| Age | `age N`, `N year(s) old`, `N-year-old`, word numbers | "for a 4-year-old" |
| Duration | `short`/`quick`, `longer`/`10+`, an explicit `N minute(s)` (resolved through the *same* `getReadDurationBand` function real durations use, so "5 minute" and a book that takes 5 minutes always agree) | "a 5 minute read" |
| Visual realism | "real photo(s)/photograph(s)/pictures" → real photography specifically; bare "realistic" → real photography *or* realistic illustration (broader, since "realistic" isn't as precise a claim as "real photos") | "real photographs of animals" |
| Language | any catalog language's English display name, as a whole word | "a Swedish book" |
| Illustration style | a style label matched as a whole phrase (never a single word within it — see below) | "watercolor books" |

**Why illustration-style matching requires the whole phrase:** the label "Digital
illustration" is two words; matching on either word alone meant the generic word
"illustration" (which could appear in any casual phrasing about a picture book) falsely
implied "Digital illustration" specifically. Fixed to match the full label as one phrase.

## Stop words (`lib/search/normalize.ts`)

A short, reviewable list — generic words (`book`, `story`, `please`, `want`, …) that must
never by themselves justify a result. It also includes the scaffolding words around a
recognized intent phrase (`age`, `year`, `old`, `minute`) once that phrase's actual signal has
already been extracted by `intent.ts` — leaving them in the free-token pool caused a real bug:
`age` is a substring of `courage`, so "friendship for **age** 4" was silently boosting any
book merely tagged "courage." Diacritics are stripped before matching (`stripDiacritics`) so
an unaccented query still finds accented Scandinavian/Spanish/French titles and tags — "ø"
and "æ" needed an explicit substitution, since (unlike "å" or "é") they have no Unicode
decomposition to strip via the general accent-folding step.

## Autocomplete (`lib/search/autocomplete.ts`)

Entirely derived from the catalog passed in at call time — titles, contributors, publishers,
categories, tags, languages, illustration styles — never a second, separately maintained
list. Prefix matches rank above substring matches; results are capped (default 8); nothing is
shown for a query under 2 characters.

## Facets (`lib/search/facets.ts`)

The Filters dialog's option lists (which languages, formats, authors, etc. appear as
choices) are computed from the books actually present, the same "no second hidden list" rule
autocomplete follows — a format with zero fixture books simply isn't offered as a filter.

## URL-backed search state (`lib/search/urlParams.ts`)

Query and every filter group round-trip through the URL (`/find?q=...&age=...&lang=...`), so
browser Back/Forward, refresh, and sharing a specific search all work without any client-side
global state store. The Find page itself is a Server Component that reads `searchParams`
directly and calls `searchBooks()` server-side; `SearchInput`, `FilterDialog`, and
`CategoryQuickPills` are the only client components, and their only job is computing the next
URL and navigating — they never hold "the current results" as client state themselves.

Book Detail preserves return context via an explicit `?from=` parameter carrying the exact
Find URL the teacher came from (validated to start with `/find` before being trusted as a
back-link target) — chosen over relying on browser history alone, since it's deterministic
and reliably testable, and the brief itself allows "a simple, maintainable" approach over "an
elaborate custom routing system."

## Real bugs this phase's testing caught (not hypothetical)

1. **"Eric Carle" also matched "Eric Hill"** — any-shared-word matching on a two-word name
   was too loose. Fixed by requiring the whole name (see above).
2. **"friendship for age 4" boosted books tagged "courage"** — `age` is a substring of
   `courage`; the leftover scaffolding word from a recognized age phrase was still in the
   free-token pool. Fixed by stop-wording it.
3. **A stylized fairy tale (The Gruffalo) matched "books with real photographs"** — its
   description happened to contain the word "real" in unrelated prose ("until it turns out to
   be real"). Fixed by rewording the fixture description, not the algorithm — this is a
   correct, if blunt, limitation of substring-based description matching (the lowest-weighted
   signal for exactly this reason), not a ranking bug.
4. **`normalizeSearchText("Frøet")` produced `"fr et"`, not `"froet"`** — "ø" and "æ" have no
   Unicode canonical decomposition (unlike "å" or "é"), so the generic NFD-based accent-strip
   silently treated them as punctuation and replaced them with a space, splitting the word.
   Fixed with an explicit substitution before the general step.

All four are covered by regression tests in `tests/unit/search/` and
`tests/unit/catalog/age.test.ts` / `duration.test.ts` so they can't silently reappear.

## What's deliberately not here yet

No AI, no embeddings, no semantic search, no LLM query interpretation — Phase 2 is
explicitly deterministic. No real database — `lib/catalog/fixtures.ts` is a development-only
array (see its own header comment). No voice input. These all land in later phases per the
approved roadmap (`docs/IMPLEMENTATION_STATUS.md`).
