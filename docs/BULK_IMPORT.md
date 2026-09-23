# Bulk Import (Phase 9 infrastructure, Phase 10 operating procedure)

A standalone CLI/worker for processing the photographed book-cover collection stored in Google
Drive into real catalog books — built in Phase 9, intended to be used as-is (no new importer, no
architecture change) by Phase 10 to grow from a small representative batch to the full collection.
Never a browser upload page, never a Vercel Server Action, never a hidden loop inside the
interactive Add Book flow — the web app's normal runtime is never responsible for processing
hundreds or thousands of images synchronously. See `docs/IMPLEMENTATION_STATUS.md`'s Phase 9
section for the full real-validation record and `docs/DECISIONS.md` for the reasoning behind
individual choices below.

## Architecture in one line

`Drive photographs` → **bulk importer** (this document) → canonical PostgreSQL → Phase 5/7 search
and Phase 8 Admin Review, exactly like a teacher's own Add-a-Book flow. Never `Drive → Sheet →
PostgreSQL`; the Sheet (`docs/GOOGLE_INTEGRATION.md`) is a downstream, derived projection of
whatever the importer (or a teacher) already wrote to PostgreSQL.

## Reused, never duplicated

Every real decision — cover identification, bibliographic reconciliation, duplicate detection,
category validation, display-cover trust, provenance — runs through the exact same Phase 7 domain
functions a teacher's interactive Add-a-Book flow uses (`src/lib/intake/*`). The bulk importer
(`src/lib/bulkImport/pipeline.ts`) is a SECOND ORCHESTRATOR composing those same functions in one
synchronous call per item, not a second implementation of the logic. The one real gap this
uncovered in shared code — `src/lib/intake/persistence.ts`'s job-completion bookkeeping assumed
every job had exactly one item — was fixed in place (`advanceParentJob`, now genuinely multi-item
aware) with zero behavior change for the existing single-item teacher flow.

## Source folder configuration

The bulk importer has its OWN, separately-configured Drive root — `GOOGLE_DRIVE_BULK_IMPORT_ROOT_
FOLDER_ID` — deliberately never the same env var as the interactive flow's `GOOGLE_DRIVE_ROOT_
FOLDER_ID` (`docs/GOOGLE_SETUP.md`). In this project's real environment, the bulk-import root
("Scandi library books") happens to be the direct parent of the interactive root ("Corridor
books"), discovered by direct inspection rather than assumed — the real collection is organized
`<bulk-import root>` → `Corridor books` → three photographer subfolders → image files, three levels
deep. `src/lib/bulkImport/enumerate.ts` walks this recursively (bounded to `MAX_ENUMERATION_DEPTH`
levels, `MAX_ENUMERATED_FILES` files — both comfortably larger than the real ~1,500-image
collection, refusing rather than silently truncating if ever exceeded), reusing the existing
`googleDrive/validation.ts` allowed-image-type list (never a second format list) so a synced Google
Sheet, a Google Doc, or any other non-image file already in the folder tree is silently ignored.

## Job / item lifecycle

Reuses the existing `ingestion_jobs` → `ingestion_items` schema (Phase 4/7) — the `bulk_import`/
`admin_bulk_drive` enum values existed, unused, since Phase 4; this is the first real caller. No
new tables, no parallel queue system.

- `pending` → `processing` (claimed) → `completed` | `needs_review` | `failed`.
- Claiming is the exact Phase 8 claim-before-mutate atomic conditional `UPDATE ... WHERE status =
  'pending' RETURNING` pattern (`src/lib/bulkImport/claim.ts`) — the same reasoning that makes
  `approveReviewLater`/`resolveDuplicate` safe under concurrent Admin Review actions applies here
  to concurrent bulk workers.
- **Idempotency at job-creation time**: `createBulkImportJob` looks up existing `ingestion_items`
  by `driveFileId` first and never re-enqueues a file that already has one (in ANY status) — a
  re-run of `import:create-job` against the same folder/limit is always safe. A partial unique
  index (`drizzle/0006_phase9_bulk_import_dedup.sql`) on `ingestion_items.drive_file_id`, scoped
  to only the three active statuses, is the database-level backstop.
- **Stale-processing recovery**: any item still `processing` after `DEFAULT_STALE_PROCESSING_MS`
  (30 minutes) is reset to `pending` at the start of every `import:run`/`import:resume` — a
  deliberately simple, documented, time-based heuristic appropriate to a single-operator, bounded-
  concurrency CLI tool, not a distributed lease/fencing protocol.

## Conservative auto-completion gate

`src/lib/bulkImport/completionGate.ts` — a pure, exhaustively unit-tested decision, checked in a
fixed order, that decides `complete` vs `needs_review` (and which review-flag type) from signals
the existing Phase 7 pipeline already produces:

1. No usable title identified → `low_identification_confidence`.
2. No language determined → `low_identification_confidence`.
3. Reconciliation `ambiguous` → `metadata_conflict`; `unresolved` → `low_identification_confidence`.
4. Any duplicate outcome other than `no_match` → `duplicate_uncertain` (no automatic
   same-edition/different-edition decision is ever made without a human).
5. No category survived validation, or its confidence is `low` → `category_uncertain`.

This deliberately does not invent new Gemini-detected signals (e.g. "multiple books in one
photo," "this is a spine, not a cover") that would require changing the vision prompt/schema —
out of this phase's reuse-not-redesign scope. In practice a spine-only, multi-book, or genuinely
unreadable photograph overwhelmingly also fails to produce a confident single-book title, so check
1 already catches most of those cases honestly, if not by name.

## Duplicate photo ≠ duplicate book

- **Same Drive file, rerun**: job-creation idempotency (above) means this can never create a
  second book/copy.
- **Same image content, different Drive file id**: never silently converted into a physical-copy
  count. It reaches the exact same Phase 7/8 duplicate-detection/resolution architecture a
  teacher's own duplicate photo would (`same edition` / `different edition` / `different language`
  / `false match` / `unresolved`) — no separate "content hash matched" fast path.
- **Same book, different photographs**: normal Phase 7/8 duplicate logic; no general merge engine
  exists or was added.

## Retries / failure classification

`src/lib/bulkImport/retryClassification.ts` — never treats every failure identically:

- **Transient** (rate limit, timeout, momentary provider failure): bounded retry (default 3
  attempts) with exponential backoff + jitter, identical formula to `googleDrive/retry.ts`'s.
- **Permanent** (corrupt/unsupported image, or a run-fatal Drive configuration/authorization
  failure): the item becomes `failed` immediately; a run-fatal category is meant to stop the WHOLE
  run rather than burn through every remaining item identically.
- **Reviewable** (the vision call completed but genuinely couldn't parse the response): routes to
  `needs_review` with `import_error` — a human, not a retry, resolves this.

## Provider caching

Metadata-provider responses are cached exactly as Phase 7 already caches them
(`metadata_provider_cache`, keyed by normalized query) — a restarted bulk-import worker never
re-issues an identical Open Library/Google Books query it already has a cached, still-valid answer
for.

## Cost observability

`src/lib/bulkImport/costTracking.ts` counts every provider call per run; `pricing.ts` projects real
cost from REAL observed Gemini token usage (`src/lib/ai/geminiProvider.ts`'s `analyzeCover` now
surfaces `usageMetadata` when Google's response includes it) rather than a theoretical estimate
whenever real samples exist. See `docs/COSTS.md`'s "Bulk import (Phase 9)" section for the actual
real numbers this produced.

## Admin Review integration

A `needs_review` item is a real `ingestion_items` row exactly like a teacher's own Review Later
item — Phase 8's existing, computed Admin Review queue (`loadAdminReviewQueue`) sees it with zero
new code, and `loadAdminReviewDetail` can open it and (when enough trustworthy data exists) a real
`pending_review` book row, using the persisted draft — never re-running Drive/Gemini/Open Library
just to display evidence. There is no second review queue, no bulk-import-specific review page.

## Search integration

A `completed` item is a real, active `books` row created through the exact same `saveNewBook()`
Phase 7 already uses — conventional search text/vector are built at insert time, the row is
immediately `review_status = 'active'` (Find-visible), and no per-item embedding call happens
(embeddings are generated once per BATCH via the existing `npm run embeddings:generate
--mode=missing`, matching this project's own Phase 0 design note that a bulk-import burst should
never make one synchronous provider call per item). There is no bulk-specific search index.

## Taxonomy

Phase 9 does not finalize the taxonomy. The importer selects only from existing active physical
categories (never creates or activates one); a weak category fit routes to `needs_review` rather
than being force-shelved. Collection-wide taxonomy clustering, bulk re-shelving, and category
restructuring are explicitly Phase 10 work using Phase 8's existing human tools — not built here.

## Initial copy location (Phase 9 addendum)

`import:create-job` accepts an optional `--location=<slug>`, resolved and validated against the
real, currently-active `library_locations` list (the same list the Move/Return workflow's
destination picker uses) before the job is ever created — an unknown or inactive slug fails
immediately with the list of valid options, never silently falling back to a guessed default.
The resolved location id is stored once, in `ingestion_jobs.config.initialLocationId`, and every
physical copy that job creates — whether through the automatic completion path (`saveNewBook`)
or through an admin's later manual Review-Later/duplicate-resolution approval of an item that
instead landed in `needs_review` — reads it from that one place
(`getJobInitialLocationId()`, `src/lib/intake/persistence.ts`), so the two paths can never
silently disagree about a job's configured starting location.

Omitting `--location` entirely leaves every copy that job creates with `current_location_id`
left `null` ("location not recorded") — the same honest default any other copy has. **This
importer never assumes imported photos are physically in Corridor 218 (or anywhere else)
unless an operator explicitly says so.**

```
npm run import:create-job -- --limit=10 --location=corridor-218
```

## CLI reference

```
npm run import:list                                     # read-only enumeration; no DB writes
npm run import:create-job -- --limit=N                  # bounded, deterministic job creation
npm run import:create-job -- --file-id=id1,id2,...       # explicit file selection
npm run import:run -- --job-id=<id>                      # process up to --limit items (default: all pending+processing)
npm run import:run -- --job-id=<id> --concurrency=2      # bounded concurrency (max 4)
npm run import:run -- --job-id=<id> --max-retries=5       # per-item transient-retry budget (default 3)
npm run import:resume -- --job-id=<id>                    # identical to import:run — resumability is state-based, not a different code path
npm run import:status -- --job-id=<id>                    # live per-status counts, safe to run anytime
```

**Safety rail**: `import:create-job` refuses to run with neither `--limit` nor `--file-id` — there
is no way to accidentally start all ~1,500 files with a single bare command.

## Phase 10 operating procedure (what this phase leaves ready)

Per §48 of the Phase 9 brief, Phase 10 should be able to do all of the following using this
infrastructure exactly as it exists today, with no new importer and no new Sheets sync
architecture:

1. `npm run import:list` to confirm the real folder contents.
2. `npm run import:create-job -- --limit=<small number>` for an intentional first representative
   batch, `npm run import:run -- --job-id=...` to process it.
3. Review the results (Admin Review for anything flagged, Find for anything completed) and grow
   the batch toward ~100–150 representative images across multiple `create-job`/`run` cycles.
4. Use Phase 8's existing human tools (category management, taxonomy suggestions) to adjust
   taxonomy based on what that representative batch reveals.
5. Only then intentionally process the remaining collection, in further bounded batches — never
   one unbounded run.
6. Run `npm run embeddings:generate --mode=missing` once per meaningful batch, and `npm run
   sheets:sync` whenever the Sheet should reflect the newly-imported books.

Real per-item cost is already measured (`docs/COSTS.md`); re-verify current Gemini pricing and
this project's actual paid-tier daily throughput before committing to a full-collection timeline.
