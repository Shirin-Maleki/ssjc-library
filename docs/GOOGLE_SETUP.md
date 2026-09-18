# Google Drive Setup

A step-by-step guide to connecting this application to the SSJC Library's Google Drive
photo collection (Phase 6). Written for someone who is comfortable using Google Cloud's
web console but isn't a professional Google Cloud administrator — every step names the
exact screen/button, not just the underlying concept.

This connects the application's *server* to Google Drive, once, using one SSJC Workspace
account. It is completely separate from how teachers sign in to this app (they still use
the shared staff password) — see `docs/GOOGLE_INTEGRATION.md` for why.

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

## 3. Configure the Google Auth Platform (OAuth consent screen)

1. Go to **APIs & Services → OAuth consent screen** (Google may call this "Google Auth
   Platform" in newer console versions).
2. Choose **Internal** as the audience/user type. This means only accounts inside the
   SSJC Workspace organization can ever be authorized — never the general public. If
   "Internal" isn't available, your Cloud project isn't yet associated with the SSJC
   Workspace organization; fix that first (talk to whoever administers the organization).
3. Fill in the required app name and support email (any reasonable values — this screen
   is never shown to teachers, only to the one SSJC Workspace account performing the
   one-time authorization in step 6 below).
4. Under **Data access / Scopes**, add these two scopes (search for "Drive" and select
   them by their exact description, or add them by ID):
   - `https://www.googleapis.com/auth/drive.readonly`
   - `https://www.googleapis.com/auth/drive.file`

   Do not add the broader `https://www.googleapis.com/auth/drive` scope — this
   application deliberately requests only these two (see `docs/GOOGLE_INTEGRATION.md`).

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
| `permission_denied` | The authorized account doesn't have the Drive permission this operation needs (e.g. can't write to the folder). Check sharing settings on the folder itself, and whether a Workspace admin needs to approve the app (step 3). |
| `root_folder_missing` | `GOOGLE_DRIVE_ROOT_FOLDER_ID` doesn't point at a real, accessible Drive folder. Double-check the ID. |
| `rate_limited` / `transient_provider_failure` | A temporary Google-side issue — wait a bit and try again. |

## 9. Configuring the same secrets in Vercel (production)

Once local setup is confirmed working, add the same four variables to your Vercel
project's Environment Variables (Project Settings → Environment Variables) for the
Production environment: `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`,
`GOOGLE_OAUTH_REFRESH_TOKEN`, `GOOGLE_DRIVE_ROOT_FOLDER_ID`. Use the exact same values as
your local `.env.local` — the refresh token doesn't change between environments; it's
tied to the one authorized SSJC Workspace account, not to where the server runs.

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
