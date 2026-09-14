# Architecture

Status: Phase 0 — proposed architecture, not yet implemented. Nothing in this document has
been built. This is the design that Phase 1 onward will implement incrementally, and that a
technical reviewer should sanity-check before implementation starts.

See [`docs/DECISIONS.md`](DECISIONS.md) for the reversible-decision write-up behind each
major choice below, and [`docs/DATA_MODEL.md`](DATA_MODEL.md) for the full schema.

## 1. High-level shape

```
Google Drive (original cover photos, source of truth for images)
        │
        ▼
   Ingestion pipeline (single add + bulk import share this)
        │
        ▼
Postgres / Supabase  ◄────────────────────────►  Next.js application (staff + admin UI)
   (canonical data)                                        │
        │                                                   │
        ▼                                                   ▼
Google Sheets (generated, read-only            Object storage (display-optimized
 teacher projection — never canonical)          cover images, derived from Drive originals)
```

Postgres is the single source of truth for catalog data. Google Drive is the source of truth
for original cover images. Google Sheets is a **derived projection**, regenerated from
Postgres, never edited back into it. The Next.js application is the only interaction layer.

## 2. Frontend architecture

- **Framework:** Next.js (App Router), React, TypeScript, Tailwind CSS — as preferred in the
  brief, and appropriate given this is a from-scratch project (no existing stack to preserve).
- **Rendering model:** Server Components for anything data-heavy and read-mostly (search
  results, book detail, admin queues) to keep the client bundle small and avoid shipping
  catalog data unnecessarily to the browser. Client Components only where interaction demands
  it: camera capture, voice input, autocomplete-as-you-type, filter panels, multi-step Add-a-
  Book wizard state.
- **Mutations:** Next.js Server Actions for all writes (create book, confirm/quick-edit/
  review-later, create/edit reading lists, admin edits) instead of a hand-rolled REST API —
  less boilerplate, logic stays co-located with validation, and it's still trivial to add
  Route Handlers (`app/api/*`) where something needs a real HTTP endpoint (OAuth callback,
  Sheets-sync trigger, a cron target).
- **Component primitives:** Radix UI primitives (unstyled, fully accessible — dialogs,
  comboboxes, tabs, popovers) styled with Tailwind, rather than a heavy pre-styled component
  library (MUI/Chakra/Ant). This keeps full control over the "calm, editorial, Scandinavian"
  visual direction while getting keyboard navigation, focus management, and ARIA semantics
  correct for free — directly serving the accessibility requirement.
- **State management:** no global state library. Server state comes from the server
  components/actions; the small amount of client-only state (wizard step, camera blob, voice
  transcript, filter selections before submit) lives in local component state/`useReducer`.
  Introducing Redux/Zustand for this app's actual complexity would be over-engineering.
- **Images:** `next/image` throughout, sourced from the display-optimized object storage
  copy (§6), never directly from Drive.
- **Fonts:** Poppins via `next/font/google`, weights 400/500/600/700 only, self-hosted by
  Next.js's font optimizer (no external font-loading waterfall, no layout shift).
- **Routing/access:** route groups separate public (`/`), staff (`/home`, `/find`, `/add`,
  `/lists`, `/guide`), and admin (`/admin/*`) areas; `middleware.ts` enforces session
  requirements before any protected route renders.

## 3. Backend / server architecture

No separate backend service. Next.js Server Actions + Route Handlers are the entire server
layer, which is appropriate at this traffic scale (a single school library) and avoids
standing up infrastructure that would need its own deployment, monitoring, and auth story.

Route Handlers are used specifically where something isn't a form submission from the current
page: the Google OAuth redirect callback, a Sheets-sync trigger callable from a cron job, and
(if built in Phase 3) a server-side speech-to-text fallback endpoint.

