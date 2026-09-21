# Costs

A running record of what this project actually costs to operate, and what it's expected
to cost as later phases add real external services. Updated as each phase changes the
picture — never asserted from memory without checking the provider's own current
documentation first.

## Current external services (through Phase 7)

| Service | Phase | Cost model |
|---|---|---|
| PostgreSQL (local dev; Supabase in production) | 4 | Supabase free tier covers this project's tiny scale; see `docs/DATABASE_SETUP.md`. |
| Google Gemini embedding API (`gemini-embedding-2`) | 5 | Optional — only used when `GEMINI_API_KEY` is configured. Free-tier quota observed to be rate-limited under heavy back-to-back testing in a single session (`docs/DECISIONS.md`); ordinary usage (one query embedding per real teacher search, one document batch per catalog embedding run) is far below that. |
| Google Drive API | 6 | See below. |
| Google Gemini vision + enrichment (`gemini-3.8-flash`) | 7 | Shares the same `GEMINI_API_KEY` as embeddings — never a second key. See below. |
| Google Books API | 7 | Optional (`GOOGLE_BOOKS_API_KEY`). Free tier, ~10,000 requests/day. Not real-tested this session (no key available) — see "Add a Book (Phase 7)" below. |
| Open Library Search API | 7 | Free, no key, no published rate limit found in its own docs beyond "identify your client" — kept low-volume and cached regardless. |

## Add a Book (Phase 7)

**Per-book real cost, exactly 1 Gemini call in the normal case** (down from 2 —
AI-first catalog draft correction, `docs/DECISIONS.md`: one combined multimodal
call now returns both cover identification and AI-suggested catalog metadata in
one request, since the second, separate enrichment call was what this project's
own small daily quota kept silently defeating in real use) **+ at most 2
metadata-provider searches** (Google Books if configured, Open Library always)
**+ 1 Drive upload/confirm pair**. This is a low-volume staff library — teachers
add books in the tens to low hundreds per year, not per day — so absolute cost is
expected to be negligible; the observation below is about *rate limits*, not
dollar cost. Halving the default call count directly doubles how many real books
a teacher can add on a given day before hitting the measured 20-request/day
free-tier ceiling below.

**Real-provider validation observed a genuine free-tier daily quota limit.**
During implementation and again during a dedicated real-provider validation pass
(2026-09-21, `docs/AI_PIPELINE.md` §10), sustained back-to-back real Gemini calls
to `gemini-3.8-flash` — mostly structured-output (`responseSchema`) calls —
eventually returned `rate_limited` on every subsequent call, and this did **not**
recover after waits of 25 seconds, 90 seconds, or 3 minutes within the same
session. This pattern (persists across minutes, not just a burst) indicates a
**daily** quota, not a short per-minute rate limit — ordinary single-book-at-a-time
teacher usage is very unlikely to hit it (one identify + one enrichment call per
book, with real gaps between books), but a developer/tester making many real
calls in one sitting (as this implementation and validation pass did) can. No
per-request cost was observed or billed — this was free-tier quota exhaustion,
not a paid overage.

**Confirmed as a genuine daily quota, not a permanent block**: a correction
pass on the same date, several hours later, found the quota had reset (a real
canary call succeeded on the first attempt). However, sustained real testing
during that same later pass reproduced a *second*, related pattern: real
`rate_limited`/timeout responses returned intermittently even with 25-90
second gaps between calls, recovering for some calls (one real
identify-through-duplicate-check attempt succeeded, though its own
enrichment call was separately rate-limited — a partial, not a full,
success) but not others (two further real cases failed on identify across
~5 minutes of retries each). This looks like a real, live Gemini capacity
constraint on the structured-output (`responseSchema`) code path specifically
— consistent with the original implementation-time finding that
structured-output calls have their own, more constrained serving capacity —
rather than a strict per-key quota counter. See `docs/AI_PIPELINE.md` §10b
for the full case-by-case record.

**A concrete daily quota number, finally observed directly (final closure
pass §5, `docs/AI_PIPELINE.md` §10c)**: one bounded real-attempt round during
the closure pass got Google's own error body back, naming the exact
constraint — `GenerateRequestsPerDayPerProjectPerModel-FreeTier`,
`quotaValue: 20`. This project's free tier allows only **20 real
`gemini-3.8-flash` requests per day, total**, across every real call made
that day (implementation, every validation round, and every closure-pass
retry combined) — a very small budget that fully explains why sustained
real-provider validation repeatedly ran into a wall within the same session,
across every session so far. This is the first time a session has seen the
literal number rather than inferring "some kind of daily limit" from
retry behavior.

**Latency observed** (the one real, fully complete success — "Kenny and the
Little Kickers," `docs/AI_PIPELINE.md` §10; "The Cat Food Mystery,"
`docs/AI_PIPELINE.md` §10b, reached the same latencies through
duplicate-check but did not complete enrichment): image resize 85-93ms;
Gemini identify ~5-19s (real variance observed, not a fixed number); Open
Library lookup ~1.2-4.4s cold / ~6ms cache-hit on retry (real cache behavior
confirmed); reconciliation and duplicate check <10ms each (in-process,
DB-only). A full identify-through-enrichment round trip is expected in the
5-20 second range end to end under normal (non-rate-limited) conditions —
consistent with the "Identifying book…" / "Finding book details…" / "Preparing
details…" staged UI (`docs/PRODUCT_SPEC.md`) actually having real work to show
during each stage, not a decorative delay.

**Google Books was not real-tested this session** — no `GOOGLE_BOOKS_API_KEY` was
available. Open Library alone was validated live (see above) and is sufficient for
metadata lookup to function; Google Books activates automatically once a key is
added to `.env.local`, no code change required.

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
