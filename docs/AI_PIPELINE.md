# AI Pipeline

The AI/external-provider architecture behind Add a Book (Phase 7). For the
step-by-step teacher-facing workflow, see `docs/PRODUCT_SPEC.md`; for the schema
these steps read/write, see `docs/DATA_MODEL.md`; for why specific models/APIs/
providers were chosen, see `docs/DECISIONS.md`; for observed cost/latency, see
`docs/COSTS.md`.

## 1. Overview

One physical book, photographed once, produces one catalog entry (or one
additional copy of an existing one) through a single server-orchestrated pipeline:

```
cover photo (browser)
  → upload (server-mediated, chunked — /api/intake/cover/init + /chunk, see §6)
  → cover identification (Gemini vision, src/lib/ai/)
  → bibliographic metadata lookup (Google Books / Open Library, src/lib/metadataProviders/)
  → identity reconciliation (deterministic scoring, src/lib/intake/reconciliation.ts)
  → duplicate detection against the real catalog (src/lib/intake/duplicateMatcher.ts)
  → AI enrichment + physical-category suggestion (Gemini, src/lib/ai/)
  → teacher confirms / Quick Edits / Review Later
  → transactional save (src/lib/intake/persistence.ts)
```

Every provider call is server-only, Zod-validated, and individually
fails-gracefully — a vision, metadata, or enrichment failure degrades the intake
(fewer prefilled fields, a teacher correction, or Review Later) rather than
blocking it. The one hard requirement the pipeline cannot work around is a
confirmed Drive-stored source photo (§6) — Add a Book itself is unavailable
(placeholder shown) when Drive isn't configured.

## 2. Vision: cover identification

`src/lib/ai/geminiProvider.ts` — `GeminiBookIntelligenceProvider.identifyCover()`.

- **Model**: `gemini-3.8-flash` (re-confirmed current/stable/GA against
  `ai.google.dev` on 2026-09-20 — see `docs/DECISIONS.md` for the full
  re-confirmation record and the API-surface decision).
- **Input**: the analysis-derivative image (see §5) as `inlineData` (base64) plus
  a short text instruction. Never the Drive original's raw multi-megabyte bytes.