**Data access layer:** a single `lib/db` module wrapping [Kysely](https://kysely.dev/), a
type-safe SQL query builder — not an ORM. Kysely generates plain parameterized SQL from
TypeScript types derived from the actual schema, which keeps the codebase honest about what
queries run, avoids ORM "magic" that obscures N+1s, and keeps us portable to any Postgres
host (no Prisma-schema DSL to migrate away from later). See
[`docs/DECISIONS.md`](DECISIONS.md) for the alternative considered (Prisma).

**Migrations:** plain, numbered `.sql` files under `supabase/migrations/`, run via the
Supabase CLI. This is functionally "just SQL migrations," not a proprietary Supabase feature
— the same files would run against any Postgres instance with `psql` or another migration
runner, preserving portability if we ever move off Supabase.

## 4. Canonical database

**Postgres, hosted on Supabase**, as the brief prefers, chosen for: mature managed Postgres,
a connection pooler that matters for serverless (see §12 risk notes), pgvector support
without extra setup, and a generous-enough free tier for development.

**Portability stance:** we deliberately avoid binding business logic to Supabase-only
features. Concretely:

- No Supabase Auth — our two-password/session model is hand-rolled (§10) and would move
  unchanged to any host.
- No Supabase Row-Level-Security as the *only* access control — the app enforces
  authorization server-side; RLS may be layered on defensively later but is not load-bearing.
- No Supabase Storage for the canonical images — Drive is canonical, and the display-copy
  store (§6) is chosen independently of Supabase.
- Schema, migrations, and queries are all standard SQL/Postgres, runnable against Neon, RDS,
  Railway, or a self-hosted instance with no code changes beyond a connection string.

**pgvector** is enabled for semantic search (§7) rather than introducing a separate vector
database, per the brief's explicit preference — see [`docs/DECISIONS.md`](DECISIONS.md).

## 5. Relational data model

Full schema in [`docs/DATA_MODEL.md`](DATA_MODEL.md). Summary of the modeling approach:

- **Books** carry their own scalar attributes (title, age range, language, description,
  duration, format, physical category, etc.) plus a small set of "current value" fields that
  are inherently 1:1 (visual media type, visual realism) directly as columns — not split into
  needless side tables.
- **Contributors** (authors/illustrators/photographers/translators) are normalized into their
  own table with a join table carrying role, instead of comma-separated text — this is what
  makes "books by Eric Carle" a real, reliable, autocomplete-able query rather than a string
  match.
- **Tags** are many-to-many by design (a book may carry many digital tags), typed (topic,
  theme, social-emotional, curriculum, visual-subject, seasonal, featured, concept), and
  normalized to control near-duplicate proliferation.
- **Physical categories** are a real, admin-managed table — never an application constant —
  satisfying the requirement that AI can never invent one and admins can evolve the list.
- **Provenance and confidence are unified** into one generic table
  (`book_field_status`) keyed by book + field, rather than one-off columns per field or a
  single meaningless overall percentage. This is what lets the admin UI render "this value
  came from Google Books / this value was AI-inferred at medium confidence / this value was
  human-verified" generically for any tracked field, and lets confidence route to different
  teacher/admin behavior per domain (identity, physical category, duplicate, visual style,
  age, duration) as the brief requires.
- **Duplicates** are modeled as candidate *relationships* between two book rows
  (`book_duplicates`), not a boolean flag — preserving the brief's distinction between exact
  copy (same record, incremented `copy_count`), different edition, different-language same
  work (separate records, optionally linked via `work_groups`), and false match.
- **Ingestion** (`ingestion_jobs` / `ingestion_items`) is one shared pipeline used by both the
  single "Add a Book" flow and the bulk-import engine — same states, same idempotency
  guarantees, so bulk import is not a separate, less-tested code path.
- **Reading lists** are intentionally minimal — no ownership, no permissions — matching the
  "no accounts" requirement exactly.
- **Audit log** covers only admin-level structural/destructive actions (category
  merge/deactivate, book deletion, duplicate resolution, taxonomy decisions) — not a full
  event-sourcing system, per the brief's explicit caution against overbuilding this.

## 6. Google Drive integration

**Two distinct needs** exist and are treated distinctly:

1. Reading the pre-existing ~1,500-photo folder (bulk import source).
2. Writing new cover photos going forward (single Add-a-Book uploads).

**Authentication strategy (recommended, pending real-folder inspection in Phase 6):**
OAuth 2.0 acting on behalf of the school's designated Google account, rather than a service
account. Reasoning: a service account has no Drive storage quota of its own and can only act
on files/folders explicitly shared with its own robot email address — workable, but it
requires someone at the school to manually share folders with an unfamiliar email address,
and it behaves differently depending on whether the existing folder lives in an ordinary
personal My Drive versus an organizational Shared Drive. OAuth-on-behalf-of-the-real-account
works uniformly for both cases and matches how a non-technical stakeholder already thinks
about "my Google Drive." The concrete choice will be confirmed once we actually inspect the
target folder in Phase 6 — if it turns out to be an org-controlled Shared Drive with an admin
willing to grant a service account Editor access, that's a lower-maintenance alternative
(no refresh-token lifecycle to manage) worth revisiting then. This is intentionally left
**configurable**, not locked, in Phase 0.

**Scopes:** least-privilege. Preferred approach is the Google **Picker API**, which lets an
admin explicitly pick the existing photo folder and the new-upload target folder once, granting
the app `drive.file`-scoped access to exactly those folders — without requesting broad
read/write access to the account's entire Drive. If Picker integration proves too complex to
justify in Phase 6, the documented fallback is requesting a broader Drive scope and having
the admin paste folder URLs directly (the app extracts the folder ID from the URL) — simpler
to build, less private. Final call and rationale get logged in `docs/GOOGLE_SETUP.md` once
built.

**Setup instructions:** `docs/GOOGLE_SETUP.md` will be created in Phase 6 with exact,
non-technical, click-by-click steps (Cloud Console project, API enablement, credential type,
redirect URI, environment variables, folder authorization, and a `npm run google:authorize`
helper script to avoid manual token handling). Not created yet — not relevant until Phase 6
per the brief's own "don't create placeholder docs" instruction.

**Folder structure** (adapted from the brief, minimal nesting):

```
Library Catalog/
  Incoming/         new teacher-captured photos awaiting processing
  Book Covers/      archived originals for confirmed books
  Needs Review/      images that couldn't be auto-processed
  Import Archive/    reference to the pre-existing bulk-import source folder
```

The pre-existing ~1,500 photos are **referenced in place** (by Drive file ID) rather than
physically moved/reorganized during import — moving thousands of files in someone else's
Drive structure is a real risk we shouldn't take without being asked. Whether the school
wants that folder tidied up afterward is a legitimate future product question, not a Phase 0
blocker.

**Per-file record:** Drive file ID, source folder ID, filename, MIME type, ingestion
timestamp, and processing state are all tracked (`ingestion_items`, `books.cover_drive_*`) —
see [`docs/DATA_MODEL.md`](DATA_MODEL.md).

**Image display strategy:** private Drive URLs are never exposed to the browser. Recommended
approach: at ingestion time, after the original is archived to Drive, generate a
web-optimized display copy (resized, WebP) and store it in a fast object store (Supabase
Storage — reusing infrastructure we already have rather than adding a fourth vendor).
`books.display_cover_url` points at that derived copy; Drive stays the authoritative
original-quality archive, exactly parallel to how the Google Sheet is a derived projection of
Postgres. A server-side proxy route that streams the Drive file per request was considered
and rejected as the primary approach because it adds per-request Drive API latency/rate-limit
exposure for something (rendering a search results grid) that needs to be fast; it remains a
documented fallback if object-storage setup proves impractical during Phase 6.

## 7. Google Sheets synchronization (teacher catalog)

Sheets is a **read-mostly projection**, regenerated from Postgres; it is never treated as
canonical and teacher edits to it are not synced back (if two-way editing is ever wanted, the
brief requires that to be built as explicit, deliberate reconciliation logic — not silently).

- **Auth:** a Google **service account** — unlike the Drive case, this direction is simple:
  either the service account creates the spreadsheet itself, or (preferred, so the file
  visibly lives in the school's own Drive rather than an account they don't have access to)
  an admin creates a blank sheet and shares Editor access with the service account's email.
  No OAuth-on-behalf-of-a-human needed for this half of the Google integration.
- **Stable row identity:** column A holds a hidden `book_id` (UUID), which sync uses to
  match/upsert rows; the range is marked protected via the Sheets API so a teacher can't
  accidentally edit it.
- **Sync model:** incremental — a Server Action write that changes a teacher-visible field
  performs the Sheets API upsert as an immediate side effect (tracked via
  `book_sheet_sync.sync_status`, retried on failure); an Admin "Sync Now" button and a full
  reconciliation function (rebuilds the whole sheet from Postgres truth) exist as a safety net
  against drift or a missed sync. At this traffic volume (a handful of books changed per
  week), a job queue/worker system would be overbuilt — the synchronous-write-then-retry
  approach is sufficient. A daily scheduled reconciliation (Vercel Cron, or a GitHub Actions
  cron calling the reconciliation route if we stay on Vercel's Hobby tier, which limits cron
  frequency) is recommended as a cheap unattended safety net — confirmed in Phase 9.
- **Archival:** a book that becomes inactive/archived has its row removed from the sheet
  (not soft-hidden) — safe because full reconciliation can always rebuild the sheet from
  scratch, so nothing is actually lost by keeping the projection lean.

## 8. AI provider abstraction

All AI functionality sits behind small provider interfaces so no UI or business-logic code
calls a vendor SDK directly, and swapping providers later touches one adapter, not the app:

- `VisionProvider.identifyCover(image)` — extracts only what's actually visible (title,
  author, subtitle, language cues, visual characteristics). Never asked to invent ISBN,
  publisher, publication year, or edition.
