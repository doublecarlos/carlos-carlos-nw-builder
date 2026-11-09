// Tests for lib/folder-tree.ts: the repair every folder tree read from outside goes through,
// so the stores can trust one home per id, no cycles and a bounded depth.
import { describe, expect, it } from "vitest";
import {
  MAX_FOLDER_DEPTH,
  readFolder,
  repairFolderTree,
} from "../../src/lib/folder-tree";
import type { BuildFolder } from "../../src/types";

const folder = (id: string, items: string[]): BuildFolder => ({
  id,
  name: id,
  collapsed: false,
  items,
});

/** Each folder's depth, walking down from the top-level order. */
function depths(tree: ReturnType<typeof repairFolderTree>) {
  const byId = new Map(tree.folders.map((f) => [f.id, f]));
  const out = new Map<string, number>();
  const walk = (ids: string[], depth: number) => {
    for (const id of ids) {
      const f = byId.get(id);
      if (!f) continue;
      out.set(id, depth);
      walk(f.items, depth + 1);
    }
  };
  walk(tree.buildOrder, 1);
  return out;
}

describe("readFolder", () => {
  // Data written before nesting existed names a folder's contents `builds`.
  it("reads a one-level folder's `builds` as its items", () => {
    const read = readFolder(
      { id: "f_1", name: "Alts", collapsed: true, builds: ["b_1"] },
      () => "fresh",
    );
    expect(read?.items).toEqual(["b_1"]);
  });
});

describe("repairFolderTree", () => {
  it("keeps a valid nested tree as it is", () => {
    const tree = repairFolderTree(
      [folder("f_a", ["b_1", "f_b"]), folder("f_b", ["b_2"])],
      ["f_a", "b_3"],
      new Set(["b_1", "b_2", "b_3"]),
    );
    expect(tree.buildOrder).toEqual(["f_a", "b_3"]);
    expect(tree.folders.map((f) => f.items)).toEqual([["b_1", "f_b"], ["b_2"]]);
  });

  it("cuts a cycle, leaving every folder reachable exactly once", () => {
    const tree = repairFolderTree(
      [folder("f_a", ["f_b"]), folder("f_b", ["f_a"])],
      [],
      new Set(),
    );
    expect([...depths(tree).keys()].sort()).toEqual(["f_a", "f_b"]);
    const listed = [
      ...tree.buildOrder,
      ...tree.folders.flatMap((f) => f.items),
    ];
    expect(listed.sort()).toEqual(["f_a", "f_b"]);
  });

  it("drops a folder listing itself", () => {
    const tree = repairFolderTree([folder("f_a", ["f_a"])], [], new Set());
    expect(tree.folders[0].items).toEqual([]);
    expect(tree.buildOrder).toEqual(["f_a"]);
  });

  it("lifts whatever sits past the depth limit, so no folder is deeper", () => {
    const ids = Array.from(
      { length: MAX_FOLDER_DEPTH + 2 },
      (_, i) => `f_${i}`,
    );
    const tree = repairFolderTree(
      ids.map((id, i) => folder(id, ids[i + 1] ? [ids[i + 1]] : [])),
      [ids[0]],
      new Set(),
    );
    const found = depths(tree);
    expect(found.size).toBe(ids.length);
    expect(Math.max(...found.values())).toBe(MAX_FOLDER_DEPTH);
  });
});
