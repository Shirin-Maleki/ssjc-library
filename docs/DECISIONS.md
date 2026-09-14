# Decision Log

Every entry uses the format the project brief specifies, so decisions stay easy to revisit.
New entries are appended at the top of their section as later phases add decisions.

---

## Canonical database: Postgres via Supabase

**Date:** 2026-09-13 · **Status:** Locked

**Problem:** Need a canonical, relational store for catalog data — not Google Sheets, per
explicit requirement — that supports normalized relationships, reliable IDs, review queues,
duplicate management, provenance, and eventually vector search.

**Options considered:** (a) Supabase-hosted Postgres, (b) self-hosted/Neon/RDS Postgres, (c) a
non-relational store (Firestore/Mongo).

**Chosen approach:** Supabase-hosted Postgres.

**Why:** Matches the brief's stated preference; mature managed Postgres; pgvector supported
without extra setup; connection pooling built in (important for serverless); reasonable free
tier for development.

**Consequences:** Free-tier projects pause after inactivity — real risk once this is a live
tool, not just during development (see risk #2 in ARCHITECTURE.md). Must budget for Pro
before real deployment.

**How to change later:** Business logic is deliberately not bound to Supabase-only features
(no Supabase Auth, no Supabase-only RLS dependency, no Supabase Storage for canonical images)
— see the portability entry below. Moving to Neon/RDS/self-hosted later is a connection-
string change plus re-running the same SQL migrations.

**Relevant files:** `docs/ARCHITECTURE.md` §4, §22; `supabase/migrations/` (Phase 4).

---

## Data-access layer: Kysely over an ORM

**Date:** 2026-09-13 · **Status:** Locked

**Problem:** Need a type-safe way to write queries against Postgres without hand-writing
unchecked SQL strings, while staying portable and keeping migrations as plain SQL.

**Options considered:** (a) Kysely (type-safe query builder over plain SQL), (b) Prisma
(schema-DSL ORM with its own migration format), (c) raw `pg`/`postgres` with hand-written
SQL and manual type annotations.

**Chosen approach:** Kysely.

**Why:** Produces plain parameterized SQL (no ORM "magic" hiding what actually runs, no
N+1s hidden behind lazy relations), types are derived from the real schema rather than a
separate DSL to keep in sync, and it has no opinion about migrations — so migrations stay
plain numbered `.sql` files runnable by any Postgres tool, avoiding lock-in to Prisma's
migration format and schema file.

**Consequences:** Slightly more manual query-writing than Prisma's relation-loading sugar;
acceptable given the schema's size (~25 tables) and the value of staying close to actual SQL.

**How to change later:** Kysely's generated types come from one schema-typing step; swapping
to a different query builder touches `lib/db` only, not call sites, if query modules are kept
thin.

**Relevant files:** `docs/ARCHITECTURE.md` §3.

---

## No individual teacher/admin accounts — two shared-secret role gates

**Date:** 2026-09-13 · **Status:** Locked

**Problem:** Need staff-only access control without building an accounts system the brief
explicitly says is out of scope.

**Options considered:** (a) two shared passwords/roles (staff, admin) with signed session
cookies, (b) lightweight named accounts (e.g., magic-link email) with a shared admin flag,
(c) no auth at all, relying on network/URL obscurity.

**Chosen approach:** (a) — a shared staff password and a separate shared admin password/PIN,
each producing a signed, HTTP-only session cookie carrying only a role, not an identity.

**Why:** Matches the brief's explicit, repeated instruction: no individual teacher accounts,
staff/admin are access levels not identities. Named accounts would add real complexity
(invites, password resets, an accounts table) for a requirement that explicitly doesn't want
individual identity.

**Consequences:** No per-user accountability for who made a given edit (accepted tradeoff,
documented in ARCHITECTURE.md risk #10); `audit_log.actor_label` can only ever be a
self-reported free-text label ("teacher" / "admin"), never a verified identity.

**How to change later:** If individual staff accounts are ever wanted (explicitly listed as
"future-ready, not pre-built"), the session layer would need real accounts and the
`audit_log`/`reading_lists.created_by` free-text fields would need to become foreign keys —
a deliberate, visible migration, not a silent change.

**Relevant files:** `docs/ARCHITECTURE.md` §14.

---

## Physical taxonomy: single required category, database-managed, never AI-created

**Date:** 2026-09-13 · **Status:** Locked

**Problem:** The old library's category list mixed subject/genre/format/curriculum/seasonal
concepts and became unmaintainable; need a model that keeps physical shelving simple while
allowing AI-assisted discovery.

**Options considered:** (a) one required `physical_category_id` per book (table-managed) plus
unlimited many-to-many digital tags, (b) multiple physical categories per book, (c) categories
as an application-level constant/enum.

**Chosen approach:** (a).

**Why:** Directly matches the brief's central "physical simplicity, digital richness"
principle — a teacher always knows exactly one shelf to return a book to, while search/
discovery gets arbitrarily rich tags. A real table (not a constant) is required because AI
must never be able to invent a category, and admins must be able to evolve the list.

**Consequences:** Every book must eventually have a category assigned before being
teacher-visible (`review_status = active` requires it); books awaiting categorization sit in
`pending_review` until resolved.

**How to change later:** Category management (create/rename/deactivate/merge) is entirely
data, not code — no migration needed to add, rename, or retire a category.

**Relevant files:** `docs/DATA_MODEL.md` §2 (`physical_categories`); `docs/ARCHITECTURE.md`
§17.

---

## Google Drive = image source of truth; Google Sheets = generated projection, never canonical

**Date:** 2026-09-13 · **Status:** Locked

**Problem:** Need to decide where original book-cover images live and whether the
teacher-facing spreadsheet can ever be an editable source of data.

**Options considered:** (a) Drive for originals + Postgres canonical + Sheets as a one-way
generated projection, (b) Sheets as the actual database, (c) images stored directly in
Postgres/object storage with no Drive involvement.

**Chosen approach:** (a).

**Why:** The brief is explicit and repeated: Sheets must never be canonical. Drive already
holds the existing ~1,500 photos and is the natural place for a non-technical stakeholder to
browse originals directly if ever needed.

**Consequences:** Any two-way sync (teacher edits flowing back from Sheets into Postgres)
would require explicit, deliberate reconciliation logic — not built in v1, and not silently
introduced later either.

**How to change later:** N/A — this is a foundational data-flow direction, not expected to
reverse; if it ever needs to, `book_sheet_sync` already tracks enough state (last synced
hash, row identity) to build reconciliation against.

**Relevant files:** `docs/ARCHITECTURE.md` §6, §7.

---

## Google Drive authentication strategy: OAuth-on-behalf-of-account (tentative)

**Date:** 2026-09-13 · **Status:** Proposed — confirmed in Phase 6 once the real folder is inspected

**Problem:** Need to read an existing ~1,500-photo folder and write new uploads to Drive,
without knowing yet whether the target is an ordinary personal My Drive folder or an
organizational Shared Drive, and without assuming a service account can simply act on
someone's personal Drive.

**Options considered:** (a) OAuth 2.0 acting on behalf of the school's designated Google
account, (b) a service account granted Editor access to the specific folder(s), (c) domain-
wide delegation (requires Google Workspace admin control).

**Chosen approach (pending confirmation):** (a), using the Google Picker API for
least-privilege, per-folder access rather than whole-Drive scopes.

**Why:** Works uniformly whether the target is My Drive or a Shared Drive; matches how a
non-technical stakeholder already thinks about "my Drive," without needing them to share a
folder with an unfamiliar robot email address or requiring Workspace-admin-level delegation.

**Consequences:** Requires managing an OAuth refresh token server-side and keeping the OAuth
consent screen in "Production" status (a Testing-status app's refresh tokens expire in ~7
days — flagged as risk #3 in ARCHITECTURE.md).

**How to change later:** If Phase 6 reveals the folder is an org-controlled Shared Drive with
an admin able to grant service-account access, a service account is lower long-term
maintenance (no refresh-token lifecycle) and worth switching to then — the Drive integration
sits behind an adapter (`lib/google/drive`) specifically so this swap doesn't ripple through
the app.

**Relevant files:** `docs/ARCHITECTURE.md` §6; `docs/GOOGLE_SETUP.md` (to be written in Phase 6).

---

## Image display strategy: mirrored object storage, not a live Drive proxy

**Date:** 2026-09-13 · **Status:** Proposed — confirmed in Phase 6

**Problem:** Never expose private Drive URLs to the browser; need a fast way to render cover
images in search results and book detail.

**Options considered:** (a) generate a display-optimized copy in an object store (Supabase
Storage) at ingestion time, (b) a server-side route that proxies/streams the Drive file per
request, (c) rely on an external provider's thumbnail (e.g., Google Books cover image) when
confidently matched to the same edition.

**Chosen approach:** (a) as primary, with (c) considered as a nice-to-have when a confident
edition match exists, (b) documented as a fallback if object-storage setup is impractical.

**Why:** A live per-request Drive proxy adds Drive API latency and rate-limit exposure to
something that needs to feel instant (a results grid); a pre-generated, resized, CDN-served
copy is faster and cheaper at read time, and Supabase Storage reuses infrastructure already
in the stack rather than adding a fourth vendor.

**Consequences:** Requires a resize/convert step at ingestion time (using `sharp` or
Supabase's transform API if available on the chosen plan) and a bit more storage.

**How to change later:** `books.display_cover_url` is a plain URL column — the generation
strategy behind it can change without touching any UI code.

**Relevant files:** `docs/ARCHITECTURE.md` §6, §15.

---

## Google Sheets sync model: synchronous incremental write + admin/cron reconciliation

**Date:** 2026-09-13 · **Status:** Proposed — confirmed in Phase 9

**Problem:** Need the teacher-facing sheet to stay reasonably current without building queue/
worker infrastructure that this traffic volume doesn't justify.

**Options considered:** (a) synchronous Sheets API write immediately after a relevant DB
write, with a stored sync-state table for retry/reconciliation, (b) a background job queue
(e.g., a dedicated worker + message queue), (c) sync only on a fixed schedule (no incremental
writes at all).

**Chosen approach:** (a), plus an admin "Sync Now" and a scheduled (daily, if the hosting
plan allows) full reconciliation as a safety net.

**Why:** At a few book changes per week, a queue/worker system is meaningfully more
infrastructure than the problem needs. A synchronous write with a tracked retry state gets
freshness for free in the common case, and reconciliation catches drift or failures without
needing perfect delivery on every write.

**Consequences:** A burst of many simultaneous writes (e.g., mid-bulk-import) would make many
synchronous Sheets API calls in quick succession — mitigated by not syncing individual bulk-
import items incrementally, and instead running one reconciliation pass at the end of a bulk
job (see Phase 9/10 notes in IMPLEMENTATION_STATUS.md).

**How to change later:** If write volume ever grows enough to matter, the same
`book_sheet_sync` state table already supports moving to an actual queue without a data model
change.

**Relevant files:** `docs/ARCHITECTURE.md` §7.

---

## AI provider(s): interfaces locked now, concrete vendor pending your input

**Date:** 2026-09-13 · **Status:** Proposed — pending your confirmation of API/billing access

**Problem:** Need vision, structured-LLM, and embedding capability, without assuming a
specific paid API is actually available to this project.

**Options considered:** Anthropic Claude, OpenAI, Google Gemini — for vision + structured
output; a separate low-cost embeddings-specific model, possibly from a different vendor than
the main LLM.

**Chosen approach:** Architecture locks the *interfaces* (`VisionProvider`, `LLMProvider`,
`EmbeddingProvider`) now; the concrete vendor is explicitly left open. Recommendation, not a
decision: Claude for vision/structured output, a low-cost dedicated embeddings model
(potentially a different vendor) for search.

**Why:** A ChatGPT/Claude/Gemini consumer subscription doesn't itself grant API/billing
access — this is a real, non-technical decision only you can make (which provider you
actually hold API keys/billing for), not something to silently assume.

**Consequences:** Phases 5 and 7 (real search, real Add-a-Book AI calls) are blocked on this
answer specifically — everything else in the roadmap is not.

**How to change later:** Every AI call in the app goes through the four interfaces above; a
provider swap is confined to `lib/ai/*` adapters.

**Relevant files:** `docs/ARCHITECTURE.md` §8.

---

## Embeddings: pgvector inside the existing Postgres database

**Date:** 2026-09-13 · **Status:** Locked (mechanism) / dimension pending (model choice)

**Problem:** Need semantic retrieval for vague/thematic/emotional queries without introducing
enterprise search infrastructure this collection's size doesn't need.

**Options considered:** (a) pgvector in the same Supabase Postgres database, (b) a dedicated
vector database (Pinecone, Weaviate, etc.), (c) no semantic layer — keyword/filter search only.

**Chosen approach:** (a).

**Why:** The brief explicitly discourages a separate enterprise vector database "if
embeddings materially help" — and at ~1,500–3,000 rows, pgvector needs no specialized ANN
index at all, so there's no performance case for a dedicated vector service.

**Consequences:** The vector column's dimension is tied to whichever embedding model is
eventually chosen; changing models later requires a migration and a full re-embed of the
catalog (cheap at this data volume, but not instantaneous).

**How to change later:** Embedding generation is a documented, deterministic template
(title + description + tags + category name) behind `EmbeddingProvider` — regenerating is a
single scripted pass, gated by a source-text hash so unchanged books are skipped.

**Relevant files:** `docs/ARCHITECTURE.md` §13; `docs/DATA_MODEL.md` §2 (`books.embedding`).

---

## Search ranking: deterministic SQL filtering + pgvector semantic layer, template-based explanations

**Date:** 2026-09-13 · **Status:** Proposed — confirmed in Phase 5

**Problem:** Need natural-language search that never invents which books exist, and
explanations that are grounded rather than free-form LLM reasoning that could hallucinate.

**Options considered:** (a) LLM extracts structured constraints → SQL filters the real
catalog → pgvector ranks the semantic remainder → explanations are templated from actually-
matched attributes, (b) send the whole catalog to an LLM per query and let it choose/explain
freely, (c) keyword-only search with no semantic layer.

**Chosen approach:** (a).

**Why:** (b) is exactly the "AI must not hallucinate library inventory" risk the brief warns
against, and doesn't scale query cost sensibly either. (a) keeps the LLM's role strictly
bounded to interpreting language, never to deciding what exists or fabricating why something
matched.

**Consequences:** Slightly more implementation work than a single LLM call (structured
extraction + SQL + vector ranking + template explanation, as four distinct steps) — accepted
as directly necessary for the grounding requirement, not incidental complexity.

**How to change later:** Each stage (`lib/search/*`) is independently testable and
replaceable.

**Relevant files:** `docs/ARCHITECTURE.md` §12.

---

## Duplicate model: candidate relationships between book rows, not a boolean flag

**Date:** 2026-09-13 · **Status:** Locked

**Problem:** Need to distinguish exact-copy, different-edition, different-language-same-work,
and false-match — not just "is this a duplicate, yes/no."

**Options considered:** (a) a `book_duplicates` relationship table with a typed
`relationship_type`, plus an optional `work_groups` link for same-work variants, (b) a single
`is_duplicate` boolean on `books`, (c) automatic merging of anything above a similarity
threshold.

**Chosen approach:** (a).

**Why:** Matches the brief's explicit four-way distinction and its insistence that AI must
never silently merge records — a relationship table lets a human resolve each candidate
explicitly (add copy / different edition / not a match / review later) without ever deleting
or merging data automatically.

**Consequences:** Slightly more schema than a boolean flag; justified directly by the brief's
requirement.

**How to change later:** N/A — this is a foundational modeling choice for a core requirement.

**Relevant files:** `docs/DATA_MODEL.md` §4; `docs/ARCHITECTURE.md` §11.

---

## Metadata provenance & confidence: one unified table, not per-field columns or a JSON blob

**Date:** 2026-09-13 · **Status:** Locked (pattern) / field-key vocabulary configurable

**Problem:** Need to track, per book, both "where did this value come from" and "how
confident are we," across several different fields, in a way an admin UI can render
generically.

**Options considered:** (a) one generic `book_field_status` table keyed by `(book_id,
field_key)`, (b) a JSON provenance blob per book, (c) dedicated provenance/confidence columns
per tracked field, scattered across `books`.

**Chosen approach:** (a).

**Why:** A JSON blob (b) isn't queryable ("show me all books where physical-category
confidence is low") without unpacking it in application code; per-field columns (c) don't
scale as more fields need tracking and don't give the admin UI one generic renderer. A single
typed table gives both queryability and a uniform admin presentation, satisfying the brief's
requirement to "clearly distinguish externally sourced / AI inferred / human verified"
without per-field special-casing.

**Consequences:** `field_key` is a free-text-but-controlled-in-application-code value rather
than a database enum, trading a small amount of DB-level strictness for schema flexibility
(see open question in `docs/DATA_MODEL.md` §12).

**How to change later:** Adding a newly-tracked field is a code change (add to the shared
Zod/TypeScript vocabulary), not a migration.

**Relevant files:** `docs/DATA_MODEL.md` §3; `docs/ARCHITECTURE.md` §18.

---

## Bulk-import architecture: one shared ingestion pipeline, staged rollout enforced by the phase plan

**Date:** 2026-09-13 · **Status:** Locked

**Problem:** The existing ~1,500 photos must not be processed as a one-off script — need a
reusable, resumable, idempotent system, and must not be run all at once regardless of how the
code is built.

**Options considered:** (a) one shared `ingestion_jobs`/`ingestion_items` pipeline used by
both single Add-a-Book and bulk import, with batching/idempotency/resumability built in from
the start, (b) a separate one-off bulk-import script, decoupled from the app's normal
add-book code path.

**Chosen approach:** (a).

**Why:** A separate one-off script (b) would be a second, less-tested code path for the exact
same identification/enrichment/duplicate logic — doubling maintenance and risking divergent
behavior between "a teacher adds one book" and "we import 1,500 of them." Sharing the
pipeline also means every idempotency/retry/review-routing guarantee automatically applies to
both.

**Consequences:** The single-add flow always creates an `ingestion_jobs` row (job_type
`single_add`), which is slightly more bookkeeping than strictly necessary for one image, but
keeps the two paths genuinely identical rather than superficially similar.

**How to change later:** N/A — this is foundational to the phase plan's staged-rollout
safety.

**Relevant files:** `docs/DATA_MODEL.md` §7; `docs/ARCHITECTURE.md` §16.

---

## Repository / folder structure

**Date:** 2026-09-13 · **Status:** Proposed — applied at the start of Phase 1

**Problem:** Need a structure that keeps UI, domain logic, data access, and each external
integration (Google, AI, metadata providers) cleanly separated, per the brief's explicit
code-quality requirements.

**Options considered:** The brief's own suggested structure, applied close to as given, versus
a flatter or more feature-sliced alternative.

**Chosen approach:** The brief's suggested structure, adopted closely with light
specialization under `lib/` (separate `google/drive`, `google/sheets`, `ai/vision`,
`ai/llm`, `ai/embeddings`, `ai/speech`, `metadata-providers/*`, `search/`, `taxonomy/`,
`ingestion/`, `confidence/`) so each concern named in the brief has an obvious, singular home.

**Why:** No compelling reason to deviate from a structure the brief already reasoned through
carefully; the light additions just make the already-implied separation explicit in the
folder layout.

**Consequences:** None significant — a folder layout is cheap to adjust.

**How to change later:** Freely, before much code exists; costlier once Phase 1+ files are in
place, but never a data-model-level concern.

**Relevant files:** `docs/ARCHITECTURE.md` §26.