- `LLMProvider.generateStructured<T>(prompt, schema)` — a single structured-output entry
  point (schema-validated via Zod) used for description generation, tag assignment, physical
  category suggestion, and query interpretation. Anything that fails schema validation is
  retried once, then routed to review rather than trusted.
- `EmbeddingProvider.embed(text)` — one function, swappable model/provider.
- `SpeechToTextProvider.transcribe(audio)` — only relevant as a fallback; the browser's Web
  Speech API is primary and needs no provider at all.
- `BookMetadataProvider.search(query)` — see §9.

Every interface has a **mock implementation** returning deterministic fixture data, selected
via `MOCK_AI=true` / `MOCK_GOOGLE=true`. This is the default in development and required for
the test suite, so the app is fully exercisable without any paid API key.

**Concrete provider recommendation (not locked — a real product decision for you, not an
engineering detail I should silently decide):** Anthropic Claude for vision + structured
LLM output (strong schema-constrained generation, capable vision input), and a low-cost
embeddings model (e.g., an OpenAI small embedding model — embeddings are commodity and can
come from a different vendor than the main LLM without issue) for semantic search. **What
actually gates Phase 5/7 is which provider(s) you hold billing/API-key access to** — a
ChatGPT/Claude/Gemini consumer subscription does not itself grant API access. This is
flagged as a genuine pending input, not assumed.

