// Text and separator rows follow the fields around them: a hidden group takes its note and its
// separator along, so no stray divider or orphaned note is left behind.
import { describe, expect, it } from "vitest";
import { visibleRows } from "../../src/lib/row-visibility";
import type { Slot } from "../../src/types";

const field = (id: string): Slot => ({
  id,
  label: id,
  section: "s",
  type: "item_picker",
  filter: id,
});
const sep = (id: string): Slot => ({ id, section: "s", type: "separator" });
const text = (id: string): Slot => ({
  id,
  section: "s",
  type: "text",
  text: id,
});

/** The ids `visibleRows` keeps when only the fields in `shown` show. */
function keep(rows: Slot[], shown: string[]): string[] {
  return visibleRows(rows, (row) => shown.includes(row.id)).map(
    (row) => row.id,
  );
}

describe("visibleRows", () => {
  const rows = [
    text("note1"),
    field("a"),
    sep("sep1"),
    text("note2"),
    field("b"),
    field("c"),
    sep("sep2"),
    field("d"),
  ];

  it("keeps every row while every field shows", () => {
    expect(keep(rows, ["a", "b", "c", "d"])).toEqual(rows.map((r) => r.id));
  });

  it("keeps a group's text while any of its fields shows", () => {
    expect(keep(rows, ["c"])).toEqual(["note2", "c"]);
  });

  it("drops a group's text and separator once all its fields hide", () => {
    expect(keep(rows, ["a", "d"])).toEqual(["note1", "a", "sep2", "d"]);
  });

  it("drops a separator with no shown field above or below it", () => {
    expect(keep(rows, ["d"])).toEqual(["d"]);
    expect(keep(rows, ["a"])).toEqual(["note1", "a"]);
  });

  it("puts one separator between shown groups, the lower group's own", () => {
    expect(
      keep([field("a"), sep("s1"), sep("s2"), field("b")], ["a", "b"]),
    ).toEqual(["a", "s2", "b"]);
  });

  it("keeps nothing when no field shows", () => {
    expect(keep(rows, [])).toEqual([]);
  });
});
