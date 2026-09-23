# Google Drive Setup

A step-by-step guide to connecting this application to the SSJC Library's Google Drive
photo collection (Phase 6). Written for someone who is comfortable using Google Cloud's
web console but isn't a professional Google Cloud administrator — every step names the
exact screen/button, not just the underlying concept.

This connects the application's *server* to Google Drive, once, using one Google account
authorized for this purpose. It is completely separate from how teachers sign in to this
app (they still use the shared staff password) — see `docs/GOOGLE_INTEGRATION.md` for why.

**What actually happened during real Phase 6 validation (2026-09-20), and what to do
differently if you're setting this up fresh:** the steps below describe the originally
intended path — an SSJC Workspace account authorizing directly, with the OAuth consent
screen set to Internal audience. In practice, SSJC's Workspace currently blocks
third-party OAuth app authorization pending an administrator review, so the SSJC Workspace
account itself could not complete step 6. Real validation was instead completed using a
Google Cloud project under a **personal Gmail account**, with the real SSJC Drive folder
shared to that account (Share → add the Gmail address → Editor access, from Drive's
ordinary sharing UI) so the authorization could reach it. The OAuth consent screen for that
project is **External + Testing**, not Internal. This worked and is sufficient to prove
the integration end to end (see `docs/IMPLEMENTATION_STATUS.md`, "Real Google validation,
2026-09-20," for the full transcript), but it is **not a finalized production credential
strategy** — an External + Testing OAuth app has its own constraints (a limited test-user
list, and consent screens Google may periodically require re-verifying). Before a real
production deployment, whoever owns that decision should either (a) get the SSJC Workspace
admin review completed so the app can run as Internal under the Workspace itself (the
path documented below), or (b) verify the External app for production use. Follow the
steps below as written if you're pursuing the Internal/Workspace path; if you hit the same
Workspace block, the personal-Gmail-account + folder-sharing approach above is a working
fallback for continued development, not a recommendation to skip the Workspace path
permanently.

## Before you start

You'll need:

- Access to the SSJC Google Workspace organization (an account that's a member of it).
- The Google Drive folder ID that holds the library's cover photographs. You (or whoever
  set this up) should already have this — it's the long string of letters/numbers in that
  folder's Google Drive URL, after `folders/`.
- This project's `.env.local` file, already set up for Phases 1–5 (see
  `docs/DATABASE_SETUP.md` if you haven't done that yet).

## 1. Create or select a Google Cloud project

1. Go to [console.cloud.google.com](https://console.cloud.google.com) and sign in with
   the SSJC Workspace account.
2. At the top of the page, use the project picker to either select an existing project
   that belongs to the SSJC organization, or create a new one (**New Project**). Name it
   something recognizable, e.g. "SSJC Library".

## 2. Enable the Google Drive API

1. In the Cloud Console's left sidebar, go to **APIs & Services → Library**.
2. Search for "Google Drive API".
3. Click it, then click **Enable**.

### 2b. Also enable the Google Sheets API (Phase 9)

Required only once the Teacher Catalog / `npm run sheets:sync` is used — the Sheets API is a
separate API from Drive and must be enabled independently, even though both share the same
OAuth credential and scope below. Real Phase 9 validation found this NOT enabled by default and
hit a real `SERVICE_DISABLED` 403 on first use — this is a one-time console step, not a code or
scope problem, and does not require re-running the authorization helper (step 6) or any new
consent.

1. In the Cloud Console's left sidebar, go to **APIs & Services → Library**.
2. Search for "Google Sheets API".
3. Click it, then click **Enable**.
4. If a request happens within the next minute or two, Google's own error message says to wait
   a few minutes for the change to propagate — this is normal.

## 3. Configure the Google Auth Platform (OAuth consent screen)

1. Go to **APIs & Services → OAuth consent screen** (Google may call this "Google Auth
   Platform" in newer console versions).
2. Choose **Internal** as the audience/user type. This means only accounts inside the
   SSJC Workspace organization can ever be authorized — never the general public. If
   "Internal" isn't available, your Cloud project isn't yet associated with the SSJC
   Workspace organization; fix that first (talk to whoever administers the organization).
   **If your Workspace blocks third-party OAuth app authorization pending admin review**
   (the real situation encountered during Phase 6 validation), you have two choices: get
   that review completed, or — as a working fallback for continued development, not a
   production plan — choose **External** audience instead, add yourself under **Test
   users**, and use a personal Google account whose Drive access to the real SSJC folder
   you've arranged via ordinary folder sharing. See the callout above "Before you start."
3. Fill in the required app name and support email (any reasonable values — this screen
   is never shown to teachers, only to the one SSJC Workspace account performing the
   one-time authorization in step 6 below).
4. Under **Data access / Scopes**, add these two scopes (search for "Drive" and select
   them by their exact description, or add them by ID):
   - `https://www.googleapis.com/auth/drive.readonly`
   - `https://www.googleapis.com/auth/drive.file`

   Do not add the broader `https://www.googleapis.com/auth/drive` scope — this
   application deliberately requests only these two (see `docs/GOOGLE_INTEGRATION.md`).

   **These same two scopes also cover the Google Sheets API (Phase 9)** — `drive.file` is a
   documented, valid scope for the Sheets API for spreadsheets this application itself creates,
   confirmed by real Phase 9 validation. No third scope, no separate consent, no re-running step
   6 is needed for Sheets sync to work — only enabling the Sheets API itself (step 2b above).

   **A Workspace administrator may need to approve this application's Drive scopes**
   before anyone in the organization can authorize it — if step 6 below fails with a
   message about the app being blocked or unverified, this is the most likely reason.

## 4. Create OAuth 2.0 Web Application credentials

1. Go to **APIs & Services → Credentials**.
2. Click **Create Credentials → OAuth client ID**.
3. Application type: **Web application**.
4. Name it anything recognizable, e.g. "SSJC Library server".
5. Under **Authorized redirect URIs**, add exactly:

   ```
   http://127.0.0.1:53682/oauth2/callback
   ```

   This is a *local* address on your own computer, used only during the one-time setup
   in step 6 — it is never reachable from the internet and nothing about it changes once
   this is deployed to production.
6. Click **Create**. Google shows you a **Client ID** and **Client secret** — copy both
   now (you can always come back to this screen later, but you'll need the secret in the
   next step regardless).

## 5. Place your credentials into `.env.local`

Open your local `.env.local` file and fill in:

```
GOOGLE_OAUTH_CLIENT_ID=<the Client ID from step 4>
GOOGLE_OAUTH_CLIENT_SECRET=<the Client secret from step 4>
GOOGLE_DRIVE_ROOT_FOLDER_ID=<the Drive folder ID from "Before you start">
```

Leave `GOOGLE_OAUTH_REFRESH_TOKEN` blank for now — the next step fills it in
automatically. Never type a value into it by hand, and never commit `.env.local` (it's
already gitignored).

**Only if you plan to run the bulk importer** (`docs/BULK_IMPORT.md`), also set:

```
GOOGLE_DRIVE_BULK_IMPORT_ROOT_FOLDER_ID=<the bulk-import source folder ID>
```

Deliberately a SEPARATE value from `GOOGLE_DRIVE_ROOT_FOLDER_ID` above, even if in your real
environment the bulk-import folder happens to be an ancestor of the interactive-flow folder (it
is, in this project's real setup) — this keeps the interactive flow's own Drive boundary exactly
as narrow as it already was, unaffected by whatever the bulk-import root is configured to.

## 6. Run the authorization helper

```bash
npm run google:authorize
```

This will:

1. Print a Google sign-in URL to your terminal.
2. Ask you to open that URL in a browser and sign in **with the SSJC Workspace account**
   that should own this integration's Drive access (this is the account whose Drive
   access the application will use — pick deliberately).
3. After you approve access, your browser is redirected back to your own computer, which
   the helper is listening for.
4. The helper exchanges what Google sent back for a long-lived refresh token and saves it
   directly into `.env.local` as `GOOGLE_OAUTH_REFRESH_TOKEN` — **the token itself is
   never printed to your terminal**, only a confirmation message.

If this fails with "Google did not return a refresh token," it usually means this same
account already authorized this application once before. Go to
[myaccount.google.com/permissions](https://myaccount.google.com/permissions), find this
application, remove its access, and run the command again.

## 7. Run the real connectivity test

```bash
npm run google:smoke
```

This performs a complete, real, but harmless round trip: it connects to your configured
Drive folder, reads (never changes) a small bounded sample of what's already there,
creates one tiny disposable test image, confirms it, downloads it back, deletes just that
one test file, and confirms nothing else in the folder was touched. It prints a step-by-step
transcript ending in either a clear success message or a specific, safe failure
description (never a raw Google error, never any credential).

## 8. Interpreting failures

| What you see | What it means |
|---|---|
| `configuration_missing` | One of the four `.env.local` variables above is still empty. |
| `authorization_required` / `authorization_revoked_or_invalid` | The refresh token is invalid or was revoked — re-run step 6. |
| `permission_denied` | The authorized account doesn't have the Drive permission this operation needs (e.g. can't write to the folder). Check sharing settings on the folder itself, and whether a Workspace admin needs to approve the app (step 3). If authorization itself fails before you ever reach `google:smoke` with a message about the app being blocked or requiring admin approval, that's the Workspace-policy block described above "Before you start" — not something this application's code can work around. |
| `root_folder_missing` | `GOOGLE_DRIVE_ROOT_FOLDER_ID` doesn't point at a real, accessible Drive folder. Double-check the ID. |
| `rate_limited` / `transient_provider_failure` | A temporary Google-side issue — wait a bit and try again. |

## 9. Configuring the same secrets in Vercel (production)

Once local setup is confirmed working, add the same four variables to your Vercel
project's Environment Variables (Project Settings → Environment Variables) for the
Production environment: `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`,
`GOOGLE_OAUTH_REFRESH_TOKEN`, `GOOGLE_DRIVE_ROOT_FOLDER_ID`. Use the exact same values as
your local `.env.local` — the refresh token doesn't change between environments; it's
tied to the one authorized account, not to where the server runs.

**Before actually deploying to production**, resolve which OAuth credential strategy you're
running: an Internal app under the SSJC Workspace (the intended path, requiring the admin
review above) is the durable choice. An External + Testing app (the working fallback used
for Phase 6's own real validation) is fine for continued development, but is not something
this document recommends carrying into production as-is — see the callout at the top of
this file and `docs/IMPLEMENTATION_STATUS.md`'s "Real Google validation" section for the
full reasoning. This is a deployment decision to make deliberately, not a step to skip.

## 10. Revoking or rotating access later

To revoke access entirely: go to
[myaccount.google.com/permissions](https://myaccount.google.com/permissions) (signed in
as the authorizing account), find this application, and remove its access. The stored
refresh token immediately stops working everywhere it's configured.

To rotate to a fresh refresh token without revoking first: simply run
`npm run google:authorize` again (with `prompt=consent`, Google always issues a new
refresh token) and update the deployment secret with the new value.

To switch which SSJC Workspace account owns this integration: revoke the old one, then
re-run `npm run google:authorize` signed in as the new account.