## 9. Book metadata provider abstraction

Two providers behind `BookMetadataProvider`, queried together and reconciled rather than
trusting either blindly:

- **Open Library** — free, no key required, uneven coverage for picture books.
- **Google Books API** — free tier with a simple API key, generally richer metadata and
  cover thumbnails for children's books.

**Reconciliation order:** exact ISBN match (highest confidence) → high title+contributor
string-similarity match → lower-confidence fuzzy match, otherwise left unidentified and
routed to review. All raw candidates considered are stored (`book_identity_candidates`) for
transparency/audit, and provider responses are cached by normalized query
(`metadata_provider_cache`) to control both API cost and bulk-import runtime. Long publisher
descriptions are never copied verbatim into the product — the app always generates its own
concise 1–2 sentence description from grounded, reconciled fields.

## 10. Cover identification & enrichment pipeline

Shared by both single Add-a-Book and bulk import:

1. Validate the image (type/size).
2. Upload the original to Drive; create an `ingestion_items` row (`pending`).
3. Compute content hash + perceptual hash.
4. Check for an image-level duplicate (§11) — skip straight to the duplicate-decision UI if a
   confident match is found, avoiding unnecessary AI spend.
5. `VisionProvider.identifyCover()` — visible title/author/language cues only.
6. `BookMetadataProvider.search()` using those cues; reconcile candidates (§9).
7. Catalog-level duplicate check (§11) against the reconciled identity.
8. Generate description, assign tags, classify visual media/realism (marked
   `cover_inferred` — a front cover cannot prove interior style, and this is never
   represented as certainty), infer age range and read-aloud duration (preferring real
   provider data like page count over AI estimation, and marking AI-derived values as
   estimated).
9. Suggest exactly one existing physical category, or leave it unset with a
   `category_uncertain` review flag if confidence is below a configurable threshold — never
   inventing a new category.
10. Compute and store per-domain confidence (`book_field_status`).
11. Present the teacher confirmation screen with the assembled record.

Meaningful progress messages (per the brief's examples — "Uploading cover… Identifying
book… Checking library… Finding book information… Preparing category…") are shown throughout;
the teacher is never left on a blank spinner.

## 11. Duplicate detection

**Image-level (before any AI spend):** SHA-256 content hash for exact re-uploads; a
perceptual hash for near-duplicate photos of the same physical cover (different angle/
lighting). A confident image-level match short-circuits straight to a duplicate-decision UI.

**Catalog-level (after identification):** ISBN-13 exact match (strongest signal) → normalized
title + contributor overlap via Postgres trigram similarity (`pg_trgm` — no external
fuzzy-matching service needed at this scale) → cover perceptual-hash similarity as a
corroborating signal. Combined signal strength is stored as `book_duplicates.similarity_score`
and determines whether the "This book may already be in the library" prompt appears.
Multiple photographs of the same cover are never inferred to mean multiple copies without a
human decision.

**Resolution outcomes** map directly to the brief's UI: *Add another copy* (increments
`copy_count` on the existing record, no new row), *Different edition* (new record, optionally
linked via `work_group_id`), *Not a match* (dismiss the candidate), *Review later* (defer).

