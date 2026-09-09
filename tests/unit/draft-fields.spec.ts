// Coverage for the shared kit behind the four editor-form draft modules
// (item-draft.ts/preset-draft.ts/slot-draft.ts/bonus-draft.ts), tested on its own since it has
// no domain shape of its own to piggyback tests on.
import { describe, it, expect } from "vitest";
import {
  entriesToRows,
  rowsToEntries,
  putIfSet,
  hasValue,
  numberOrUnset,
  fieldDiffLabel,
  arrayDiffLabel,
  statDiffLabel,
  dynamicStatsDiffLabel,
  type DiffCheck,
} from "../../src/lib/draft-fields";

describe("entriesToRows / rowsToEntries", () => {
  it("round-trips a record through a row array", () => {
    const record = { a: 1, b: 2 };
    const rows = entriesToRows(record, (key, value) => ({ key, value }));
    expect(rows).toEqual([
      { key: "a", value: 1 },
      { key: "b", value: 2 },
    ]);
    expect(
      rowsToEntries(
        rows,
        (row) => row.key,
        (row) => row.value,
      ),
    ).toEqual(record);
  });

  it("treats an undefined record as empty", () => {
    expect(entriesToRows(undefined, (key, value) => ({ key, value }))).toEqual(
      [],
    );
  });

  it("drops a row with no key, or whose value maps to undefined", () => {
    const rows = [
      { key: "", value: "1" },
      { key: "a", value: "" },
      { key: "b", value: "2" },
    ];
    expect(
      rowsToEntries(
        rows,
        (row) => row.key,
        (row) => (row.value === "" ? undefined : Number(row.value)),
      ),
    ).toEqual({ b: 2 });
  });
});

describe("putIfSet", () => {
  it("sets a non-empty value", () => {
    const out: { name?: string } = {};
    putIfSet(out, "name", "Vorpal");
    expect(out.name).toBe("Vorpal");
  });

  it("drops an empty string, null, undefined, and an empty array/object", () => {
    const out: {
      name?: string;
      tags?: string[];
      meta?: Record<string, number>;
    } = {};
    putIfSet(out, "name", "");
    putIfSet(out, "tags", []);
    putIfSet(out, "meta", {});
    expect(out).toEqual({});
  });

  it("keeps a non-empty array or object", () => {
    const out: { tags?: string[]; meta?: Record<string, number> } = {};
    putIfSet(out, "tags", ["a"]);
    putIfSet(out, "meta", { a: 1 });
    expect(out).toEqual({ tags: ["a"], meta: { a: 1 } });
  });
});

describe("hasValue / numberOrUnset", () => {
  it("hasValue is false only for null and empty string", () => {
    expect(hasValue(null)).toBe(false);
    expect(hasValue("")).toBe(false);
    expect(hasValue(0)).toBe(true);
    expect(hasValue("0")).toBe(true);
  });

  it("numberOrUnset parses a real value, drops a cleared or non-finite one", () => {
    expect(numberOrUnset("3")).toBe(3);
    expect(numberOrUnset(3)).toBe(3);
    expect(numberOrUnset("")).toBeUndefined();
    expect(numberOrUnset(null)).toBeUndefined();
    expect(numberOrUnset("not a number")).toBeUndefined();
  });
});

describe("fieldDiffLabel", () => {
  interface Widget {
    name: string;
    count: number;
  }

  const checks: DiffCheck<Widget>[] = [
    (old, nw) => (old.name !== nw.name ? `edit name -> "${nw.name}"` : null),
    (old, nw) => (old.count !== nw.count ? `edit count -> ${nw.count}` : null),
  ];

  it("returns the first check's label", () => {
    const old = JSON.stringify({ name: "a", count: 1 });
    const nw = JSON.stringify({ name: "b", count: 2 });
    expect(fieldDiffLabel(checks, old, nw, "edit widget")).toBe(
      'edit name -> "b"',
    );
  });

  it("falls through to the next check when the first field is unchanged", () => {
    const old = JSON.stringify({ name: "a", count: 1 });
    const nw = JSON.stringify({ name: "a", count: 2 });
    expect(fieldDiffLabel(checks, old, nw, "edit widget")).toBe(
      "edit count -> 2",
    );
  });

  it("falls back when no check matches", () => {
    const same = JSON.stringify({ name: "a", count: 1 });
    expect(fieldDiffLabel(checks, same, same, "edit widget")).toBe(
      "edit widget",
    );
  });

  it("falls back on unparseable JSON instead of throwing", () => {
    expect(
      fieldDiffLabel(checks, "{not json", "{not json", "edit widget"),
    ).toBe("edit widget");
  });
});

describe("arrayDiffLabel", () => {
  it("labels a pure addition, removal, and mixed edit", () => {
    expect(arrayDiffLabel("tag", [], ["a"])).toBe("add tag (1)");
    expect(arrayDiffLabel("tag", ["a", "b"], ["a"])).toBe("remove tag (1)");
    expect(arrayDiffLabel("tag", ["a"], ["b"])).toBe("edit tags (+1 / −1)");
  });

  it("pluralizes a multi-item add/remove", () => {
    expect(arrayDiffLabel("tag", [], ["a", "b"])).toBe("add tags (2)");
  });
});

describe("statDiffLabel", () => {
  it("names the one stat that changed", () => {
    expect(
      statDiffLabel([{ key: "power", value: 1 }], [{ key: "power", value: 2 }]),
    ).toBe("edit stat: power");
  });

  it("lists up to three changed keys, marking add/remove", () => {
    expect(
      statDiffLabel(
        [
          { key: "power", value: 1 },
          { key: "haste", value: 3 },
        ],
        [{ key: "crit", value: 2 }],
      ),
    ).toBe("edit stats: +crit, −power, −haste");
  });

  it("collapses to a count past three changes", () => {
    const old = [
      { key: "a", value: 1 },
      { key: "b", value: 1 },
      { key: "c", value: 1 },
      { key: "d", value: 1 },
    ];
    const nw = old.map((s) => ({ ...s, value: s.value + 1 }));
    expect(statDiffLabel(old, nw)).toBe("edit stats (4 changed)");
  });
});

describe("dynamicStatsDiffLabel", () => {
  it("defers to arrayDiffLabel when the stat set changed", () => {
    expect(dynamicStatsDiffLabel([], [{ stat: "power" }])).toBe(
      "add dynamic stat (1)",
    );
  });

  it("labels a range edit when the same stats remain", () => {
    expect(
      dynamicStatsDiffLabel([{ stat: "power" }], [{ stat: "power" }]),
    ).toBe("edit dynamic stat range");
  });
});
