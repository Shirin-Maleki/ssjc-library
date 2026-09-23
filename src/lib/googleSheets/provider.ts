/**
 * The seam between application code and the Google Sheets API v4 (Phase 9) —
 * mirrors `src/lib/googleDrive/provider.ts`'s exact split (interface + error
 * type here, one concrete REST implementation in its own file, no `googleapis`
 * SDK — this codebase hand-rolls every Google REST integration behind a narrow
 * provider interface, and Sheets follows the same established convention
 * rather than introducing a new dependency for one integration).
 *
 * This provider exists to maintain ONE derived, reference-only spreadsheet
 * projection of canonical PostgreSQL data — never a second database, never a
 * write-back path from the Sheet into the app (`docs/DECISIONS.md`).
 */

export type SheetsErrorCategory =
  | "configuration_missing"
  | "authorization_required"
  | "authorization_revoked_or_invalid"
  | "permission_denied"
  | "not_found"
  | "rate_limited"
  | "transient_provider_failure"
  | "invalid_request"
  | "unexpected_provider_failure";

export class SheetsProviderError extends Error {
  constructor(readonly category: SheetsErrorCategory, message: string, readonly cause?: unknown) {
    super(message);
    this.name = "SheetsProviderError";
  }
}

export interface CreateSpreadsheetResult {
  spreadsheetId: string;
  sheetId: number;
  url: string;
}

export interface SpreadsheetMeta {
  spreadsheetId: string;
  title: string;
  sheetId: number;
  url: string;
}

/** A single Sheets API v4 `batchUpdate` request object — passed through
 * verbatim to the real REST call. Typed loosely (`Record<string, unknown>`)
 * rather than modeling the entire Sheets request-object union: this
 * provider's callers (`sync.ts`) construct a small, fixed, reviewed set of
 * these (frozen row, basic filter, column widths, hide one column, bold
 * header) — narrowly typing every possible Sheets request shape this
 * application will never send would be pure ceremony. */
export type SheetsBatchUpdateRequest = Record<string, unknown>;

export interface SheetsProvider {
  /** Creates a brand-new spreadsheet with one sheet/tab named `Catalog` and
   * returns its durable identity. Called ONLY when no existing, still-valid
   * spreadsheet id is on record (`sync.ts`'s find-or-create logic) — never
   * called speculatively "just in case." */
  createSpreadsheet(title: string): Promise<CreateSpreadsheetResult>;

  /** Fetches a spreadsheet's own metadata to confirm it still exists and is
   * reachable — `undefined` (never a thrown `not_found`) when Google reports
   * it gone/inaccessible, so the caller can decide to create a replacement
   * rather than crash. */
  getSpreadsheetMeta(spreadsheetId: string): Promise<SpreadsheetMeta | undefined>;

  /**
   * Overwrites `range` with `values` using the Sheets API's `USER_ENTERED`
   * input mode — the only mode that renders a real `IMAGE()` formula as an
   * actual image rather than inert literal text (Sheets' `RAW` mode would
   * defuse `rowBuilder.ts`'s intentional cover formula just as thoroughly as
   * it would defuse an accidental one, since it never interprets a leading
   * `=` at all). This is why formula-injection safety cannot come from the
   * input mode alone: `rowBuilder.ts`'s `buildCatalogRow()` is responsible
   * for prefixing every ordinary text cell with a leading `'` (Sheets' own
   * standard "force literal text" escape) BEFORE it ever reaches this
   * method — the one and only cell allowed to start with an unescaped `=` is
   * the cover cell, and only when `buildCoverCell()` itself produced it from
   * an already-validated, trusted-host HTTPS URL. This method itself sends
   * exactly what it's given; it performs no escaping of its own. */
  updateValues(spreadsheetId: string, range: string, values: (string | number)[][]): Promise<void>;

  /** Clears every cell in `range` without deleting the range/rows themselves
   * — used to wipe stale trailing rows from a shrinking catalog snapshot. */
  clearValues(spreadsheetId: string, range: string): Promise<void>;

  /** Applies a batch of formatting/structural requests (frozen row, basic
   * filter, column widths, hiding the trailing `book_id` column, bold header)
   * in one call — never one request per formatting concern. */
  batchUpdate(spreadsheetId: string, requests: SheetsBatchUpdateRequest[]): Promise<void>;
}
