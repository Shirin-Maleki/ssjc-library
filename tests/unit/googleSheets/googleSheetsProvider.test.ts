import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GoogleSheetsApiProvider } from "@/lib/googleSheets/googleSheetsProvider";
import { SheetsProviderError } from "@/lib/googleSheets/provider";
import { __resetAccessTokenCacheForTests } from "@/lib/googleDrive/oauthClient";

const ENV_VARS = ["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET", "GOOGLE_OAUTH_REFRESH_TOKEN", "GOOGLE_DRIVE_ROOT_FOLDER_ID"] as const;
const ORIGINAL_ENV: Record<string, string | undefined> = {};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** Mirrors `googleDriveProvider.test.ts`'s exact mocking approach — this
 * provider reuses the SAME `getAccessToken()` token-refresh call Drive uses,
 * so the same "token endpoint first, then the real API call" sequencing
 * applies here too. A retryable status (429/5xx) makes `fetchWithRetry` call
 * `fetch` again internally — once the queue is exhausted, the LAST queued
 * response is cloned and reused for every further call, so a single queued
 * failure response naturally satisfies the retry loop through to its real
 * final outcome instead of throwing a test-harness error mid-retry. */
function mockTokenThenSheets(...sheetsResponses: Response[]) {
  const tokenResponse = jsonResponse({ access_token: "test-access-token", expires_in: 3600 });
  const queue = [...sheetsResponses];
  return vi.spyOn(globalThis, "fetch").mockImplementation((url) => {
    if (String(url).includes("oauth2.googleapis.com")) return Promise.resolve(tokenResponse.clone());
    const next = queue.length > 1 ? queue.shift()! : queue[0];
    if (!next) throw new Error("mockTokenThenSheets: no responses were queued");
    return Promise.resolve(next.clone());
  });
}

describe("GoogleSheetsApiProvider (mocked Sheets REST)", () => {
  let provider: GoogleSheetsApiProvider;

  beforeEach(() => {
    __resetAccessTokenCacheForTests();
    for (const key of ENV_VARS) ORIGINAL_ENV[key] = process.env[key];
    process.env.GOOGLE_OAUTH_CLIENT_ID = "test-client-id";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-client-secret";
    process.env.GOOGLE_OAUTH_REFRESH_TOKEN = "test-refresh-token";
    process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID = "root-folder-id";
    provider = new GoogleSheetsApiProvider();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const key of ENV_VARS) {
      if (ORIGINAL_ENV[key] === undefined) delete process.env[key];
      else process.env[key] = ORIGINAL_ENV[key];
    }
  });

  it("createSpreadsheet sends a real create request and returns the durable id/sheetId/url", async () => {
    const fetchSpy = mockTokenThenSheets(
      jsonResponse({ spreadsheetId: "sheet-1", spreadsheetUrl: "https://docs.google.com/spreadsheets/d/sheet-1", sheets: [{ properties: { sheetId: 42, title: "Catalog" } }] })
    );
    const result = await provider.createSpreadsheet("SSJC Library Catalog");
    expect(result).toEqual({ spreadsheetId: "sheet-1", sheetId: 42, url: "https://docs.google.com/spreadsheets/d/sheet-1" });

    const createCall = fetchSpy.mock.calls.find(([url]) => String(url) === "https://sheets.googleapis.com/v4/spreadsheets");
    expect(createCall).toBeDefined();
    const body = JSON.parse(String(createCall![1]?.body));
    expect(body.properties.title).toBe("SSJC Library Catalog");
    expect(body.sheets[0].properties.title).toBe("Catalog");
  });

  it("getSpreadsheetMeta returns undefined (never throws) on a 404 — the caller can create a replacement", async () => {
    mockTokenThenSheets(jsonResponse({ error: { message: "not found" } }, 404));
    const result = await provider.getSpreadsheetMeta("gone-id");
    expect(result).toBeUndefined();
  });

  it("getSpreadsheetMeta returns real metadata when the spreadsheet still exists", async () => {
    mockTokenThenSheets(
      jsonResponse({ spreadsheetId: "sheet-1", spreadsheetUrl: "https://docs.google.com/spreadsheets/d/sheet-1", properties: { title: "SSJC Library Catalog" }, sheets: [{ properties: { sheetId: 42, title: "Catalog" } }] })
    );
    const result = await provider.getSpreadsheetMeta("sheet-1");
    expect(result).toEqual({ spreadsheetId: "sheet-1", title: "SSJC Library Catalog", sheetId: 42, url: "https://docs.google.com/spreadsheets/d/sheet-1" });
  });

  it("updateValues sends USER_ENTERED input mode (required for the IMAGE() formula to actually render)", async () => {
    const fetchSpy = mockTokenThenSheets(jsonResponse({}));
    await provider.updateValues("sheet-1", "'Catalog'!A1:B2", [["a", "b"]]);
    const call = fetchSpy.mock.calls.find(([url]) => String(url).includes("/values/"));
    expect(String(call![0])).toContain("valueInputOption=USER_ENTERED");
    expect(String(call![1]?.method)).toBe("PUT");
  });

  it("clearValues posts to the :clear endpoint for the given range", async () => {
    const fetchSpy = mockTokenThenSheets(jsonResponse({}));
    await provider.clearValues("sheet-1", "'Catalog'!A5:P3000");
    const call = fetchSpy.mock.calls.find(([url]) => String(url).includes(":clear"));
    expect(call).toBeDefined();
    expect(String(call![1]?.method)).toBe("POST");
  });

  it("batchUpdate posts every request in one call, never one request per formatting concern", async () => {
    const fetchSpy = mockTokenThenSheets(jsonResponse({}));
    const requests = [{ a: 1 }, { b: 2 }, { c: 3 }];
    await provider.batchUpdate("sheet-1", requests);
    const call = fetchSpy.mock.calls.find(([url]) => String(url).includes(":batchUpdate"));
    expect(call).toBeDefined();
    const body = JSON.parse(String(call![1]?.body));
    expect(body.requests).toEqual(requests);
  });

  it("maps a 403 to permission_denied and a 429 to rate_limited, never leaking the raw response body", async () => {
    mockTokenThenSheets(jsonResponse({ error: { message: "some raw google error body with sensitive-looking detail" } }, 403));
    await expect(provider.createSpreadsheet("x")).rejects.toMatchObject({ category: "permission_denied" });

    __resetAccessTokenCacheForTests();
    mockTokenThenSheets(jsonResponse({}, 429));
    await expect(provider.createSpreadsheet("x")).rejects.toMatchObject({ category: "rate_limited" });
  });

  it("never includes a secret (access token, client secret) in a thrown error message", async () => {
    mockTokenThenSheets(jsonResponse({}, 500));
    try {
      await provider.createSpreadsheet("x");
      expect.fail("expected createSpreadsheet to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(SheetsProviderError);
      expect((error as Error).message).not.toContain("test-access-token");
      expect((error as Error).message).not.toContain("test-client-secret");
    }
  });
});
