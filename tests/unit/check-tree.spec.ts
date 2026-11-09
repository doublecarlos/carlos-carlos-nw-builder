// Tests for lib/check-tree.ts: which builds a folder's checkbox stands for, and how it reads.
// The copy-to-builds dialog ticks a folder's whole subtree, so a folder must own builds in its
// subfolders but not a sibling listed after them.
import { describe, expect, it } from "vitest";
import {
  checkState,
  headingMembers,
  setTicked,
} from "../../src/lib/check-tree";
import { treeRows, type TreeStep } from "../../src/lib/tree-rows";

const step = (key: string): TreeStep => ({ key, label: key });
const outer = step("outer");
const inner = step("inner");

/** Each heading's label with the item names under it. */
function membersOf(items: { name: string; path?: TreeStep[] }[]) {
  const rows = treeRows(items, (item) => item.path);
  const members = headingMembers(rows, (item) => item.name);
  return Object.fromEntries(
    [...members].map(([index, ids]) => {
      const row = rows[index];
      return [row.kind === "heading" ? row.step.label : "", ids];
    }),
  );
}

describe("headingMembers", () => {
  it("gives a folder the builds of its subfolders, and stops at its own level", () => {
    expect(
      membersOf([
        { name: "a", path: [outer] },
        { name: "b", path: [outer, inner] },
        { name: "c", path: [outer] },
        { name: "top" },
      ]),
    ).toEqual({ outer: ["a", "b", "c"], inner: ["b"] });
  });
});

describe("checkState", () => {
  it("reads all, none and some as on, off and mixed", () => {
    expect(checkState(["a", "b"], new Set(["a", "b"]))).toBe("on");
    expect(checkState(["a", "b"], new Set())).toBe("off");
    expect(checkState(["a", "b"], new Set(["b", "x"]))).toBe("mixed");
  });

  // A folder emptied by the filter must not read as ticked.
  it("reads an empty group as off", () => {
    expect(checkState([], new Set(["a"]))).toBe("off");
  });
});

describe("setTicked", () => {
  it("ticks or unticks only the given ids", () => {
    const before = new Set(["a", "x"]);
    expect([...setTicked(before, ["a", "b"], true)].sort()).toEqual([
      "a",
      "b",
      "x",
    ]);
    expect([...setTicked(before, ["a", "b"], false)]).toEqual(["x"]);
    expect([...before]).toEqual(["a", "x"]);
  });
});
