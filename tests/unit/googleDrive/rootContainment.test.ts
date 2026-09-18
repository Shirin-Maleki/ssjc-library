import { describe, expect, it } from "vitest";
import { isWithinRoot, MAX_ANCESTRY_DEPTH, type GetParentsFn } from "@/lib/googleDrive/rootContainment";

const ROOT = "root-folder";

/** Builds a `GetParentsFn` from a plain parent-id map — `undefined` for a given id means
 * "inaccessible/not found," matching the real provider's contract. */
function graphOf(edges: Record<string, string[] | undefined>): GetParentsFn {
  return async (id: string) => edges[id] ?? null;
}

describe("googleDrive/rootContainment", () => {
  it("the root itself is always contained", async () => {
    const getParents = graphOf({});
    expect(await isWithinRoot(ROOT, ROOT, getParents)).toBe(true);
  });

  it("a direct child of the root is contained", async () => {
    const getParents = graphOf({ child: [ROOT] });
    expect(await isWithinRoot("child", ROOT, getParents)).toBe(true);
  });

  it("a nested descendant several levels deep is contained", async () => {
    const getParents = graphOf({
      grandchild: ["child"],
      child: ["intermediate"],
      intermediate: [ROOT],
    });
    expect(await isWithinRoot("grandchild", ROOT, getParents)).toBe(true);
  });

  it("a file outside the root entirely is denied", async () => {
    const getParents = graphOf({
      "unrelated-file": ["unrelated-folder"],
      "unrelated-folder": [], // reaches nothing, never the configured root
    });
    expect(await isWithinRoot("unrelated-file", ROOT, getParents)).toBe(false);
  });

  it("an inaccessible parent denies containment safely, without throwing", async () => {
    const getParents = graphOf({ orphan: undefined });
    await expect(isWithinRoot("orphan", ROOT, getParents)).resolves.toBe(false);
  });

  it("a cycle in the ancestry graph does not loop forever and correctly denies containment", async () => {
    const getParents = graphOf({
      a: ["b"],
      b: ["a"], // cycle back to a, never reaches ROOT
    });
    const result = await isWithinRoot("a", ROOT, getParents, 10);
    expect(result).toBe(false);
  });

  it("a self-referencing cycle that DOES eventually reach the root is still contained", async () => {
    const getParents = graphOf({
      a: ["b", "c"],
      b: ["a"], // cycle
      c: [ROOT], // but this branch reaches the root
    });
    expect(await isWithinRoot("a", ROOT, getParents)).toBe(true);
  });

  it("respects a bounded maximum ancestry depth — a chain longer than maxDepth is denied", async () => {
    // Build a chain of 25 levels, deeper than MAX_ANCESTRY_DEPTH (20), with the root only
    // reachable at the very top.
    const edges: Record<string, string[] | undefined> = {};
    const depth = MAX_ANCESTRY_DEPTH + 5;
    for (let i = 0; i < depth; i++) {
      edges[`level-${i}`] = [i === depth - 1 ? ROOT : `level-${i + 1}`];
    }
    const getParents = graphOf(edges);
    expect(await isWithinRoot("level-0", ROOT, getParents)).toBe(false);
  });

  it("a chain within the bounded depth still succeeds", async () => {
    const edges: Record<string, string[] | undefined> = {};
    const depth = MAX_ANCESTRY_DEPTH - 2;
    for (let i = 0; i < depth; i++) {
      edges[`level-${i}`] = [i === depth - 1 ? ROOT : `level-${i + 1}`];
    }
    const getParents = graphOf(edges);
    expect(await isWithinRoot("level-0", ROOT, getParents)).toBe(true);
  });

  it("multiple parents: contained if ANY parent path reaches the root", async () => {
    const getParents = graphOf({
      multi: ["deadend", ROOT],
      deadend: [],
    });
    expect(await isWithinRoot("multi", ROOT, getParents)).toBe(true);
  });
});
