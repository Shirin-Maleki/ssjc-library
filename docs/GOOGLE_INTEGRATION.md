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

One SSJC Google Workspace account authorizes this application once, via OAuth 2.0 Web
Server flow with offline access (`docs/GOOGLE_SETUP.md`). This is infrastructure
authorization, not teacher identity — SSJC staff continue authenticating through the
existing shared staff-password/session system (`docs/SECURITY.md`) regardless of Drive
configuration.

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
| Resumable upload session URI | Up to Google's own documented lifetime | Passed server→browser for one upload, never persisted | **Yes — the one exception, by design (see below)** |

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

Every provider method that accepts a folder/file ID enforces this (`listChildren`,
`downloadSource`, `initiateResumableUpload`'s parent, `confirmUploadedFile`, `trashFile`).
Where a method already fetched the target's own metadata for another reason (its
`parents` array is already in hand), the containment check reuses that instead of
re-fetching the same file's parents a second time — see `assertMetadataWithinRoot` in
`googleDriveProvider.ts`.

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

## Resumable upload architecture

Designed for a future browser (Phase 7), not implemented as UI in Phase 6:

```
browser File/Blob
  → authenticated SSJC server validates metadata/target folder
  → server calls initiateResumableUpload() → Drive resumable session
  → server returns ONLY the session URI to the browser
  → browser uploads bytes directly to Google's session URL
  → Google returns the resulting file's id
  → server calls confirmUploadedFile() to independently re-verify from Drive
```

The browser never receives an OAuth token or client secret — only the resumable session
URI, treated as sensitive ephemeral capability data (never logged, never persisted beyond
the immediate upload, never in analytics or error messages). `initiateResumableUpload()`
binds the session narrowly to an exact filename, MIME type, declared size, and verified
parent folder before ever contacting Drive.

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

## How Phase 7 should use this

Phase 7 (Add Book intake) is expected to: call `initiateResumableUpload()` from an
authenticated Server Action after validating the intended target folder and file
metadata, hand the browser only the resulting session URI, let the browser upload bytes
directly to Google, then call `confirmUploadedFile()` server-side before writing the
resulting Drive file id into `books.cover_drive_file_id` (and friends). Phase 7 owns
choosing exactly *which* folder under the root a new upload's parent should be (e.g. a
per-batch or per-date subfolder) — Phase 6 only proves the mechanism works for any
verified-in-root parent.

## How Phase 10 should enumerate this

Phase 10 (bulk import) is expected to: use `listChildren()` recursively (its own
recursion, at that phase's own pace and rate-limit budget — not something Phase 6
provides), `downloadSource()` each real photo it intends to process, and
`ingestion_items.drive_file_id` (pre-existing schema) to track which Drive file produced
which ingestion attempt. Phase 6 deliberately does not process, hash, or import anything
from the existing ~1,500-photo collection — it only proves the collection is reachable.
