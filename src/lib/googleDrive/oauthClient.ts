import { DriveProviderError } from "./provider";
import { loadDriveConfig } from "./config";
import { fetchWithRetry } from "./retry";

/**
 * Server-side OAuth 2.0 token management for the Drive integration (Phase 6, §11 of the
 * phase brief). The refresh token (`GOOGLE_OAUTH_REFRESH_TOKEN`) is the durable credential,
 * obtained once via `npm run google:authorize`; access tokens are short-lived (~1 hour) and
 * exchanged for on demand here, cached only in memory.
 *
 * Deliberately NOT `import "server-only"` in this file — this module needs direct,
 * deterministic unit tests against a mocked token endpoint (`tests/unit/googleDrive/
 * oauthClient.test.ts`), and `server-only` throws unconditionally under Vitest, exactly the
 * lesson this codebase already learned the hard way for `DrizzleBookRepository`
 * (`docs/AGENT_HANDOFF.md`: "`server-only` belongs on `src/db/client.ts` alone — never on a
 * [testable] class"). The actual guarantee — this module's secrets never reach a Client
 * Component — is enforced at `src/lib/googleDrive/index.ts`, the one factory production
 * code actually imports, exactly mirroring `src/lib/embeddings/index.ts`.
 */

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

/** Refresh this many milliseconds before the token's real expiry — never wait until the
 * exact edge, where a concurrent in-flight request could still be using a token Google is
 * about to consider expired. */
const EXPIRY_SAFETY_MARGIN_MS = 60_000;

interface CachedAccessToken {
  token: string;
  /** Epoch milliseconds. */
  expiresAt: number;
}

let cachedAccessToken: CachedAccessToken | undefined;

interface TokenErrorResponseBody {
  error?: string;
  error_description?: string;
}

interface TokenSuccessResponseBody {
  access_token?: string;
  expires_in?: number;
}

/**
 * Returns a valid access token, refreshing transparently when the cached one is missing,
 * expired, or within `EXPIRY_SAFETY_MARGIN_MS` of expiring. Safe to call from every request
 * — a cold serverless instance simply has no cache yet and refreshes once, exactly the
 * behavior §11 requires ("work correctly if serverless instances restart and lose the
 * memory cache").
 *
 * Never persists the access token anywhere but this module's own in-memory variable —
 * never PostgreSQL, never a log line, never a thrown error message.
 */
export async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (cachedAccessToken && cachedAccessToken.expiresAt - EXPIRY_SAFETY_MARGIN_MS > now) {
    return cachedAccessToken.token;
  }

  const config = loadDriveConfig();
  const response = await fetchWithRetry(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: config.refreshToken,
      grant_type: "refresh_token",
    }).toString(),
  });

  if (!response.ok) {
    throw await mapTokenEndpointError(response);
  }

  let body: TokenSuccessResponseBody;
  try {
    body = (await response.json()) as TokenSuccessResponseBody;
  } catch (error) {
    throw new DriveProviderError("unexpected_provider_failure", "Google's OAuth token response was not valid JSON.", error);
  }

  if (!body.access_token || !body.expires_in) {
    throw new DriveProviderError(
      "unexpected_provider_failure",
      "Google's OAuth token response was missing access_token or expires_in."
    );
  }

  cachedAccessToken = { token: body.access_token, expiresAt: now + body.expires_in * 1000 };
  return cachedAccessToken.token;
}

/**
 * Maps a failed token-refresh response to a category — deliberately never includes the
 * response body (which can, for a genuinely malformed/adversarial response, contain
 * arbitrary attacker-controlled text) in the thrown message. `invalid_grant` specifically
 * means the stored refresh token was revoked or has expired and re-authorization
 * (`npm run google:authorize`) is required — distinguished from a merely-misconfigured
 * client id/secret (401) because the fix is different.
 */
async function mapTokenEndpointError(response: Response): Promise<DriveProviderError> {
  let errorCode: string | undefined;
  try {
    const body = (await response.json()) as TokenErrorResponseBody;
    errorCode = body.error;
  } catch {
    // A non-JSON error body is still handled below by status code alone.
  }

  if (errorCode === "invalid_grant") {
    return new DriveProviderError(
      "authorization_revoked_or_invalid",
      "Google rejected the stored refresh token as revoked, expired, or invalid — run `npm run google:authorize` again."
    );
  }
  if (response.status === 401) {
    return new DriveProviderError(
      "authorization_required",
      "Google rejected the configured OAuth client credentials."
    );
  }
  if (response.status === 429) {
    return new DriveProviderError("rate_limited", "Google's OAuth token endpoint rate-limited this request.");
  }
  if (response.status >= 500) {
    return new DriveProviderError(
      "transient_provider_failure",
      `Google's OAuth token endpoint returned a transient error (HTTP ${response.status}).`
    );
  }
  return new DriveProviderError(
    "unexpected_provider_failure",
    `Google's OAuth token endpoint returned HTTP ${response.status}.`
  );
}

/** Test-only — clears the in-memory access-token cache so each test starts from a known
 * state. Never called by production code. */
export function __resetAccessTokenCacheForTests(): void {
  cachedAccessToken = undefined;
}
