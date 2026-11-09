// Tests for lib/tree-rows.ts: how a flat, tree-ordered list becomes headings and indented
// items, the shape every build list outside the sidebar draws.
import { describe, expect, it } from "vitest";
import { treeRows, type TreeStep } from "../../src/lib/tree-rows";

const step = (key: string): TreeStep => ({ key, label: key.toUpperCase() });
const outer = step("a");
const inner = step("b");

/** Rows spelled as "#LABEL@depth" for a heading and "name@depth" for an item. */
function spell(items: { name: string; path?: TreeStep[] }[]) {
  return treeRows(items, (item) => item.path).map((row) =>
    row.kind === "heading"
      ? `#${row.step.label}@${row.depth}`
      : `${row.item.name}@${row.depth}`,
  );
}

describe("treeRows", () => {
  // A folder holding only a subfolder still gets its own heading, so the shape is kept.
  it("heads every level a path enters, not just the deepest", () => {
    expect(spell([{ name: "x", path: [outer, inner] }])).toEqual([
      "#A@0",
      "#B@1",
      "x@2",
    ]);
  });

  it("returns to a parent's level after a subfolder without repeating its heading", () => {
    expect(
      spell([
        { name: "x", path: [outer] },
        { name: "y", path: [outer, inner] },
        { name: "z", path: [outer] },
        { name: "top" },
      ]),
    ).toEqual(["#A@0", "x@1", "#B@1", "y@2", "z@1", "top@0"]);
  });

  // Folder names are not unique, so headings are told apart by key, not label.
  it("heads two same-named folders separately", () => {
    const twin = { key: "a2", label: "A" };
    expect(
      spell([
        { name: "x", path: [outer] },
        { name: "y", path: [twin] },
      ]),
    ).toEqual(["#A@0", "x@1", "#A@0", "y@1"]);
  });
});