## 12. Hybrid natural-language search architecture

```
Teacher query (typed or voice-transcribed)
        │
        ▼
LLM query interpretation → structured constraints (Zod-validated)
        │                         │
        │                         ▼
        │                 SQL filtering (age overlap, language, fiction status,
        │                  format, visual attributes, named category/contributor)
        │                         │
        ▼                         ▼
Semantic remainder ──► query embedding ──► pgvector cosine similarity over
(vague theme/mood/                          filtered candidates
teaching-context intent)
        │
        ▼
Composite ranking: exact-match score + filter score + semantic score +
                   age-fit score + visual-match score + duration-fit score
        │
        ▼
Top 5, with a grounded explanation per result built by templating the
attributes that actually matched (never a free-form LLM explanation)
```

Deterministic matching (exact title/author/publisher/ISBN/language/category/hard filters)
always runs as real SQL against real columns — the LLM is only responsible for turning fuzzy
natural language into structured constraints, never for deciding which books exist.
Full-text search uses Postgres native `tsvector`/`tsquery` plus `pg_trgm` for typo tolerance;
no external search engine (Elasticsearch/Algolia) is justified at ~1,500–3,000 rows.

Autocomplete is a separate, simpler, indexed `ILIKE`/trigram query directly against real
column values (titles, contributors, publishers, categories, tags, languages, formats),
debounced client-side, with a `suggestion_type` for grouping — never a hard-coded list.

## 13. Embeddings / pgvector decision

**Yes, use pgvector**, directly in the same Postgres database — this is exactly the case the
brief calls out for it (vague/emotional/teaching-context queries) and avoids standing up a
separate vector database, which the brief explicitly discourages. At the collection's actual
scale (~1,500–3,000 rows), brute-force cosine similarity needs no ANN index (ivfflat/hnsw);
an index becomes worth adding only if the catalog grows into the tens of thousands.

Embedding input is a deterministic, documented template (title + description + tag values +
physical category name), computed once and only recomputed when that source text actually
changes — tracked via a source-text hash (`embedding_source_hash`) so unchanged records are
never needlessly re-embedded. The embedding dimension/model is intentionally **not locked** —
it depends on which embedding provider is selected (§8), and changing it later requires a
migration plus a full re-embed, so the concrete choice is deferred as long as reasonably
possible (see [`docs/DECISIONS.md`](DECISIONS.md)).

## 14. Staff / admin authentication & session architecture

No individual accounts anywhere — this is a deliberate, explicit product decision, not a
missing feature. Two shared secrets:

- `STAFF_PASSWORD_HASH` and `ADMIN_PASSWORD_HASH` — bcrypt hashes stored as environment
  variables, never plaintext, never in the database.
- On successful staff password entry, the server sets a signed, HTTP-only, `Secure`,
  `SameSite=Lax` session cookie (via a sealed-cookie approach such as `iron-session`, or a
  `jose`-signed JWT) carrying only `{ role: "staff", issuedAt }` with a sliding expiry
  (e.g., 12–24h) — no server-side session table needed, since there is no per-user state to
  store.
- Admin unlock requires an active staff session **plus** the separate admin secret; it upgrades
  the same cookie to `{ role: "admin", issuedAt }`. Staff-only access can never reach admin
  routes/actions — enforced in `middleware.ts` and re-checked at the Server Action level (not
  just at the route boundary), so a client can't bypass it by calling an action directly.
- Basic brute-force resistance: a small Postgres-backed `login_attempts` table throttles
  repeated failed attempts per IP (hashed, not stored raw) and role, rather than an unlimited
  retry surface. Given the school's actual traffic, this is intentionally lightweight — not a
  dedicated rate-limiting service.

## 15. Image storage / display strategy

