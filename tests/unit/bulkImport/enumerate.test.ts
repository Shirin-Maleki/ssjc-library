import { describe, expect, it } from "vitest";
import { enumerateSourceImages, EnumerationLimitExceededError, MAX_ENUMERATED_FILES, type ListChildrenFn } from "@/lib/bulkImport/enumerate";
import type { DriveFileMetadata } from "@/lib/googleDrive/provider";

function file(overrides: Partial<DriveFileMetadata> & { id: string; name: string }): DriveFileMetadata {
  return {
    mimeType: "image/jpeg",
    size: 1000,
    createdTime: "2026-01-01T00:00:00.000Z",
    modifiedTime: "2026-01-01T00:00:00.000Z",
    parents: [],
    isFolder: false,
    trashed: false,
    capabilities: { canDownload: true, canAddChildren: false, canTrash: true },
    ...overrides,
  };
}

function folder(overrides: Partial<DriveFileMetadata> & { id: string; name: string }): DriveFileMetadata {
  return file({ ...overrides, mimeType: "application/vnd.google-apps.folder", isFolder: true, size: null });
}

/** Builds a fake `listChildren` over an in-memory folder tree keyed by folder
 * id — mirrors `rootContainment.test.ts`'s pure in-memory-graph testing
 * approach, no real Drive/network involved. */
function fakeListChildren(tree: Record<string, DriveFileMetadata[]>): ListChildrenFn {
  return async (folderId) => ({ files: tree[folderId] ?? [] });
}

describe("bulkImport/enumerate — enumerateSourceImages", () => {
  it("walks a multi-level real-shaped tree (root -> Corridor books -> photographer folders -> images)", async () => {
    const tree: Record<string, DriveFileMetadata[]> = {
      root: [folder({ id: "corridor", name: "Corridor books" })],
      corridor: [folder({ id: "shirin", name: "Shirin" }), folder({ id: "diamond", name: "Diamond" })],
      shirin: [file({ id: "f1", name: "IMG_1.JPG" }), file({ id: "f2", name: "IMG_2.JPG" })],
      diamond: [file({ id: "f3", name: "IMG_3.JPG" })],
    };
    const result = await enumerateSourceImages(fakeListChildren(tree), "root");
    expect(result.map((f) => f.fileId)).toEqual(["f3", "f1", "f2"]); // sorted by folderPath then name: Corridor books/Diamond < Corridor books/Shirin
    expect(result.find((f) => f.fileId === "f1")?.folderPath).toEqual(["Corridor books", "Shirin"]);
  });

  it("ignores non-image files and the Google Sheet itself, and skips trashed files", async () => {
    const tree: Record<string, DriveFileMetadata[]> = {
      root: [
        file({ id: "img", name: "cover.jpg", mimeType: "image/jpeg" }),
        file({ id: "sheet", name: "SSJC Library Catalog", mimeType: "application/vnd.google-apps.spreadsheet" }),
        file({ id: "doc", name: "notes.gdoc", mimeType: "application/vnd.google-apps.document" }),
        file({ id: "pdf", name: "scan.pdf", mimeType: "application/pdf" }),
        file({ id: "trashed", name: "old.jpg", mimeType: "image/jpeg", trashed: true }),
      ],
    };
    const result = await enumerateSourceImages(fakeListChildren(tree), "root");
    expect(result.map((f) => f.fileId)).toEqual(["img"]);
  });

  it("accepts every allowed source-cover image type (JPEG, PNG, WebP, HEIC, HEIF)", async () => {
    const tree: Record<string, DriveFileMetadata[]> = {
      root: [
        file({ id: "a", name: "a.jpg", mimeType: "image/jpeg" }),
        file({ id: "b", name: "b.png", mimeType: "image/png" }),
        file({ id: "c", name: "c.webp", mimeType: "image/webp" }),
        file({ id: "d", name: "d.heic", mimeType: "image/heic" }),
        file({ id: "e", name: "e.heif", mimeType: "image/heif" }),
      ],
    };
    const result = await enumerateSourceImages(fakeListChildren(tree), "root");
    expect(result.map((f) => f.fileId).sort()).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("paginates within a single folder using nextPageToken", async () => {
    let callCount = 0;
    const listChildren: ListChildrenFn = async (_folderId, options) => {
      callCount += 1;
      if (!options?.pageToken) return { files: [file({ id: "p1", name: "p1.jpg" })], nextPageToken: "page2" };
      return { files: [file({ id: "p2", name: "p2.jpg" })] };
    };
    const result = await enumerateSourceImages(listChildren, "root");
    expect(callCount).toBe(2);
    expect(result.map((f) => f.fileId).sort()).toEqual(["p1", "p2"]);
  });

  it("produces deterministic, stable ordering across repeated calls against an unchanged tree", async () => {
    const tree: Record<string, DriveFileMetadata[]> = {
      root: [file({ id: "z", name: "z.jpg" }), file({ id: "a", name: "a.jpg" }), file({ id: "m", name: "m.jpg" })],
    };
    const first = await enumerateSourceImages(fakeListChildren(tree), "root");
    const second = await enumerateSourceImages(fakeListChildren(tree), "root");
    expect(first.map((f) => f.fileId)).toEqual(second.map((f) => f.fileId));
    expect(first.map((f) => f.fileId)).toEqual(["a", "m", "z"]);
  });

  it("never escapes the configured root — only reachable descendants are ever enumerated", async () => {
    const tree: Record<string, DriveFileMetadata[]> = {
      root: [file({ id: "in-root", name: "in.jpg" })],
      "sibling-not-linked-from-root": [file({ id: "outside", name: "outside.jpg" })],
    };
    const result = await enumerateSourceImages(fakeListChildren(tree), "root");
    expect(result.map((f) => f.fileId)).toEqual(["in-root"]);
  });

  it("throws EnumerationLimitExceededError rather than silently truncating a pathologically large tree", async () => {
    const manyFiles = Array.from({ length: MAX_ENUMERATED_FILES + 1 }, (_, i) => file({ id: `f${i}`, name: `f${i}.jpg` }));
    const tree: Record<string, DriveFileMetadata[]> = { root: manyFiles };
    await expect(enumerateSourceImages(fakeListChildren(tree), "root")).rejects.toThrow(EnumerationLimitExceededError);
  });
});
