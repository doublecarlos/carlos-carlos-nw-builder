// whenRowsComplete: the guard the bonus editors use to hold off auto-saving while a
// condition tree is half-drawn. `leafToSpec`/`rowsToWhen` drop leaves with no value and
// empty group branches on serialization, so an incomplete tree would come back smaller
// than what the user drew -- the round-trip would wipe the row from the form.
import { describe, it, expect } from "vitest";
import {
  whenRowsComplete,
  newLeafRow,
  newGroupRow,
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
