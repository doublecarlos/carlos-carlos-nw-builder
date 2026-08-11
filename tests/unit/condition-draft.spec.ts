// whenRowsComplete: the guard the bonus editors use to hold off auto-saving while a
// condition tree is half-drawn. `leafToSpec`/`rowsToWhen` drop leaves with no value and
// empty group branches on serialization, so an incomplete tree would come back smaller
// than what the user drew -- the round-trip would wipe the row from the form.
import { describe, it, expect } from "vitest";
import {
  whenRowsComplete,
  newLeafRow,
  newGroupRow,
  whenToRows,
  rowsToWhen,
  getConditionAt,
  removeConditionAt,
  insertConditionAt,
  removeBranchAt,
  insertBranchAt,
  isDescendantPath,
  adjustPathAfterRemoval,
  type ConditionRow,
} from "../../src/engine/condition-draft";

const leaf = (type: string, value: string) => {
  const row = newLeafRow(type);
  row.value = value;
  return row;
};

describe("condition-draft whenRowsComplete", () => {
  it("an empty list is complete (no condition means always active)", () => {
    expect(whenRowsComplete([])).toBe(true);
    expect(whenRowsComplete(undefined)).toBe(true);
  });

  it("a leaf with a value is complete", () => {
    expect(whenRowsComplete([leaf("toggle", "Party")])).toBe(true);
  });

  it("a fresh leaf with no value is incomplete", () => {
    expect(whenRowsComplete([newLeafRow("toggle")])).toBe(false);
    expect(whenRowsComplete([newLeafRow("class")])).toBe(false);
  });

  it("a duration leaf with neither bound set is incomplete", () => {
    expect(whenRowsComplete([newLeafRow("duration")])).toBe(false);
    const row = newLeafRow("duration");
    row.atLeast = 10;
    expect(whenRowsComplete([row])).toBe(true);
  });

  it("a param leaf without a key is incomplete", () => {
    expect(whenRowsComplete([newLeafRow("param")])).toBe(false);
    const row = newLeafRow("param");
    row.key = "bolster";
    row.atLeast = 0.5;
    expect(whenRowsComplete([row])).toBe(true);
  });

  it("an all/any group with only empty branches is incomplete", () => {
    expect(whenRowsComplete([newGroupRow("all")])).toBe(false);
    expect(whenRowsComplete([newGroupRow("any")])).toBe(false);
  });

  it("a not group with its empty placeholder branch is incomplete", () => {
    expect(whenRowsComplete([newGroupRow("not")])).toBe(false);
  });

  it("a group is complete only once every branch carries a complete leaf", () => {
    const group = newGroupRow("all");
    group.branches = [[leaf("toggle", "Party")], []];
    expect(whenRowsComplete([group])).toBe(false);
    group.branches = [[leaf("toggle", "Party")], [leaf("toggle", "Raid")]];
    expect(whenRowsComplete([group])).toBe(true);
  });

  it("an incomplete leaf nested deep still fails the check", () => {
    const outer = newGroupRow("all");
    const inner = newGroupRow("any");
    const complete = leaf("class", "Cleric");
    inner.branches = [[complete], [newLeafRow("toggle")]];
    outer.branches = [[inner]];
    expect(whenRowsComplete([outer])).toBe(false);

    inner.branches = [[complete]];
    expect(whenRowsComplete([outer])).toBe(true);
  });
});

describe("condition-draft whenToRows/rowsToWhen", () => {
  it("a leaf round-trips through whenToRows/rowsToWhen unchanged", () => {
    const when = { duration: { atLeast: 10, below: 30 } };
    expect(rowsToWhen(whenToRows(when))).toEqual(when);
  });

  it("a nested all/any/not tree round-trips unchanged", () => {
    const when = {
      all: [
        { toggle: "combat" },
        { any: [{ class: "fighter" }, { class: "cleric" }] },
        { not: { duration: { below: 10 } } },
      ],
    };
    expect(rowsToWhen(whenToRows(when))).toEqual(when);
  });

  it("an empty when-object round-trips to an empty rows list", () => {
    expect(whenToRows(undefined)).toEqual([]);
    expect(rowsToWhen([])).toEqual({});
  });
});