Covered in §6. Summary: Google Drive = canonical original archive; a fast object store
(Supabase Storage) = derived, display-optimized copies (`next/image`-served, resized/WebP,
generated at ingestion time) that the app actually renders. Two derived sizes are generated
per cover: a small thumbnail for search-result grids and a larger version for book detail —
avoiding shipping full-resolution photos into a results list.

## 16. Bulk-import architecture (~1,500 existing photos)

Built as a genuine, reusable, resumable system from the start — not a one-off script — sharing
`ingestion_jobs`/`ingestion_items` with the single-add flow (see §5, §10):

- **Idempotency:** every source image is identified by Drive file ID; a completed or
  explicitly skipped item is never reprocessed.
- **Batching:** admin-configurable batch size (default small, e.g. 10) with delay/backoff
  between batches, both to respect Drive/AI provider rate limits and to control cost.
- **Resumability:** a job can be paused and resumed; re-running only touches items still
  `pending` or `failed` under a retry cap, after which they're marked permanently `failed`
  and remain visible/traceable — never silently dropped.
- **Full automation per item** (no teacher in the loop during bulk import) — but the exact
  same confidence thresholds route uncertain items to `needs_review` rather than guessing,
  and the exact same duplicate logic applies.
- **Multiple-books-in-one-photo:** if vision identification signals multiple distinct covers
  or conflicting/ambiguous title signals, the item is marked `needs_review` with reason
  `multiple_books_or_ambiguous_image` — never resolved by silently picking one.
- **Staged rollout is enforced by the phase plan itself**, not left to discipline alone:
  Phase 10 builds and smoke-tests the engine on a handful of items; Phase 11 explicitly runs
  ~20–30 then ~100–150 as a taxonomy research batch before Phase 12 (only after separate
  approval) runs the remaining collection in tracked batches.

## 17. Taxonomy architecture

`physical_categories` is a real, admin-managed table (create, rename, deactivate — never a
hard delete that would orphan books; enforced by a foreign-key restrict plus an
application-level check requiring reassignment first). AI always selects among *existing*
active categories for a book; it never creates one. Taxonomy gaps are surfaced via an
**admin-triggered** (not continuous/automatic) analysis that clusters books with low
category confidence or no category by semantic similarity and tag overlap, proposing a
named category with supporting evidence (`taxonomy_suggestions` /
`taxonomy_suggestion_evidence`) for the admin to approve, reject, merge, or postpone —
approval is the only path that actually creates a category or reassigns books, and even then
requires the admin action, never happening as a side effect of the analysis itself.

**Category health** (size, share of collection, low-confidence rate, heterogeneity, frequent
recategorization) is computed on demand from existing tables (book counts, `book_field_status`
confidence, `audit_log` recategorization history) rather than maintained as a separate stored
table that could drift — with thresholds held in a small configurable key/value settings
table (§18), never hard-coded.

## 18. Confidence architecture

Confidence is tracked per domain (identity, physical category, visual media/realism, age,
duration, description/language/contributor provenance) via `book_field_status`, never
collapsed into one meaningless overall percentage. A small `system_settings` table holds
per-domain thresholds (e.g., "physical category: high ≥ 0.8, low < 0.5") that map a numeric
score to a practical behavior: **high** → teacher can confirm quickly with no warning;
**medium** → a visible warning and an easy path to Review Later; **low** → routed straight to
admin review. Thresholds are centralized and configurable, never scattered as magic numbers
through the codebase. Teachers never see a confidence number anywhere — only admins do.

## 19. Review-queue architecture

No separate "queue" tables beyond what already exists — the admin dashboard's Needs Review,
Possible Duplicates, Low Confidence, Missing Metadata, and Taxonomy Suggestions sections are
simply filtered views over `books`, `review_flags`, `book_duplicates`, and
`taxonomy_suggestions`. One source of truth, multiple admin-facing lenses on it.

## 20. Reading list architecture

Deliberately minimal, matching §10 of the product spec exactly: `reading_lists` (name
required, `created_by` optional free text, "Anonymous" fallback at display time) and
`reading_list_items` (list ↔ book, composite key, optional note). No ownership, no
permissions, no accounts.

## 21. Privacy & security architecture

- **No child PII anywhere** in the schema — verified against every table in
  [`docs/DATA_MODEL.md`](DATA_MODEL.md); there is no field for a student name, profile,
  behavior note, health data, or family data.
- **Voice:** the Web Speech API transcript lives only in client component state; nothing
  about a voice interaction is ever written to a server, disk, or database beyond the same
  search request text search already handles (see below). If a server-side speech-to-text
  fallback is ever built (Phase 3, only if the browser API proves unreliable), audio is
  processed in memory only and never written to storage.
