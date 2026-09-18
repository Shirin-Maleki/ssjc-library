/**
 * The Drive root-boundary security check (Phase 6, §14 of the phase brief). A raw
 * accessible Drive ID must never become usable merely because the authorized OAuth
 * account can reach it — every operation must prove the target is the configured root
 * folder itself, or a descendant of it, by walking real parent ancestry.
 *
 * The traversal algorithm is factored out as a pure function taking a `getParents`
 * callback, independent of the real Drive REST calls (`googleDriveProvider.ts` supplies
 * the real implementation) — this is what makes cycle/depth/inaccessible-parent behavior
 * directly, deterministically unit-testable with an in-memory fake graph
 * (`tests/unit/googleDrive/rootContainment.test.ts`), not something only provable against
 * a live Drive account.
 */

/** A hard ceiling on ancestry-walk depth — protects against a pathological (or malicious)
 * deeply-nested folder structure, or a `getParents` implementation bug, from ever looping
 * unboundedly. 20 comfortably exceeds any real folder nesting this application creates or
 * expects to encounter under the configured root. */
export const MAX_ANCESTRY_DEPTH = 20;

/**
 * Returns this file/folder's immediate parent IDs, or `null` when the ID doesn't exist or
 * the authorized account can't inspect it (a dead end for containment purposes — not
 * automatically "outside the root," just "this branch of the walk can't be verified,"
 * which `isWithinRoot` below treats as non-containment for that branch).
 */
export type GetParentsFn = (fileId: string) => Promise<string[] | null>;

/**
 * Walks `candidateId`'s real parent ancestry breadth-first looking for `rootFolderId`.
 * The root itself is always contained (`candidateId === rootFolderId`). Guards against
 * cycles (a `visited` set — Drive's UI prevents folder cycles, but this must not trust
 * that) and bounds the walk to `maxDepth` levels. An inaccessible parent silently ends
 * that branch rather than throwing — a caller with no real path to the root through
 * reachable ancestry is correctly denied, not crashed.
 */
export async function isWithinRoot(
  candidateId: string,
  rootFolderId: string,
  getParents: GetParentsFn,
  maxDepth: number = MAX_ANCESTRY_DEPTH
): Promise<boolean> {
  if (candidateId === rootFolderId) return true;

  const visited = new Set<string>([candidateId]);
  let frontier = [candidateId];

  for (let depth = 0; depth < maxDepth; depth++) {
    const nextFrontier: string[] = [];
    for (const id of frontier) {
      const parents = await getParents(id);
      if (!parents) continue;
      for (const parentId of parents) {
        if (parentId === rootFolderId) return true;
        if (visited.has(parentId)) continue;
        visited.add(parentId);
        nextFrontier.push(parentId);
      }
    }
    if (nextFrontier.length === 0) return false;
    frontier = nextFrontier;
  }
  return false;
}
