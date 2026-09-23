import { isAllowedSourceCoverMimeType } from "@/lib/googleDrive/validation";
import type { DriveListResult } from "@/lib/googleDrive/provider";

/**
 * Bounded, deterministic enumeration of supported image files under the bulk
 * importer's configured source root (§23/§45 of the phase brief) — the real
 * collection is organized `<configured root>` → `Corridor books` → three
 * photographer subfolders → image files, discovered by direct inspection against
 * the live Drive account rather than assumed. `Phase 6`'s `listChildren()` is
 * single-level only (no recursive-walk helper exists there), so this is the one
 * new, explicit, constrained recursion Phase 9 needs on top of it.
 *
 * Takes `listChildren` as an injected dependency (never a concrete provider
 * class) — the exact same seam `rootContainment.ts`'s `GetParentsFn` and
 * `smokeOrchestration.ts`'s dependency-injected `CoverStorageProvider` already
 * establish, so the walk's ordering/bounding/filtering logic is directly
 * unit-testable against an in-memory fake folder tree, with no real Drive
 * account or network call.
 */

export type ListChildrenFn = (folderId: string, options?: { pageSize?: number; pageToken?: string }) => Promise<DriveListResult>;

/** Comfortably deeper than the real collection's actual 3-level nesting
 * (root → Corridor books → photographer folder → file), while still refusing to
 * walk an unbounded/pathological folder structure — mirrors
 * `rootContainment.ts`'s `MAX_ANCESTRY_DEPTH` reasoning at a smaller number
 * appropriate to a folder WALK rather than a parent-ancestry check. */
export const MAX_ENUMERATION_DEPTH = 8;

/** A hard ceiling distinct from the real ~1,500-image collection size — refuses
 * to silently keep enumerating forever against a folder structure far larger
 * than this project's real collection could ever be, surfacing a clear error
 * instead of a silent partial/truncated result an operator could mistake for
 * "that's everything." */
export const MAX_ENUMERATED_FILES = 5000;

export class EnumerationLimitExceededError extends Error {
  constructor(limit: number) {
    super(`Enumeration found more than ${limit} supported image files under the configured source root — refusing to continue rather than silently truncating. If the real collection has genuinely grown this large, raise MAX_ENUMERATED_FILES deliberately.`);
    this.name = "EnumerationLimitExceededError";
  }
}

export interface EnumeratedSourceFile {
  fileId: string;
  name: string;
  mimeType: string;
  size: number | null;
  modifiedTime: string;
  /** Folder name breadcrumb from the configured source root (exclusive of the
   * root itself) down to this file's immediate parent — e.g. `["Corridor
   * books", "Shirin"]`. Never a filesystem path; purely for deterministic
   * ordering and human-readable observability (CLI output, job config JSON). */
  folderPath: string[];
}

interface WalkFrontierEntry {
  folderId: string;
  folderPath: string[];
  depth: number;
}

/**
 * Walks every folder under (and including) `rootFolderId`, up to
 * `MAX_ENUMERATION_DEPTH` levels deep, collecting every child whose `mimeType`
 * is an allowed source-cover image type (`googleDrive/validation.ts`'s existing
 * allowlist — the same one Phase 6 already uses to decide what Drive will store
 * as a source cover at all, never a second parallel format list). Ignores every
 * other file type outright (Google Docs/Sheets, PDFs, etc.) — this never
 * mistakes the Google Sheet Phase 9 itself creates for a source photograph,
 * since a spreadsheet's MIME type is never in that allowlist.
 *
 * Deterministic output order: breadth-first by folder, and within each folder's
 * page results, in the order Drive returned them — then the whole result is
 * finally sorted by `(folderPath.join("/"), name)` so two enumeration runs
 * against an unchanged Drive tree always produce the identical file order (job
 * creation numbers items by this order, so this determinism is what makes a job
 * reproducible).
 */
export async function enumerateSourceImages(listChildren: ListChildrenFn, rootFolderId: string): Promise<EnumeratedSourceFile[]> {
  const results: EnumeratedSourceFile[] = [];
  let frontier: WalkFrontierEntry[] = [{ folderId: rootFolderId, folderPath: [], depth: 0 }];

  while (frontier.length > 0) {
    const next: WalkFrontierEntry[] = [];

    for (const entry of frontier) {
      let pageToken: string | undefined;
      do {
        const page = await listChildren(entry.folderId, { pageSize: 200, pageToken });
        for (const file of page.files) {
          if (file.trashed) continue;
          if (file.isFolder) {
            if (entry.depth < MAX_ENUMERATION_DEPTH) {
              next.push({ folderId: file.id, folderPath: [...entry.folderPath, file.name], depth: entry.depth + 1 });
            }
            continue;
          }
          if (!isAllowedSourceCoverMimeType(file.mimeType)) continue;

          if (results.length >= MAX_ENUMERATED_FILES) throw new EnumerationLimitExceededError(MAX_ENUMERATED_FILES);
          results.push({
            fileId: file.id,
            name: file.name,
            mimeType: file.mimeType,
            size: file.size,
            modifiedTime: file.modifiedTime,
            folderPath: entry.folderPath,
          });
        }
        pageToken = page.nextPageToken;
      } while (pageToken);
    }

    frontier = next;
  }

  return results.sort((a, b) => {
    const pathA = a.folderPath.join("/");
    const pathB = b.folderPath.join("/");
    if (pathA !== pathB) return pathA < pathB ? -1 : 1;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });
}