- **Search queries are not logged or persisted by default**, full stop — no `search_queries`
  table exists in this schema at all. If logging is ever added, the brief requires it be
  privacy-preserving and opt-in; that would be a deliberate future decision, not a default.
- **Secrets** live exclusively in environment variables (`.env.example` documents names only,
  never values); nothing is ever committed (`.gitignore` covers `.env*`, credential JSON,
  tokens).
- **Sessions** are HTTP-only, `Secure`, `SameSite`-protected cookies (§14); there is no
  client-side JavaScript access to any credential.
- **Uploads** are validated by MIME type and size before being accepted, filenames from the
  client are never trusted as-is (server generates the storage key).
- **SQL injection** is structurally avoided — Kysely (§3) only ever produces parameterized
  queries; there is no raw string concatenation into SQL anywhere in the design.

## 22. Deployment architecture

- **Application:** Vercel, hosting the Next.js app — zero-config for this framework, and its
  per-PR preview deployments are a good fit for the design-review workflow this project
  already uses. Note: Vercel's free **Hobby** tier is licensed for personal, non-commercial
  use; a school's operational tool likely warrants the paid **Pro** tier for compliant use —
  worth checking whether an education/nonprofit discount applies at deployment time.
- **Database:** Supabase-hosted Postgres. Its **free tier pauses a project after a period of
  inactivity**, which is a real risk for a genuinely low-traffic school tool — Pro tier is
  recommended before this becomes the school's actual production system, even though free
  tier is perfectly fine for Phase 0–4 development.
- **Connection handling:** the app connects through Supabase's pooled connection (PgBouncer,
  port 6543), not a direct Postgres connection — serverless functions opening direct
  connections is a classic way to exhaust a small Postgres connection limit (flagged as a
  concrete risk in §23).
- **Environments:** a separate Supabase project (or local Supabase via CLI/Docker) for
  development versus production, with the same migrations applied to both; a separate
  Drive folder and Google Sheet for development/testing is recommended once Google
  integration is built, so development activity never touches the school's real data.

## 23. External services & approximate costs

Costs below are **estimates to verify at implementation time**, not current quotes — pricing
changes, and I have not fabricated numbers I can't currently confirm.

| Service | Purpose | Expected cost pattern |
|---|---|---|
| Vercel | App hosting | Free (Hobby) for prototyping; likely needs Pro (~tens of USD/month, verify) for compliant real-world/organizational use |
| Supabase | Postgres + pgvector | Free tier usable for development but pauses on inactivity; Pro tier (verify current price) recommended before real deployment |
| Google Drive API | Cover image storage/read | Free at this usage volume; no incremental cost expected |
| Google Sheets API | Teacher catalog projection | Free at this usage volume |
| Google Books API | Metadata lookup | Free tier, generous daily quota |
| Open Library API | Metadata lookup | Free, no key required |
| AI provider (vision + LLM) | Identification, enrichment, search interpretation | Usage-based (pay per token); likely low total cost for a one-time ~1,500-item bulk import and near-zero ongoing cost for a few new books/week — exact pricing to confirm with the chosen provider before Phase 5/7 |
| Embeddings provider | Semantic search | Usage-based, very low cost at a few thousand short-text embeddings |
| Custom domain (optional) | Branding | Low annual cost if the school wants one instead of a subdomain |

## 24. Technical risks

1. **Serverless + Postgres connection exhaustion** — mitigated by using Supabase's pooled
   connection; must not be bypassed for convenience later.
2. **Supabase free-tier project pausing** — mitigated by upgrading to Pro before real
   deployment; accepted during prototyping.
3. **Google OAuth refresh-token expiry** — an OAuth consent screen left in "Testing" status
   issues refresh tokens that expire after ~7 days, which would silently break Drive access
   weekly. This needs the consent screen moved to "In production" during Phase 6 setup;
   confirmed as a concrete, easy-to-miss setup step in `docs/GOOGLE_SETUP.md` when written.
4. **Embedding dimension lock-in** — changing embedding provider/model after real data exists
   requires a schema migration and a full re-embed; mitigated by deferring the concrete
   choice as long as reasonably possible and documenting the re-embed procedure when the
   choice is made.
5. **Cover-only visual inference limits** — a front cover cannot prove interior illustration
   style; mitigated by explicit provenance flagging (never presented as certainty) and
   spot-checking during the Phase 11 taxonomy research batch.
