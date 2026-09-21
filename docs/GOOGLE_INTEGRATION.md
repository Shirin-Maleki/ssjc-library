# Google Drive Integration

Phase 6's architecture for storing SOURCE/ORIGINAL cover photographs in Google Drive. See
`docs/GOOGLE_SETUP.md` for the setup walkthrough and `docs/SECURITY.md` for the security
posture. This document explains the *why* and the *shape*; `src/lib/googleDrive/` is the
authoritative implementation.

## Why Google Drive is not canonical catalog storage

PostgreSQL remains the single source of truth for every bibliographic fact about a book —
title, author, category, availability, everything Find/Book Detail/Reading Lists read.
Google Drive stores exactly one thing: the original photograph(s) of a physical book's
cover, archived for provenance. `books.cover_drive_file_id` etc. (see
`docs/DATA_MODEL.md` §5) are a *reference* to that photograph, not a duplication of
catalog data into Drive. Nothing about search, ranking, or the catalog schema changes in
this phase — see `docs/SEARCH.md`, which Phase 6 does not touch.

Google Drive also never serves images directly to a teacher-facing screen. Find and Book
Detail render `books.display_cover_url` (a separate, already-existing concept — see
`docs/DATA_MODEL.md` §5's fallback order), never a live Drive fetch. Turning Drive into an
ad hoc image CDN would tie ordinary page loads to Drive's latency and rate limits, which
it isn't designed for at that traffic pattern.

## OAuth architecture

One Google account, authorized once, via OAuth 2.0 Web Server flow with offline access
(`docs/GOOGLE_SETUP.md`). This is infrastructure authorization, not teacher identity — SSJC
staff continue authenticating through the existing shared staff-password/session system
(`docs/SECURITY.md`) regardless of Drive configuration.

**Real-world credential note (2026-09-20):** the design intent, and `docs/GOOGLE_SETUP.md`'s
primary documented path, is an SSJC Google Workspace account authorizing directly (OAuth
consent screen audience = Internal). Real Phase 6 validation found that SSJC's Workspace
currently blocks third-party OAuth app authorization pending an administrator review, so
that path could not be completed as-is. Real validation was instead performed with a Google
Cloud project under a personal Gmail account, granted access to the real SSJC Drive folder
via ordinary Drive folder sharing, with the OAuth consent screen running as External +
Testing. This proves the architecture described in this document works correctly end to
end — nothing about the architecture itself changed or depends on which of these two
authorizing-account paths is used. It is not, however, a finalized production credential
strategy — see `docs/GOOGLE_SETUP.md` and `docs/IMPLEMENTATION_STATUS.md`'s "Real Google
validation, 2026-09-20" for the full reasoning and the open production decision.

**Why OAuth instead of a service account:** the existing ~1,500-photo collection already
lives in ordinary Drive folders owned by real Workspace users, organized by whoever
photographed each section. A service account can't cleanly own or write into that
existing hierarchy without either Shared Drive migration or domain-wide delegation —
real complexity this project doesn't need. An OAuth-authorized real Workspace account can
read and write the existing hierarchy exactly as it already exists, with a refresh token
enabling unattended server operation (works on Vercel/serverless) without ever needing a
teacher to sign in with Google.

**Scopes**, deliberately narrow:

- `drive.readonly` — enumerate/inspect the existing collection, read/download when a
  later authorized backend task needs to.
- `drive.file` — create new files and manage files this application itself created.

Never the broad `drive` scope. If a future phase genuinely needs more, that's a deliberate,
reviewed decision — not a default to reach for.

## Credential lifecycle

| Credential | Lifetime | Where it lives | Ever sent to a browser? |
|---|---|---|---|
| Client ID / client secret | Until rotated in Cloud Console | `.env.local` / deployment secrets | Never |
| Refresh token | Until revoked/rotated | `.env.local` / deployment secrets | Never |
| Access token | ~1 hour | In-memory only (`oauthClient.ts`) | Never |
| Resumable upload session URI | Up to Google's own documented lifetime | Created and used entirely server-side (Phase 7 correction — see below) | **No, as implemented** — originally planned to cross to the browser (see below); real testing proved that specific mechanic doesn't survive browser CORS enforcement |

`src/lib/googleDrive/oauthClient.ts` exchanges the refresh token for a short-lived access
token, caches it in memory until shortly before expiry, and transparently refreshes when
needed. A cold serverless instance simply has no cache and refreshes once — this is
correct, not a bug to "fix" with persistence. **Access tokens are never written to
PostgreSQL, never logged, never returned from any function that isn't `oauthClient.ts`
itself.**

## Provider boundary

`src/lib/googleDrive/provider.ts` defines the `CoverStorageProvider` interface (and
`DriveProviderError`, `DriveFileMetadata`, and the other normalized types) —
`src/lib/googleDrive/googleDriveProvider.ts`'s `GoogleDriveCoverStorageProvider` is the one
concrete implementation. `src/lib/googleDrive/index.ts` is the one production entry point
(`getConfiguredCoverStorageProvider()`, `import "server-only"`), exactly mirroring how
`src/lib/embeddings/index.ts` gates `GeminiEmbeddingProvider` — a pattern already
established and proven in this codebase (`docs/SEARCH.md` §5), reused deliberately.

No Drive REST call, OAuth header, or Google response shape appears anywhere outside
`googleDriveProvider.ts` and `oauthClient.ts`. Every method returns application/domain
types (`DriveFileMetadata`, `DriveConnectionStatus`, …), never a raw Google SDK/REST
response object.

This is a narrow, Drive-specific boundary — not a general cloud-storage abstraction. No
S3/Azure/GCS interface exists or is planned; that generality isn't needed and would only
add indirection.

## Drive file identity

A Drive file's `id` is its durable identity — a rename only changes `name`, never `id`.
Filenames are preserved for human readability but never treated as identity anywhere in
this codebase (`DriveFileMetadata.id` is what every reference/foreign-key-like column,
e.g. `books.cover_drive_file_id`, actually stores). `ingestion_items.drive_file_id`
(pre-existing schema) is the same durable identity concept, reused, not duplicated —
Phase 6 introduces no second Drive-file identity system.

## My Drive / Shared Drive compatibility

The provider works correctly regardless of whether the configured root folder is a
My Drive-owned folder or lives inside a Shared Drive. Every relevant request sends
`supportsAllDrives=true`; listing additionally sends `includeItemsFromAllDrives=true`.
`verifyConnection()` reports whether the root has a `driveId` (Shared Drive) and, if so,
what it is — informational, not a behavior branch elsewhere in the code. No
`corpora=allDrives` broad search is ever performed; every listing is scoped by an explicit
parent-folder `q` query, because the root ID is already known configuration, never
discovered by searching the whole Drive.

## Root-folder security boundary

`GOOGLE_DRIVE_ROOT_FOLDER_ID` is this application's entire Drive boundary.
`src/lib/googleDrive/rootContainment.ts`'s `isWithinRoot()` walks a candidate file/folder's
real parent ancestry (breadth-first, cycle-guarded via a visited set, bounded to
`MAX_ANCESTRY_DEPTH` = 20 levels) looking for the configured root. An ID the authorized
account can technically access, but which isn't the root or a descendant of it, is
rejected with `outside_configured_root` — access to the OAuth account's broader Drive
never becomes reachable through this application merely because Google would allow it.

Every provider method that accepts a folder/file ID enforces this — `listChildren`,
`trashFile`, and, as of a 2026-09-20 correction, the public `getFileMetadata` itself.
**`getFileMetadata` is not a scoping exception**: it fetches raw metadata via a private
`fetchRawMetadata` and then checks containment before ever returning a result, so it can
never be used as an escape hatch for an arbitrary Drive ID the OAuth account happens to
have access to. `downloadSource`, `initiateResumableUpload`'s parent-folder check, and
`confirmUploadedFile` all call the (now containment-enforcing) public `getFileMetadata`
and no longer need their own separate check. The one deliberate exception is
`verifyConnection()`, which calls the private `fetchRawMetadata` directly for the
configured root's own metadata — checking the root's containment against itself would be
circular, not a real security gate (`assertMetadataWithinRoot` already short-circuits an
exact self-match, so calling the public method there would cost nothing extra, but the
private call makes the non-circularity explicit rather than incidental). See
`assertMetadataWithinRoot` in `googleDriveProvider.ts`, which — where a method has already
fetched the target's own metadata — walks from the `parents` array already in hand instead
of re-fetching the same file's parents a second time.

## Bounded listing

`listChildren(folderId, { pageSize, pageToken })` is non-recursive, paginated
(`nextPageToken`), and excludes trashed items (`trashed = false` in the query). Page size
is capped at a hard maximum (200) regardless of what's requested. There is no
whole-Drive or whole-folder-tree traversal anywhere in this codebase — Phase 6 proves the
existing ~1,500-photo collection is *enumerable*, never *enumerates* it in bulk.

## Source download

`downloadSource(fileId)` verifies the file is within the configured root, is not a
folder, is not trashed, and that the authorized account has download capability, before
fetching Drive's authorized binary content (`alt=media`). Never used to proxy an existing
photo into an ordinary teacher-facing screen — the only caller in this phase is
`google:smoke`'s own disposable test file.

## Resumable upload architecture — originally planned, corrected in Phase 7

Phase 6 designed this for a future browser (not implemented as UI in Phase 6):

```
browser File/Blob
  → authenticated SSJC server validates metadata/target folder
  → server calls initiateResumableUpload() → Drive resumable session
  → server returns ONLY the session URI to the browser
  → browser uploads bytes directly to Google's session URL
  → Google returns the resulting file's id
  → server calls confirmUploadedFile() to independently re-verify from Drive
```

**This does not work.** Real Playwright/Chromium testing during Phase 7
implementation proved it structurally impossible: Google's resumable-upload CORS
behavior is bound to the `Origin` header present at *session-creation* time, that
request is necessarily made server-side (no real browser `Origin`), and Drive's
own upload documentation exposes no CORS configuration surface at all (unlike
Cloud Storage buckets, which have one). A real browser PUT to a server-created
session is unconditionally blocked by CORS — reproduced live, not assumed. Full
evidence and reasoning in `docs/DECISIONS.md`, "Phase 7: the Phase 6-approved
direct-browser-to-Drive upload does not survive a real browser."

**What Phase 7 first built, and what it looks like now**: the first
server-mediated version had the browser POST the *entire* source photo to one
same-origin Route Handler in a single request. That worked, but the correction
pass (§1) found it was itself deployment-blocking: Vercel's real serverless
Function request-body limit is 4.5 MB, and source covers here are allowed up to
25 MiB — any cover over the limit would fail to deploy correctly. The final
architecture (`src/app/api/intake/cover/init/route.ts` +
`src/app/api/intake/cover/chunk/route.ts`) keeps the same server-mediated shape
but splits the relay into <=4 MiB chunks:

```
browser File/Blob
  → POST /api/intake/cover/init
      server performs initiateResumableUpload() (same call as before, same
      narrow binding to filename/MIME type/declared size/verified parent
      folder before ever contacting Drive)
      server encrypts the resulting Drive session URI into an opaque token
      (jose EncryptJWT/A256GCM, src/lib/intake/uploadSessionToken.ts) and
      returns ONLY that token to the browser
  → browser slices the file into <=4 MiB chunks and PUTs each to
      /api/intake/cover/chunk, echoing the same opaque token every time
      (real xhr.upload.onprogress per chunk, src/components/add/uploadToSession.ts)
  → server decrypts the token, relays each chunk to the real Drive session
      with a real Content-Range header (src/lib/intake/uploadChunking.ts),
      entirely server-side (never subject to browser CORS, exactly like
      scripts/google/smoke.ts's own real PUT)
  → Drive's 308 "Resume Incomplete" response (or an explicit empty-body
      Content-Range status-check request) tells the server exactly which
      bytes Drive actually has, driving real resume/retry of one chunk —
      never a blind resend of already-received bytes
  → once Drive reports the file complete, confirmUploadedFile() independently
      re-verifies it from Drive exactly as before, then the ingestion record
      is created (src/lib/intake/ingestionRecord.ts)
```

The browser still never receives a Drive URL, a real Drive session URI, an
OAuth token, or a client secret at any point — the encrypted opaque token it
holds is meaningless outside this server (2-hour TTL, `A256GCM`, key derived
from the existing `SESSION_SECRET` via HKDF with a distinct context string —
no new secret to manage). This is the same security property the original
design cared about, preserved through the chunking change, plus a new one:
no individual request this app makes to itself ever exceeds the chosen
deployment-safe chunk size, real-validated against live Drive with an
11.62 MB file — 3 chunks, each confirmed <=4 MiB, local MD5 matching Drive's
own returned `md5Checksum` exactly (original bytes preserved, no destructive
recompression).

## Completion verification

`confirmUploadedFile()` always re-fetches the resulting file's metadata directly from
Drive — it never trusts a browser- or caller-supplied claim about what was uploaded.
It verifies: the file exists, is within the configured root, has the expected parent,
MIME type, size, and filename, and captures the checksum when Drive supplies one
(`md5Checksum` — not every file type has one).

## Original source cover vs. display cover

Unchanged from the existing, already-reviewed schema (`docs/DATA_MODEL.md` §5) — Phase 6
adds no new columns and no new concept here. `books.cover_drive_*` represents the
original/source capture; `books.display_cover_url` / `display_cover_source` is
independently whatever's efficient to render. This phase does not implement the
`derived_from_drive` display-cover generation pipeline — that's a later phase's concern
once Phase 7 actually produces new source photos to derive a display cover from.

## Error behavior

Every failure is normalized to one `DriveErrorCategory` (`configuration_missing`,
`authorization_required`, `authorization_revoked_or_invalid`, `permission_denied`,
`root_folder_missing`, `file_not_found`, `outside_configured_root`, `invalid_file`,
`rate_limited`, `transient_provider_failure`, `upload_failed`, `download_failed`,
`unexpected_provider_failure`) via one `DriveProviderError` class
(`src/lib/googleDrive/provider.ts`). No thrown message ever contains a raw Google response
body, a token, a client secret, or a resumable session URI — see
`tests/unit/googleDrive/oauthClient.test.ts` and `googleDriveProvider.test.ts`'s explicit
secret-safety assertions. No Phase 6 UI exists yet to translate a category into a calm
teacher-facing message; that's for whichever phase first surfaces this to a screen.

## Retry behavior

`src/lib/googleDrive/retry.ts`'s `fetchWithRetry` retries only `429`, `500`, `502`, `503`,
`504`, and network-level failures — up to 3 retries, exponential backoff with jitter,
honoring a numeric `Retry-After` header when Google sends one. Never retries `400`
(malformed request), `401`/`403` (auth/permission), or `404` (not found) — none of those
can succeed on retry. This is a separate, slightly longer-backoff helper from
`src/lib/embeddings/geminiProvider.ts`'s own retry logic — the two serve different timing
needs (a live search request needing to degrade fast, vs. an upload/listing operation
that isn't on that same critical path) and are deliberately not shared.

## Supported storage MIME types

`src/lib/googleDrive/validation.ts`: `image/jpeg`, `image/png`, `image/webp`,
`image/heic`, `image/heif`. This is what Drive will *store* as a source cover — a
separate question from what a later AI/image-processing provider can *decode*. Do not
assume every listed format is universally supported downstream; that's a future phase's
own documented decision when it's made.

## 25 MiB source-photo limit

`MAX_SOURCE_COVER_SIZE_BYTES` (`validation.ts`) — intentionally far larger than a normal
compressed phone photo, bounded against an absurd upload. No teacher-facing validation UI
exists yet; only server/provider-level enforcement.

## How Phase 7 actually used this

Add a Book uploads directly under the configured root (`GOOGLE_DRIVE_ROOT_FOLDER_ID`)
— never into an existing photographer subfolder (`Shirin`/`Diamond`/`Ray` in the
real Drive folder, which hold the pre-existing ~1,500-photo collection and are
never written to by this application). See "Resumable upload architecture" above
for the corrected server-mediated flow, and `docs/AI_PIPELINE.md` for the full
pipeline this upload feeds into.

## How Phase 10 should enumerate this

Phase 10 (bulk import) is expected to: use `listChildren()` recursively (its own
recursion, at that phase's own pace and rate-limit budget — not something Phase 6
provides), `downloadSource()` each real photo it intends to process, and
`ingestion_items.drive_file_id` (pre-existing schema) to track which Drive file produced
which ingestion attempt. Phase 6 deliberately does not process, hash, or import anything
from the existing ~1,500-photo collection — it only proves the collection is reachable.

## Real validation evidence (2026-09-20)

`npm run google:smoke` was run against the real, configured SSJC Drive folder and passed
end to end — full transcript and full analysis of what each step proved (including the
authorizing-account credential context above) is in `docs/IMPLEMENTATION_STATUS.md`,
"Real Google validation, 2026-09-20." Summary of what this confirmed about the real
collection, not just the mocked test suite: the configured root ("Corridor books") is a
**My Drive folder, not a Shared Drive**; its three pre-existing photographer subfolders
(`Shirin`, `Diamond `, `Ray`) are real, reachable, and were confirmed unchanged before and
after the test; a real resumable upload, server-side confirmation (with a real MD5
checksum), byte-for-byte download, and trash-based cleanup all completed successfully
against Google's actual API — not a simulation of it.

## Real validation evidence (2026-09-21, Phase 7)

Two further real-browser/real-Drive validation passes, both against the real
configured folder, both cleaned up (disposable synthetic test file trashed, its
`ingestion_items`/`ingestion_jobs` rows deleted):

1. **The direct-browser-to-Drive upload was tested in a real Chromium browser**
   (Playwright, not a server-side `fetch`, which cannot detect a CORS failure at
   all) — reproduced the real CORS block described above, then re-tested after
   the server-mediated fix and confirmed it works: real staff login, real file
   selection, real click-through, reaching the post-upload "Identifying book…"
   stage with zero console errors.
2. **A bounded, explicitly-approved sample of 5 real existing photos** (2 JPEG, 3
   real iPhone HEIC) was read from the real collection's `Shirin`/`Diamond`/`Ray`
   subfolders via one bounded `listChildren` call per folder (never a recursive
   scan) to validate the AI pipeline end to end — full results in
   `docs/AI_PIPELINE.md` §10. All 5 real files were confirmed unchanged
   (`trashed: false`, original size) after the pass; nothing was renamed, moved,
   or modified.
