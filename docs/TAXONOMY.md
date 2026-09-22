# Taxonomy: physical categories and their operational lifecycle (Phase 8)

## The core product principle

The current `physical_categories` rows (8 development categories, seeded for
Phase 2 and never revisited) are **provisional development taxonomy, not the
school's confirmed shelving system.** Phase 8 makes that taxonomy operationally
*manageable* — an admin can rename, describe, activate/deactivate, and create
categories, and can review AI-surfaced taxonomy pressure — but it does not decide
what SSJC's real ~1,500-book collection should actually be organized into. That is
explicitly Phase 11's job, informed by the real collection, not the 48-book
development seed.

**The Phase 8 story, precisely:** the system can surface taxonomy pressure (via
`taxonomy_suggestions`), but AI never reorganizes the library. A human
administrator reviews the evidence and controls every physical shelving change —
creating a category, renaming one, deciding a suggestion's fate. Do not read
anything in this phase as "AI discovered the school's final shelving system"; it
did not, and nothing in Phase 8 claims otherwise.

## Stable identity vs. display label

- `physical_categories.id` (uuid) is the real relational identity — `books.physical_category_id`
  references it, permanently, for the life of the row.
- `physical_categories.slug` is the stable, URL-facing identifier (`/find?category=animals-nature`),
  generated once at creation (`src/lib/admin/categorySlug.ts`) and never regenerated.
- `physical_categories.label` is the only thing a rename (`updateCategory()`) ever
  changes. Renaming "Animals & Nature" to something else never touches `id` or
  `slug`, and every existing FK/URL/link referencing this category keeps working
  unchanged.

A brand-new category's slug is generated from its label at creation time
(`generateUniqueCategorySlug`) — lowercased, hyphenated, diacritics stripped, with
a numeric suffix only on an actual collision. A slug is never reused, even for a
deactivated category (its slug still counts as a collision against a future new
category with a similar name).

## Category lifecycle

- **Create** (`createCategory()`): an explicit admin action only. AI never creates
  or activates a category on its own — see "Taxonomy suggestions" below.
- **Rename / edit guidance** (`updateCategory()`): presence-based patch — label,
  `description` (optional shelving guidance text), and `display_order` (a plain
  sort hint) can each be changed independently. A label change rebuilds
  deterministic `search_text` for every book currently in that category (see
  `docs/SEARCH.md` and `docs/DECISIONS.md`'s Phase 8 entry) and attempts a
  targeted embedding refresh afterward — never blocking the rename itself.
- **Deactivate** (`setCategoryActive(..., false)`): blocked while ANY non-archived
  book (`active` or `pending_review`) still references the category — the exact
  rule the phase brief recommends: "Do not deactivate a category while
  non-archived books still reference it." The admin sees the real referencing
  count and must re-categorize those books first. No book's
  `physical_category_id` is ever silently orphaned.
- **Activate**: unrestricted — reactivating a retired category is always safe.
- **No deletion.** Categories are never hard-deleted; deactivation is the
  reversible safety mechanism.

## Category health

`src/lib/admin/categoryHealth.ts`'s `listCategoriesWithHealth()` computes, from
real database counts only (never an inferred "quality score" or an AI opinion
about whether a category is "too broad"):

- active book count per category,
- pending-review book count per category,
- whether the category can currently be safely deactivated.

## Taxonomy suggestions — full lifecycle

`taxonomy_suggestions` rows move through exactly one of:

| Status | Meaning |
|---|---|
| `pending` | Awaiting an admin decision. |
| `approved` | An admin confirmed (and could have edited) the label/guidance, and the admin action created a brand-new `physical_categories` row — recorded on `resolved_category_id`. |
| `rejected` | An admin decided this concept doesn't warrant a category at all. |
| `postponed` | Not decided now; left for later reconsideration. |
| `merged` | An admin decided this concept belongs under an EXISTING category — recorded on `resolved_category_id`, which points at that existing category, not a new one. |

**The human gate is structural, not just a UI convention:** `approveTaxonomySuggestion()`
and `mergeTaxonomySuggestionIntoCategory()` are the only code paths that ever write
a new `physical_categories` row or move a suggestion into `merged`/`approved`
status — both require an explicit admin-supplied (and, for approval, admin-confirmable/editable)
label. No code path exists that an AI/system process could call unattended to create or
activate a category.

**Merging a suggestion into an existing category never moves any book.** It
records that the SUGGESTED CONCEPT doesn't deserve its own category and instead
belongs conceptually under an existing one — it is not a request to re-shelve any
already-catalogued book, and no book's `physical_category_id` changes as a result.

## What Phase 8 explicitly does not do

- **No real collection-wide taxonomy analysis.** Phase 8 never runs Gemini (or any
  provider) against the actual catalog to generate taxonomy suggestions. Any
  suggestion rows used for development/testing are disposable test fixtures
  (`tests/integration/db/adminReview.test.ts`), never presented as AI discoveries
  from a real collection, and never seeded into the normal development catalog as
  if they were.
- **No existing-category merge engine.** Merging two already-populated real
  categories (moving every book between them) is deliberately deferred — see
  `docs/DECISIONS.md`.
- **No taxonomy finalization.** Phase 8 does not attempt to determine SSJC's real
  final shelving system. That is Phase 11's explicit scope, informed by the real
  ~1,500-book collection.