6. **AI hallucination in metadata/category suggestion** — mitigated structurally (schema
   validation, grounding rules, mandatory human confirmation gates) but remains an ongoing
   QA concern worth periodic spot-checking, not a one-time fix.
7. **Drive API rate limits during bulk import** — batching/backoff is designed in, but real
   throughput should be empirically measured on a small batch (Phase 10) before assuming it
   scales linearly to 1,500 items.
8. **Legacy taxonomy contamination** — the old category list mixes subject/genre/format/
   curriculum/seasonal concepts; mitigated by treating it strictly as research input and
   using the Phase 11 research batch to propose a cleaned set before any bulk categorization
   commits at scale.
9. **AI cost creep** — mitigated by caching, hash-based skip-if-unchanged logic, and batch
   controls, but worth a sanity check on actual spend after the Phase 11 batch before
   greenlighting the full Phase 12 import.
10. **Shared-password auth has no per-user accountability** — an accepted, deliberate
    tradeoff per the brief's explicit "no individual accounts" requirement, not an oversight;
    documented so it's never mistaken for one later.

## 25. Decisions locked now vs. kept configurable

**Locked** (foundational, high cost to change later, low ambiguity in the brief):

- Next.js + React + TypeScript + Tailwind
- Postgres (via Supabase) as the canonical database
- No individual teacher/admin accounts — two shared-secret role gates only
- One required primary physical category per active book; unlimited many-to-many tags
- Google Drive = original-image source of truth; Google Sheets = generated projection, never
  canonical
- No AI-automatic category creation; no silent duplicate merges; no invented bibliographic
  data
- pgvector for embeddings, inside the same Postgres database (no separate vector DB)
- Kysely + plain SQL migrations (no heavy ORM) for portability
- Server Actions / Route Handlers pattern (no separate backend service)

**Configurable / explicitly deferred:**

- Concrete AI provider(s) for vision/LLM/embeddings (behind adapter interfaces; genuinely
  pending your API-access decision)
- Confidence thresholds and category-health thresholds (`system_settings`)
- Google Drive auth strategy detail (OAuth-on-behalf-of-account vs. service account) —
  pending real folder inspection in Phase 6
- Image display strategy detail (mirrored object storage vs. proxy) — leaning mirrored
  storage, finalized in Phase 6
- Ingestion batch sizes and retry limits
- Embedding model/dimension — pending provider choice
- Google Sheet sync cadence (manual-only vs. + daily cron) — pending Vercel plan
- Application name (currently a placeholder)
- Brand palette and logo (pending assets)

## 26. Repository / folder structure (for Phase 1 onward — not created yet)

```
src/
  app/
    (public)/            welcome / lock screen
    (staff)/             home, find, add, lists, guide — staff-session-protected
    admin/                admin dashboard + tools — admin-session-protected
    api/                  route handlers (oauth callback, sheet sync trigger, ...)
  components/
    ui/                   generic accessible primitives (Radix + Tailwind)
    library/              book cards, cover image, category badge
    search/                search bar, filters, autocomplete, voice control
    books/                 book detail, quick edit, confirmation
    reading-lists/
    admin/
  config/
    brand.ts               centralized branding tokens/config
    site.ts                 app name, feature flags
  lib/
    auth/                   session creation/validation, password hashing
    db/                      Kysely instance + query modules per entity
    google/
      drive/
      sheets/
    ai/
      vision/
      llm/
      embeddings/
      speech/
    metadata-providers/
      google-books/
      open-library/
    search/                  query interpretation, ranking, autocomplete
    taxonomy/                category suggestion, health
    ingestion/                shared pipeline: single-add + bulk import
    confidence/               thresholds, score→level mapping
  types/
  validation/                 Zod schemas
styles/
  tokens.css
supabase/
  migrations/
scripts/
  import/
  google/
    authorize.ts
public/
  brand/
docs/
tests/
  unit/
  integration/
  e2e/
```

This is not created in Phase 0 (the brief is explicit that Phase 0 is planning-only); it is
the target structure Phase 1 will actually create.

## 27. Implementation roadmap

The full 14-phase plan (Phase 0 through Phase 13) is recorded, with current status, in
[`docs/IMPLEMENTATION_STATUS.md`](IMPLEMENTATION_STATUS.md) so it stays a single
continuously-updated source rather than duplicated across documents.