describe("condition-draft path addressing", () => {
  const leaf = (type: string, value: string) => {
    const row = newLeafRow(type);
    row.value = value;
    return row;
  };

  function tree(): ConditionRow[] {
    // rows = [ leaf(a), group(not) [ [ leaf(b) ] ] ]
    const inner = leaf("toggle", "b");
    const group = newGroupRow("not");
    group.branches = [[inner]];
    return [leaf("toggle", "a"), group];
  }

  it("getConditionAt resolves a top-level row", () => {
    const rows = tree();
    expect(getConditionAt(rows, [0])).toBe(rows[0]);
  });

  it("getConditionAt resolves a row nested inside a branch", () => {
    const rows = tree();
    const group = rows[1];
    expect(getConditionAt(rows, [1, 0, 0])).toBe(group.branches![0][0]);
  });

  it("getConditionAt returns undefined for an out-of-range or malformed path", () => {
    const rows = tree();
    expect(getConditionAt(rows, [5])).toBeUndefined();
    expect(getConditionAt(rows, [0, 0, 0])).toBeUndefined(); // rows[0] is a leaf, no branches
    expect(getConditionAt(rows, [])).toBeUndefined();
  });

  it("removeConditionAt splices the row out and renumbers siblings", () => {
    const rows = tree();
    const removed = removeConditionAt(rows, [0]);
    expect(removed?.value).toBe("a");
    expect(rows).toHaveLength(1);
    expect(rows[0].op).toBe("not");
  });

  it("removeConditionAt reaches into a nested branch without disturbing siblings", () => {
    const rows = tree();
    const removed = removeConditionAt(rows, [1, 0, 0]);
    expect(removed?.value).toBe("b");
    expect(rows[1].branches).toEqual([[]]);
    expect(rows).toHaveLength(2); // top level untouched
  });

  it("removeConditionAt is a no-op for a stale/out-of-range path", () => {
    const rows = tree();
    expect(removeConditionAt(rows, [9])).toBeUndefined();
    expect(rows).toHaveLength(2);
  });

  it("insertConditionAt inserts at the given index, clamped to the list bounds", () => {
    const rows = tree();
    const fresh = leaf("toggle", "c");
    insertConditionAt(rows, [1], fresh);
    expect(rows[1]).toBe(fresh);
    expect(rows).toHaveLength(3);

    const appended = leaf("toggle", "d");
    insertConditionAt(rows, [999], appended);
    expect(rows[rows.length - 1]).toBe(appended);
  });

  it("insertConditionAt drops a row into an empty branch (the 'not' drag-into-block case)", () => {
    const rows = tree();
    const dragged = removeConditionAt(rows, [0])!; // pull leaf "a" out
    const notGroup = rows[0];
    expect(notGroup.branches![0]).toHaveLength(1); // still has leaf "b"
    insertConditionAt(rows, [0, 0, 1], dragged); // append into the not's single branch
    expect(notGroup.branches![0]).toHaveLength(2);
    expect(notGroup.branches![0][1].value).toBe("a");
  });

  it("insertConditionAt is a no-op when the branch path itself doesn't resolve", () => {
    const rows = tree();
    insertConditionAt(rows, [0, 0, 0], leaf("toggle", "x")); // rows[0] is a leaf, no branches
    expect(rows).toHaveLength(2);
  });

  it("a remove-then-insert round trip preserves the row's identity (uid) across a move", () => {
    const rows = tree();
    const dragged = removeConditionAt(rows, [1, 0, 0])!;
    insertConditionAt(rows, [0], dragged);
    expect(rows[0]).toBe(dragged);
    expect(getConditionAt(rows, [0])?.uid).toBe(dragged.uid);
  });

  it("isDescendantPath is true for the ancestor's own path and anything nested under it", () => {
    expect(isDescendantPath([1], [1])).toBe(true); // same row -- dropping onto itself
    expect(isDescendantPath([1], [1, 0, 0])).toBe(true); // inside its own branch
    expect(isDescendantPath([1], [1, 0, 5, 2, 3])).toBe(true); // deeper still
  });

  it("isDescendantPath is false for siblings, ancestors, and unrelated branches", () => {
    expect(isDescendantPath([1], [0])).toBe(false); // sibling
    expect(isDescendantPath([1, 0, 0], [1])).toBe(false); // path is an ancestor, not descendant
    expect(isDescendantPath([1], [2, 0, 0])).toBe(false); // unrelated row
  });

  it("adjustPathAfterRemoval shifts a same-list sibling index down by one", () => {
    // rows[0] removed -- a target originally at rows[1] is now at rows[0].
    expect(adjustPathAfterRemoval([0], [1])).toEqual([0]);
    // Same, but the target is nested inside that shifted sibling -- only the shared depth
    // shifts, the rest of the path (which addresses something inside that row) is untouched.
    expect(adjustPathAfterRemoval([0], [1, 0, 2])).toEqual([0, 0, 2]);
  });

  it("adjustPathAfterRemoval leaves a target before the removed index alone", () => {
    expect(adjustPathAfterRemoval([2], [0])).toEqual([0]);
    expect(adjustPathAfterRemoval([2], [1, 0, 0])).toEqual([1, 0, 0]);
  });

  it("adjustPathAfterRemoval leaves paths in a different list untouched", () => {
    // Removed from branch [1,0]; target lives in a sibling branch [1,1] -- unrelated list.
    expect(adjustPathAfterRemoval([1, 0, 0], [1, 1, 0])).toEqual([1, 1, 0]);
    // Removed at the root; target is nested two branches deep -- prefixes don't match at
    // the root's own depth (0), so no adjustment, even though [2] > [0] superficially.
    expect(adjustPathAfterRemoval([0], [0, 0, 2])).toEqual([0, 0, 2]);
  });

  it("insertConditionAt with an adjusted path lands correctly after a same-list removal (the drag-into-a-sibling-group regression)", () => {
    // rows = [ leaf(a), group(not) [ [] ] ] -- dragging the leaf into the not's own (empty)
    // branch: before removal, the not group's branch is addressed as [1, 0, 0]. Naively
    // reusing that path after removing rows[0] silently drops the leaf (the not group has
    // shifted to index 0, so [1,0,0] no longer resolves to anything).
    const inner: ConditionRow[] = [];
    const group = newGroupRow("not");
    group.branches = [inner];
    const rows = [newLeafRow("toggle"), group];

    const sourcePath = [0];
    const rawTargetPath = [1, 0, 0];
    const dragged = removeConditionAt(rows, sourcePath)!;
    const targetPath = adjustPathAfterRemoval(sourcePath, rawTargetPath);
    insertConditionAt(rows, targetPath, dragged);

    expect(rows).toHaveLength(1);
    expect(rows[0].branches![0]).toHaveLength(1);
    expect(rows[0].branches![0][0]).toBe(dragged);
  });

  describe("branch addressing (whole-branch drag-and-drop)", () => {
    // rows = [ group(any) [ [leaf(a)], [leaf(b)] ], group(all) [ [leaf(c)], [leaf(d)] ] ]
    function branchTree(): ConditionRow[] {
      const any = newGroupRow("any");
      any.branches = [[leaf("toggle", "a")], [leaf("toggle", "b")]];
      const all = newGroupRow("all");
      all.branches = [[leaf("toggle", "c")], [leaf("toggle", "d")]];
      return [any, all];
    }

    it("removeBranchAt splices a branch out of its group and renumbers siblings", () => {
      const rows = branchTree();
      const removed = removeBranchAt(rows, [0], 0);
      expect(removed?.[0].value).toBe("a");
      expect(rows[0].branches).toHaveLength(1);
      expect(rows[0].branches![0][0].value).toBe("b");
    });

    it("removeBranchAt is a no-op for an out-of-range branch or non-group path", () => {
      const rows = branchTree();
      expect(removeBranchAt(rows, [0], 9)).toBeUndefined();
      expect(rows[0].branches).toHaveLength(2);
      // [0, 0, 0] is a leaf inside a branch, not a group row -- has no `branches` of its own.
      expect(removeBranchAt(rows, [0, 0, 0], 0)).toBeUndefined();
    });

    it("insertBranchAt splices a branch into the target group at a clamped index", () => {
      const rows = branchTree();
      const dragged = removeBranchAt(rows, [0], 0)!;
      insertBranchAt(rows, [1], 1, dragged);
      expect(rows[1].branches).toHaveLength(3);
      expect(rows[1].branches![1][0].value).toBe("a");

      // Out-of-range index clamps to the end, same as insertConditionAt.
      const another = removeBranchAt(rows, [0], 0)!;
      insertBranchAt(rows, [1], 999, another);
      expect(rows[1].branches![rows[1].branches!.length - 1][0].value).toBe(
        "b",
      );
    });

    it("insertBranchAt is a no-op when the group path doesn't resolve to a group row", () => {
      const rows = branchTree();
      insertBranchAt(rows, [0, 0, 0], 0, [leaf("toggle", "x")]);
      expect(rows[0].branches).toHaveLength(2);
      expect(rows[1].branches).toHaveLength(2);
    });

    it("a remove-then-insert round trip moves a branch's content across groups intact", () => {
      const rows = branchTree();
      const dragged = removeBranchAt(rows, [0], 1)!; // branch [leaf(b)]
      insertBranchAt(rows, [1], 0, dragged);
      expect(rows[0].branches).toHaveLength(1);
      expect(rows[0].branches![0][0].value).toBe("a");
      expect(rows[1].branches).toHaveLength(3);
      expect(rows[1].branches![0]).toBe(dragged);
      expect(rows[1].branches![0][0].value).toBe("b");
    });

    it("isDescendantPath guards a branch from being dropped into its own nested content", () => {
      // A group nested inside branch [0, 1]'s own content lives at e.g. [0, 1, 0].
      const nestedGroupPath = [0, 1, 0];
      // The branch's own rows-list address is [groupPath..., branchIndex] = [0, 1].
      expect(isDescendantPath([0, 1], nestedGroupPath)).toBe(true);
      // An unrelated group elsewhere in the tree is not a descendant.
      expect(isDescendantPath([0, 1], [1])).toBe(false);
    });
  });
});