- **Output schema** (`src/lib/ai/schemas.ts`'s `CoverIdentificationSchema`, also
  the literal `responseSchema` sent to Gemini via `z.toJSONSchema()`):
  `visibleTitle`, `visibleSubtitle`, `visibleAuthors`, `visibleIllustrators`,
  `visiblePublisherOrImprint`, `visibleLanguage`, `visibleIsbn`, `visibleSeries`
  (all nullable — a real cover often doesn't show every field), plus
  `candidateSearchTerms` (≤5), `identityConfidenceLevel` (high/medium/low), and
  `evidenceNotes` (≤600 chars).
- **Evidence boundary** (the system instruction's real enforcement, not just a
  comment): Gemini is explicitly told to report only what's visibly printed on
  the cover and to leave a field `null` rather than guess — no invented ISBN,
  publication year, edition, page count, interior illustration medium, age range,
  or read duration. Schema-valid output still gets stored via
  `sourceType: "cover_visible"` provenance, distinct from `ai_inferred"` (used for
  enrichment guesses) — see `docs/DATA_MODEL.md` §"Provenance".
- **Timeout**: 20 seconds (`VISION_TIMEOUT_MS`), enforced via `Promise.race`.
- **Retry**: `src/lib/ai/retry.ts`'s `withGeminiRetry()` — up to 2 retries on
  429/500/502/503/504, exponential backoff (1s base, 6s cap) with jitter. Built
  specifically because structured-output calls to this model were observed to
  intermittently return real HTTP 503s during implementation — see
  `docs/DECISIONS.md`.
- **Error categories** (`AIProviderError`): `configuration_missing`,
  `invalid_image`, `rate_limited`, `transient_provider_failure`, `timeout`,
  `invalid_response`, `unexpected_provider_failure` — each maps to a calm,
  teacher-facing message; the browser never sees a raw Gemini error.

## 3. Bibliographic metadata lookup

`src/lib/metadataProviders/` — `BookMetadataProvider` interface, two adapters.

| Provider | Used when | Endpoint | Notes |
|---|---|---|---|
| Google Books | `GOOGLE_BOOKS_API_KEY` configured | `googleapis.com/books/v1/volumes` | Preferred first — better coverage. ISBN search when available, else `intitle`/`inauthor`/`inpublisher`. Max 5 results, 5s timeout. |
| Open Library | Always (needs no key) | `openlibrary.org/search.json` (current Search API — **not** the legacy `/api/books` endpoint) | Fallback/only provider when Google Books is unconfigured. Sends a descriptive `User-Agent` per Open Library's own guidance. `language` values are 3-letter MARC codes, passed through unmapped (reconciliation maps a small known set). |

`src/lib/intake/metadataLookup.ts` chains them: builds one query from the vision
evidence (ISBN preferred, else title+author+language), checks
`metadata_provider_cache` first (`src/lib/metadataProviders/cache.ts`, 30-day
TTL, key = ISBN or normalized title+author+language — a genuinely different key
per evidence shape, not one shared cache line), calls the configured providers in
order, stops early once a confirmed ISBN match is found, and caches whatever
comes back. Both adapters normalize into one shared
`NormalizedMetadataCandidate` shape — no raw Google Books/Open Library JSON ever
reaches the domain layer.

## 4. Identity reconciliation

`src/lib/intake/reconciliation.ts` — deterministic, centrally-weighted scoring,
never "ask Gemini which result is correct" (an LLM call would be non-reproducible
and unauditable for what is fundamentally a string/field matching problem).

Weights (`reconciliationConfig.ts`): ISBN match 100, title match 45, author match
30, subtitle match 15, language match 10, publisher match 10.
`HIGH_CONFIDENCE_THRESHOLD = 75`, `AMBIGUOUS_THRESHOLD = 30`. An ISBN match alone
clears high-confidence; a strong title+author combination also does. Below 30, the
identity is `unresolved` regardless of how many candidates were returned.

## 5. Image handling

`src/lib/intake/imagePrep.ts` — `prepareAnalysisImage()`. Builds a resized
*analysis derivative* (longest edge 1024px, JPEG quality 82) purely for the vision
call — never persisted, never sent to Drive, never affecting the source-of-record
original (which Drive already has byte-for-byte, per Phase 6).

**Real, tested finding**: this deployment's `sharp`/libvips build reports
`heif` input support as `{ fileSuffix: ['.avif'] }` only — it cannot decode real
iPhone-style HEIC photos (full HEIC decode needs a separately-licensed libheif
build this deployment doesn't have). `prepareAnalysisImage()` therefore skips
resizing for `image/heic`/`image/heif` specifically and passes the original bytes
through unchanged, relying on Gemini's own documented HEIC/HEIF input support
rather than a fragile custom conversion path. JPEG/PNG/WebP all resize
successfully through the same tested code path. If `sharp` fails on any format for
any other reason (corrupt bytes, an unexpected quirk), the function falls back to
the original bytes rather than failing the whole intake over an optimization.

Client-side capture (`src/components/add/CoverCapture.tsx`) accepts
`image/jpeg,image/png,image/webp,image/heic,image/heif`, max 25 MiB, with
`capture="environment"` for a mobile camera hint — a standard accessible file
input, not a custom camera UI.

## 6. Google Drive integration (source storage)

Full architecture in `docs/GOOGLE_INTEGRATION.md`; the two things that changed
since the original Phase 7 design are documented in detail in `docs/DECISIONS.md`.

**First** (original implementation): **the originally-approved
direct-browser-to-Drive upload does not work** — real Chromium testing proved
Google's resumable-upload CORS behavior is bound to the `Origin` header present at
session-*creation* time, which is necessarily server-side here, so a browser can
never successfully PUT to a server-created session. The corrected architecture
became server-mediated instead.

**Second** (Phase 7 correction pass §1): a naive server-mediated upload — the
browser POSTing the entire source photo in one request — would itself exceed
Vercel's real 4.5 MB serverless Function request-body limit for any cover over
that size (this pipeline allows source covers up to 25 MiB). The final,
deployment-safe architecture chunks the relay:

```
browser File
  → POST /api/intake/cover/init (src/app/api/intake/cover/init/route.ts)
      server creates a Drive resumable-upload session
      browser receives an encrypted, opaque upload-session token — never a
      usable Google URL/credential of any kind
  → browser sends <=4 MiB chunks to PUT /api/intake/cover/chunk
      (src/app/api/intake/cover/chunk/route.ts), one request per chunk
  → server relays each chunk to the Drive resumable session using real
      Content-Range semantics (src/lib/intake/uploadChunking.ts,
      src/components/add/uploadToSession.ts)
  → Drive's own authoritative received-offset (its 308 "Resume Incomplete"
      response, or an explicit empty-body status-check request) drives
      retry/resume of an interrupted chunk — never a blind resend
  → once Drive confirms the file complete, the server independently confirms
      the final Drive object and creates the ingestion record
      (src/lib/intake/ingestionRecord.ts)
```

Real Drive OAuth tokens/client secret never reach the browser, exactly as
before. The Drive resumable-session URI itself also never reaches the browser
in any form — it lives only inside the encrypted token
(`src/lib/intake/uploadSessionToken.ts`, a `jose` JWE, `A256GCM`, key derived
from `SESSION_SECRET` via HKDF with a distinct context string — never a second
secret to manage) that the browser holds opaquely and echoes back on each
chunk request. Original bytes are preserved end to end — no destructive
recompression — and no individual browser→server request exceeds the chosen
4 MiB chunk bound, real-validated against live Drive with an 11.62 MB file
(2.6x over Vercel's limit): 3 chunks, each confirmed <=4 MiB, local MD5
matching Drive's own returned `md5Checksum` exactly.

## 7. Duplicate detection

`src/lib/intake/duplicateMatcher.ts` — dedicated to catalog-identity matching, not
a reuse of Find's relevance-ranked search. Two targeted queries: exact ISBN match
(if the identity has one), and `pg_trgm` title similarity (the same `%`
index-accelerated operator `SearchRepository` already uses, a separate threshold
constant since these are different concerns). A 0.4 floor filters noise; ≥0.7 (or
an exact normalized-title match) counts as "same title." Combined with
author-overlap and language-match, this classifies into `exact_copy_same_edition`,
`same_work_different_language`, `same_title_different_edition`,
`ambiguous_similar_title`, or `no_match` — never an automatic merge; every
non-`no_match` outcome is a teacher decision (`DuplicateCheck.tsx`).

## 8. AI enrichment + physical category suggestion

`GeminiBookIntelligenceProvider.suggestEnrichment()` — runs only after
reconciliation has established real evidence, and only sends text (validated
cover evidence + trusted metadata summary), never the image again.

Output (`EnrichmentSuggestionSchema`): `description` (1-2 plain sentences, no
sales language), `tags` (≤8, normalized against existing tags), `fictionType`,
`format`, `ageMinMonths`/`ageMaxMonths`, `readAloudMinutes`, `visualMediaTypes`
(≤3), `visualRealism`, and `physicalCategorySlug` + `categoryConfidence` +
`categoryReason`. Every field is nullable by design — an absent value is correct
and preferred over a plausible-sounding guess.

**Category enforcement is an application check, not model trust**: Gemini is
*told* the exact current active category list in its system instruction
(built fresh from `categoryRepository.listActiveCategories()` on every call), but
`src/lib/intake/categorySuggestion.ts`'s `validateCategorySuggestion()` is the
actual boundary — it returns `undefined` (never a fabricated fallback) unless the
suggested slug is genuinely in the live active list at save time.

## 9. Provider factories and the E2E fixture seam

Every provider is behind a `getConfigured*Provider()` factory
(`src/lib/ai/index.ts`, `src/lib/metadataProviders/index.ts`,
`src/lib/googleDrive/index.ts`) that returns `undefined` (or, for metadata, an
empty array) — never throws — when its environment variable(s) are unset. This is
the same pattern Phase 5's embedding provider established: "not configured" is a
normal, expected state every dependent code path degrades through gracefully.

`src/lib/intake/e2eFixtures.ts` + `src/lib/e2eTestFlags.ts` add one narrow,
env-gated seam (`E2E_FAKE_INTAKE_PROVIDERS=true`, set only in
`playwright.config.ts`'s `webServer.env`) so the Playwright suite can drive the
whole flow without ever calling a live API (§49 of the Phase 7 brief). See those
files' own doc comments and `docs/TESTING.md` for what's faked and why real E2E
titles needed a fresh `randomUUID()` per call (an empirically-measured `pg_trgm`
similarity collision between test-created titles, not a production concern).

## 10. Real-provider validation (2026-09-21)

Performed using 5 real photos from the actual SSJC Drive collection — explicitly,
narrowly approved for this one-time bounded validation (a single bounded
`listChildren` per folder, never a recursive scan of the ~1,500-photo collection;
read-only via the existing Phase 6 provider; nothing renamed, moved, modified, or
deleted; no temporary local copy retained afterward).

| Case | Format | Result |
|---|---|---|
| "My First Human Body Book" (Dover Coloring Book) | JPEG, 3.2 MB | Resize succeeded (146 KB). Gemini identify failed — real, sustained rate limit (see below), not retried further after establishing the pattern. |
| "Kenny and the Little Kickers" (Scholastic) | JPEG, 6.4 MB | **Full success.** Resize (167 KB) → Gemini identified title/author/language correctly, high confidence, quoting real cover text → Open Library found 2 real matching candidates → reconciliation scored 95 (`high_confidence`) → duplicate check correctly returned `no_match` against the real seeded catalog → a real `saveNewBook` transaction succeeded (verified the row, then cleaned up). |
| 3 real iPhone photos | HEIC, 3.6-4.9 MB | Real Drive download succeeded for all 3; `prepareAnalysisImage` correctly passed each through unresized (§5's documented HEIC limitation). Gemini identify failed for all 3 — same rate limit. |

**Rate limit, investigated, not just observed once**: retried with 25s gaps
between cases, then a dedicated 90-second wait, then a 3-minute canary retry —
still `rate_limited` every time. This pattern (failure persists across
minutes-long waits, not just a burst) indicates a real free-tier **daily** quota
exhausted by this same session's cumulative real Gemini usage (initial
implementation-time testing plus this validation pass), not a transient rate
limit a short backoff would fix, and not a code defect — the one case that ran
before the quota was hit worked correctly end to end.

**Honest scope of what this does and doesn't prove**: the full pipeline
(vision → metadata → reconciliation → duplicate-check → save) is now proven
correct end to end with one real photo and real external services. HEIC's
resize-skip/passthrough logic is proven correct with 3 real iPhone files. Gemini
actually accepting real HEIC bytes in a live call was **not** re-confirmed in this
session (the earlier documentation-based confirmation in `docs/DECISIONS.md`
stands, but wasn't independently re-verified with a fresh live call here) — this
is reported honestly rather than claimed as freshly tested.

## 10b. Real-provider validation, round 2 (2026-09-21, correction pass §8)

The original round's rate limit turned out to be a genuine free-tier **daily**
quota — it had reset by the time this correction pass reached §8 (confirmed
with a real canary call before spending further effort). A fresh bounded
sample (2 new real JPEGs, 1 new real iPhone HEIC — same approved, read-only,
single-`listChildren`-per-folder method as round 1) was run for the §8
requirement of at least 3 successful real cases covering a straightforward
English cover, a non-English/Scandinavian cover, and an ambiguous/duplicate-
exercising case, preferring a real HEIC case.

| Case | Format | Result |
|---|---|---|
| "The Cat Food Mystery" (Stone Arch Readers) | JPEG, 2.25 MB | **Full success through duplicate-check.** Gemini identified title/author/language correctly (high confidence) → Open Library found a real match (real ISBN 9781434225115, real thumbnail URL) → reconciliation scored 85 (`high_confidence`) → **`selectTrustworthyDisplayCoverUrl` selected a real, trustworthy display cover URL for the first time against a live, non-fixture provider response** → duplicate check correctly returned `no_match`. Enrichment specifically hit a real, transient rate limit on this attempt. |
| Real iPhone photo | HEIC, 3.56 MB | Real Drive download and resize-skip/passthrough succeeded. Gemini identify was attempted 3 times across ~5 minutes with real backoff (immediate, 90s, 60s) — `rate_limited`/timeout every time. |
| "Megan Rapinoe" (My Itty-Bitty Bio) | JPEG, 2.79 MB | Same real download/resize success; Gemini identify attempted 3 times with real backoff — `rate_limited`/timeout every time. |

**Non-English/Scandinavian case: not found within a small bounded sample.**
7 real photos were visually inspected across this validation effort (rounds 1
and 2 combined) — all clearly-photographed covers were in English. One
partially-visible book in the background of an unrelated photo ("Sam's Ball"
by Lindgren & Eriksson — Astrid Lindgren, a real Swedish author) suggests
Scandinavian-language books likely exist in the real collection, but none
were the actual subject of any photo in this bounded sample. Reported
honestly per the correction brief's own instruction, rather than expanding
into a broader/recursive search of the ~1,500-photo collection to find one.

**Net result across both validation rounds, stated precisely (Phase 7 final
closure pass §4 corrected the wording here — the previous draft of this
section overstated "The Cat Food Mystery" as a full success)**: round 1
produced exactly **one** genuinely complete real end-to-end case ("Kenny and
the Little Kickers" — identify through a real `saveNewBook`). Round 2's "The
Cat Food Mystery" reached identity → metadata → reconciliation →
duplicate-check → display-cover selection correctly, but its enrichment call
specifically hit a real, transient rate limit on that attempt — a genuine
partial success, not a full end-to-end one. The HEIC case and "Megan Rapinoe"
both failed at identification. **Across both rounds: 1 fully complete
real end-to-end case, 1 partial success (through duplicate-check, enrichment
not reached), 2 failures at identification** — short of the requested 3 full
successes. This reflects genuinely observed Gemini capacity constraints under
sustained real testing across multiple sessions, not unwillingness to retry —
see `docs/COSTS.md` for the consolidated rate-limit finding, including a
concrete real quota number discovered in §10c below. Real HEIC-with-Gemini
remains unconfirmed by a fresh live call as of this pass, for the same
reason.

## 10c. One bounded final real-provider attempt (2026-09-21, final closure pass §5)

After the §1-§9 code fixes, one additional bounded attempt was made to reach a
third full real-cover case, as the closure pass explicitly requested — a
minimal real Gemini call (a text-only canary, not even a full vision call),
retried a small, bounded number of times with real gaps, never a
multi-minute campaign:

1. Immediate attempt: real HTTP 503, `"This model is currently experiencing
   high demand. Spikes in demand are usually temporary."`
2. Retried after a real 20-second gap: real HTTP 429,
   `RESOURCE_EXHAUSTED`, with Google's own error body naming the exact
   constraint: **`GenerateRequestsPerDayPerProjectPerModel-FreeTier`,
   quotaValue: 20** — i.e., this Google Cloud project's free tier allows
   only **20 `gemini-3.8-flash` requests per day, total**, and this session's
   cumulative real calls (this pass's own retries plus everything already
   spent today) had exhausted it.
3. Retried once more after another real 20-second gap: real HTTP 503 (high
   demand) again.

Stopped here — 3 real attempts with real backoff is a reasonable bounded
effort for what the brief asked ("do not spend hours retrying... if still
blocked after reasonable retries, report that honestly and STOP"). No third
full real-cover case was reached this pass. **This is a genuinely valuable
finding despite the non-result**: it's the first time this project has seen
Google's own error body name the exact daily quota number (20 requests/day)
rather than just observing "still rate-limited after N minutes" — this
finally gives a concrete, documented explanation for the rate-limiting
pattern observed across every validation session so far, recorded in
`docs/COSTS.md`.

## 11. What's out of scope for Phase 7

Per the Phase 7 brief's own explicit exclusions: no bulk processing of the
existing ~1,500-photo collection, no Phase 8 Admin Review interface, no Google
Sheets/Sheet sync, no new display-image storage service. See
`docs/IMPLEMENTATION_STATUS.md` for the full Phase 7 boundary.
