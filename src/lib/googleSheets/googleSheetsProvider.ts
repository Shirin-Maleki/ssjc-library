import { getAccessToken } from "@/lib/googleDrive/oauthClient";
import { fetchWithRetry } from "@/lib/googleDrive/retry";
import {
  SheetsProviderError,
  type CreateSpreadsheetResult,
  type SheetsBatchUpdateRequest,
  type SheetsProvider,
  type SpreadsheetMeta,
} from "./provider";

/**
 * The concrete Google Sheets API v4 implementation (Phase 9) — hand-rolled
 * `fetch` calls behind the narrow `SheetsProvider` interface, exactly
 * mirroring `googleDriveProvider.ts`'s own shape (no `googleapis` SDK
 * dependency; `getAccessToken()`/`fetchWithRetry()` are the SAME two Phase 6
 * building blocks Drive already uses, imported directly rather than
 * duplicated — Sheets and Drive share one OAuth credential and one retry
 * policy, so there is nothing to reimplement here).
 *
 * Authorization note (`docs/GOOGLE_SETUP.md`): this project's existing OAuth
 * client was authorized with `drive.readonly` + `drive.file` scopes only — no
 * `spreadsheets` scope was ever requested. Google's own Sheets API v4
 * reference lists `drive.file` as a valid, sufficient scope for the Sheets
 * API, specifically for spreadsheets this application itself creates (which
 * is the only kind this provider ever touches) — real validation
 * (`docs/GOOGLE_INTEGRATION.md`) confirms this works end to end against the
 * live account without any new consent step.
 */

const SHEETS_API_BASE = "https://sheets.googleapis.com/v4/spreadsheets";
const CATALOG_TAB_TITLE = "Catalog";

interface RawSheetProperties {
  sheetId: number;
  title: string;
}

interface RawSpreadsheetResource {
  spreadsheetId: string;
  spreadsheetUrl?: string;
  properties?: { title: string };
  sheets?: { properties: RawSheetProperties }[];
}

export class GoogleSheetsApiProvider implements SheetsProvider {
  private async authorizedFetch(url: string, init: RequestInit = {}): Promise<Response> {
    const accessToken = await getAccessToken();
    return fetchWithRetry(url, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    });
  }

  async createSpreadsheet(title: string): Promise<CreateSpreadsheetResult> {
    const response = await this.authorizedFetch(SHEETS_API_BASE, {
      method: "POST",
      body: JSON.stringify({
        properties: { title },
        sheets: [{ properties: { title: CATALOG_TAB_TITLE, gridProperties: { frozenRowCount: 1 } } }],
      }),
    });
    if (!response.ok) throw await mapSheetsHttpError(response, "createSpreadsheet");
    const raw = (await response.json()) as RawSpreadsheetResource;
    const sheetId = raw.sheets?.[0]?.properties.sheetId;
    if (sheetId == null) {
      throw new SheetsProviderError("unexpected_provider_failure", "Google did not return a sheet id for the newly created spreadsheet.");
    }
    return { spreadsheetId: raw.spreadsheetId, sheetId, url: raw.spreadsheetUrl ?? `https://docs.google.com/spreadsheets/d/${raw.spreadsheetId}` };
  }

  async getSpreadsheetMeta(spreadsheetId: string): Promise<SpreadsheetMeta | undefined> {
    const url = `${SHEETS_API_BASE}/${encodeURIComponent(spreadsheetId)}?fields=${encodeURIComponent("spreadsheetId,spreadsheetUrl,properties.title,sheets.properties")}`;
    const response = await this.authorizedFetch(url);
    if (response.status === 404) return undefined;
    if (!response.ok) throw await mapSheetsHttpError(response, "getSpreadsheetMeta");
    const raw = (await response.json()) as RawSpreadsheetResource;
    const catalogSheet = raw.sheets?.find((s) => s.properties.title === CATALOG_TAB_TITLE) ?? raw.sheets?.[0];
    if (!catalogSheet) return undefined;
    return {
      spreadsheetId: raw.spreadsheetId,
      title: raw.properties?.title ?? "",
      sheetId: catalogSheet.properties.sheetId,
      url: raw.spreadsheetUrl ?? `https://docs.google.com/spreadsheets/d/${raw.spreadsheetId}`,
    };
  }

  async updateValues(spreadsheetId: string, range: string, values: (string | number)[][]): Promise<void> {
    const url = `${SHEETS_API_BASE}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`;
    const response = await this.authorizedFetch(url, { method: "PUT", body: JSON.stringify({ range, majorDimension: "ROWS", values }) });
    if (!response.ok) throw await mapSheetsHttpError(response, "updateValues");
  }

  async clearValues(spreadsheetId: string, range: string): Promise<void> {
    const url = `${SHEETS_API_BASE}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}:clear`;
    const response = await this.authorizedFetch(url, { method: "POST", body: JSON.stringify({}) });
    if (!response.ok) throw await mapSheetsHttpError(response, "clearValues");
  }

  async batchUpdate(spreadsheetId: string, requests: SheetsBatchUpdateRequest[]): Promise<void> {
    const url = `${SHEETS_API_BASE}/${encodeURIComponent(spreadsheetId)}:batchUpdate`;
    const response = await this.authorizedFetch(url, { method: "POST", body: JSON.stringify({ requests }) });
    if (!response.ok) throw await mapSheetsHttpError(response, "batchUpdate");
  }
}

async function mapSheetsHttpError(response: Response, context: string): Promise<SheetsProviderError> {
  switch (response.status) {
    case 401:
      return new SheetsProviderError("authorization_required", `Google rejected the request as unauthorized (${context}).`);
    case 403:
      return new SheetsProviderError("permission_denied", `The authorized account lacks permission for this operation (${context}).`);
    case 404:
      return new SheetsProviderError("not_found", `Google reported the requested spreadsheet does not exist (${context}).`);
    case 429:
      return new SheetsProviderError("rate_limited", `Google rate-limited this request (${context}).`);
    case 400:
      return new SheetsProviderError("invalid_request", `Google rejected this request as malformed (${context}).`);
    case 500:
    case 502:
    case 503:
    case 504:
      return new SheetsProviderError("transient_provider_failure", `Google's Sheets API returned a transient error (HTTP ${response.status}, ${context}).`);
    default:
      return new SheetsProviderError("unexpected_provider_failure", `Google's Sheets API returned HTTP ${response.status} (${context}).`);
  }
}
