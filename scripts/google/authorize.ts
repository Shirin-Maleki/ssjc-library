import "../../src/db/loadEnv";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

/**
 * One-time interactive OAuth 2.0 setup helper (Phase 6, `docs/GOOGLE_SETUP.md`) —
 * `npm run google:authorize`. Obtains a Google OAuth refresh token for one SSJC Workspace
 * account and saves it into `.env.local`, without the user ever having to manually copy an
 * authorization code or token out of a browser URL bar.
 *
 * This is a LOCAL, interactive, one-time setup tool — never run in production, never
 * exposed as a web route, never invoked automatically. It never prints a token, a client
 * secret, or an authorization code to the terminal (see every place below that
 * deliberately logs a byte length or a generic confirmation instead of the value itself).
 */

const REDIRECT_URI = "http://127.0.0.1:53682/oauth2/callback";
const CALLBACK_PORT = 53682;
const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const SCOPES = ["https://www.googleapis.com/auth/drive.readonly", "https://www.googleapis.com/auth/drive.file"];
const ENV_LOCAL_PATH = ".env.local";

function fail(message: string): never {
  console.error(`\n${message}\n`);
  process.exit(1);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    fail(
      `Missing ${name} in .env.local. See docs/GOOGLE_SETUP.md — create an OAuth 2.0 Web ` +
        `Application client first, then place its client ID/secret in .env.local before running this.`
    );
  }
  return value;
}

interface CallbackResult {
  code?: string;
  state?: string;
  error?: string;
}

/** Starts a temporary localhost server, waits for exactly one OAuth callback request, then
 * closes itself. Resolves with the callback's query parameters (never logged as a whole —
 * only `state` is ever compared, `code` is passed straight to the token exchange). */
function waitForCallback(): Promise<CallbackResult> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", REDIRECT_URI);
      if (url.pathname !== "/oauth2/callback") {
        res.writeHead(404).end();
        return;
      }
      const result: CallbackResult = {
        code: url.searchParams.get("code") ?? undefined,
        state: url.searchParams.get("state") ?? undefined,
        error: url.searchParams.get("error") ?? undefined,
      };
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(
        result.error
          ? "<html><body><p>Authorization failed. You can close this tab and check the terminal.</p></body></html>"
          : "<html><body><p>Authorization received. You can close this tab and return to the terminal.</p></body></html>"
      );
      server.close();
      resolve(result);
    });
    server.on("error", reject);
    server.listen(CALLBACK_PORT, "127.0.0.1");
  });
}

/** Reads `.env.local`, replaces (or appends) exactly one `KEY=` line, and writes the file
 * back — every other line/value is preserved untouched. The written value has every
 * literal `$` escaped as `\$`, exactly like `scripts/hash-password.mjs` already does for
 * bcrypt hashes — a real Google refresh token can itself contain `$`-adjacent characters,
 * and Next.js's `.env` loader otherwise silently mangles them (`docs/SECURITY.md`). Never
 * logs the file's contents (which may hold other real secrets) at any point.
 */
async function upsertEnvLocalValue(key: string, value: string): Promise<void> {
  let contents: string;
  try {
    contents = await readFile(ENV_LOCAL_PATH, "utf8");
  } catch {
    contents = "";
  }

  const escapedValue = value.replaceAll("$", "\\$");
  const line = `${key}=${escapedValue}`;
  const pattern = new RegExp(`^${key}=.*$`, "m");

  const updated = pattern.test(contents) ? contents.replace(pattern, line) : `${contents.replace(/\n?$/, "\n")}${line}\n`;

  await writeFile(ENV_LOCAL_PATH, updated, "utf8");
}

async function main() {
  const clientId = requireEnv("GOOGLE_OAUTH_CLIENT_ID");
  const clientSecret = requireEnv("GOOGLE_OAUTH_CLIENT_SECRET");

  const state = randomBytes(32).toString("base64url");

  const authUrl = new URL(AUTH_ENDPOINT);
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", SCOPES.join(" "));
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");
  authUrl.searchParams.set("state", state);

  console.log("\nOpen this URL in a browser and sign in with the SSJC Workspace account that");
  console.log("should own this integration's Drive access:\n");
  console.log(authUrl.toString());
  console.log(`\nWaiting for the browser to redirect back to ${REDIRECT_URI} ...`);

  const result = await waitForCallback();

  if (result.error) {
    fail(`Google returned an authorization error: ${result.error}`);
  }
  if (!result.state || result.state !== state) {
    fail("The callback's state parameter did not match — aborting for safety. Please try again.");
  }
  if (!result.code) {
    fail("No authorization code was returned in the callback.");
  }

  console.log("Authorization code received. Exchanging it for tokens...");

  const tokenResponse = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: result.code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: REDIRECT_URI,
      grant_type: "authorization_code",
    }).toString(),
  });

  if (!tokenResponse.ok) {
    fail(
      `Google's token endpoint returned HTTP ${tokenResponse.status}. This usually means the ` +
        `client ID/secret don't match a Web Application OAuth client with ${REDIRECT_URI} as an ` +
        `authorized redirect URI — see docs/GOOGLE_SETUP.md.`
    );
  }

  const body = (await tokenResponse.json()) as { refresh_token?: string; access_token?: string };

  if (!body.refresh_token) {
    fail(
      "Google did not return a refresh token. This typically happens when this account has " +
        "already authorized this application before and Google is reusing a prior grant. Visit " +
        "https://myaccount.google.com/permissions, remove this application's access, then run " +
        "`npm run google:authorize` again."
    );
  }

  await upsertEnvLocalValue("GOOGLE_OAUTH_REFRESH_TOKEN", body.refresh_token);

  console.log("\nSuccess. A refresh token was saved to .env.local as GOOGLE_OAUTH_REFRESH_TOKEN.");
  console.log("(The token itself was never printed to this terminal.)");
  console.log("\nNext: run `npm run google:smoke` to verify the connection end to end.\n");
}

main().catch((error) => {
  console.error("\nAuthorization failed:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
