# Costs

A running record of what this project actually costs to operate, and what it's expected
to cost as later phases add real external services. Updated as each phase changes the
picture — never asserted from memory without checking the provider's own current
documentation first.

## Current external services (through Phase 6)

| Service | Phase | Cost model |
|---|---|---|
| PostgreSQL (local dev; Supabase in production) | 4 | Supabase free tier covers this project's tiny scale; see `docs/DATABASE_SETUP.md`. |
| Google Gemini embedding API (`gemini-embedding-2`) | 5 | Optional — only used when `GEMINI_API_KEY` is configured. Free-tier quota observed to be rate-limited under heavy back-to-back testing in a single session (`docs/DECISIONS.md`); ordinary usage (one query embedding per real teacher search, one document batch per catalog embedding run) is far below that. |
| Google Drive API | 6 | See below. |

## Google Drive API

As of this phase (2026), standard Google Drive API usage (the operations this
integration uses — file/folder metadata, listing, download, and resumable upload) is
available without additional API charge, within Google's published quota limits for a
Cloud project. **This is not "permanently free"** — Google's own 2026 documentation notes
updated quota accounting and states that usage beyond quota may become subject to
charging later in 2026. Always check
[Google's current Drive API quota/pricing documentation](https://developers.google.com/drive/api/guides/limits)
before relying on a specific number here; this file records what was true when last
checked, not a permanent guarantee.

**Why SSJC's usage is far below any quota concern:**

- The existing collection is ~1,500 photographs. Phase 6 does not enumerate or download
  it — only a live `google:smoke` run touches Drive at all, and that's a handful of API
  calls (one connection check, one bounded listing, up to three small sampled listings,
  one upload, one confirmation fetch, one download, one cleanup, one final listing) — well
  under twenty requests per run.
- A future Phase 7 (Add Book) would add roughly one upload + one confirmation fetch per
  teacher-added book — a school library adds books in the tens or low hundreds per year,
  not per day.
- A future Phase 10 (bulk import) processing the existing ~1,500-photo collection once
  would be on the order of a few thousand requests total (one listing call per ~50–200
  items, one download per photo) — a one-time cost, not a recurring one, and still small
  relative to Google's per-project quota tiers (typically tens of thousands of requests
  per 100 seconds, per Google's documentation).

**No paid middleware or duplicate storage.** This integration talks to Drive's REST API
directly (`node fetch`, no SDK — see `docs/ARCHITECTURE.md`/`docs/DECISIONS.md` for why).
No image is ever copied into a second storage service purely for infrastructure
convenience; the source/original photo lives in Drive once. (A later phase's
*display*-cover derivation — `docs/DATA_MODEL.md` §5 — stores a separate, deliberately
different, resized copy in Supabase Storage for fast rendering; that is a distinct,
already-justified design decision from a prior phase's review, not a Phase 6 change.)

## What would change this picture

- A much larger physical collection (tens of thousands of books) approaching Drive's
  published per-project quota tiers.
- Google's planned 2026 quota-exceedance charging actually taking effect and SSJC's
  traffic (unexpectedly) approaching a billed tier — re-check Google's current pricing
  page if usage ever seems to be climbing unexpectedly.
- A future phase choosing to serve Drive-hosted images directly to every page load
  (explicitly not this phase's design — see `docs/GOOGLE_INTEGRATION.md`, "why Google
  Drive is not canonical catalog storage").
