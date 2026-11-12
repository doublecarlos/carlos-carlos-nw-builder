// Expansion of `item_picker_list` containers into rows, and the row counts a stored build
// carries. Fixtures are local: what matters here is the shape of the expansion, not which
// slots happen to ship as lists.
import { describe, expect, it } from "vitest";
import {
  expandSlots,
  listRowCount,
  movedRowIndex,
  moveListRowData,
  parseRowSlotId,
  rowSlot,
  rowSlotId,
  storedListRows,
} from "../../src/lib/item-picker-list";
import * as storage from "../../src/storage/storage";
import type { Build, ItemPickerListSlot, Slot } from "../../src/types";

const misc: ItemPickerListSlot = {
  id: "misc.misc",
  label: "Misc",
  section: "misc",
  type: "item_picker_list",
  filter: "misc",
  defaultRows: 0,
};

const SLOTS: Slot[] = [
  {
    id: "misc.intro",
    section: "misc",
    type: "text",
    text: "notes",
  },
  misc,
  {
    id: "misc.after",
    label: "After",
    section: "misc",
    type: "item_picker",
    filter: "other",
  },
];

/** A build carrying only the fields expansion reads. */
const buildWith = (listRows: Record<string, number>) =>
  ({ listRows }) as unknown as Build;

describe("row slot ids", () => {
  it("round-trips a container id and a 1-based row number", () => {
    expect(rowSlotId("misc.misc", 3)).toBe("misc.misc#3");
    expect(parseRowSlotId("misc.misc#3")).toEqual({
      listId: "misc.misc",
      index: 3,
    });
  });

  it("rejects anything that is not a row id", () => {
    expect(parseRowSlotId("misc.misc")).toBeNull();
    expect(parseRowSlotId("misc.misc#0")).toBeNull();
    expect(parseRowSlotId("misc.misc#x")).toBeNull();
    expect(parseRowSlotId("#2")).toBeNull();
  });
});

describe("rowSlot", () => {
  it("is an ordinary item_picker carrying the container's selector and position", () => {
    expect(rowSlot(misc, 2)).toEqual({
      id: "misc.misc#2",
      label: "Misc 2",
      section: "misc",
      type: "item_picker",
      filter: "misc",
      list: "misc.misc",
    });
  });

  it("passes a tag selector down to the row", () => {
    const tagged: ItemPickerListSlot = {
      ...misc,
      filter: undefined,
      tags: ["a", "b"],
    };
    const row = rowSlot(tagged, 1);
    expect(row.tags).toEqual(["a", "b"]);
    expect(row.filter).toBeUndefined();
  });

  // The editor compares a row's slot by identity: a new object per expansion would re-render
  // every list row on each edit.
  it("is the same object for the same container and row, across builds", () => {
    const first = expandSlots(SLOTS, buildWith({ "misc.misc": 2 }));
    const second = expandSlots(SLOTS, buildWith({ "misc.misc": 3 }));
    expect(second[1]).toBe(first[1]);
    expect(rowSlot(misc, 2)).toBe(rowSlot(misc, 2));
    expect(rowSlot({ ...misc }, 2)).not.toBe(rowSlot(misc, 2));
  });
});

describe("expandSlots", () => {
  it("renders no rows for a list the build has never touched", () => {
    expect(expandSlots(SLOTS, buildWith({})).map((slot) => slot.id)).toEqual([
      "misc.intro",
      "misc.misc",
      "misc.after",
    ]);
  });

  it("falls back to defaultRows rather than to zero", () => {
    const seeded = [{ ...misc, defaultRows: 2 }];
    expect(expandSlots(seeded, buildWith({})).map((slot) => slot.id)).toEqual([
      "misc.misc#1",
      "misc.misc#2",
      "misc.misc",
    ]);
  });

  it("places the container after its rows, where its add button belongs", () => {
    const ids = expandSlots(SLOTS, buildWith({ "misc.misc": 3 })).map(
      (slot) => slot.id,
    );
    expect(ids).toEqual([
      "misc.intro",
      "misc.misc#1",
      "misc.misc#2",
      "misc.misc#3",
      "misc.misc",
      "misc.after",
    ]);
  });

  it("returns the same array when there is nothing to expand", () => {
    const plain = SLOTS.filter((slot) => slot.type !== "item_picker_list");
    expect(expandSlots(plain, buildWith({}))).toBe(plain);
  });

  it("reads the stored count ahead of defaultRows", () => {
    expect(listRowCount(buildWith({ "misc.misc": 1 }), misc)).toBe(1);
    expect(listRowCount(buildWith({}), { ...misc, defaultRows: 4 })).toBe(4);
    expect(listRowCount(null, misc)).toBe(0);
  });
});

describe("storedListRows", () => {
  it("counts up to the highest row any field stores something under", () => {
    expect(
      storedListRows({
        choices: { "misc.misc#2": "item-a", "gear.head": "item-b" },
        values: { "misc.misc#5": { stat: { power: 1 } } },
        assignments: { "group.group#3": { "item-c": 2 } },
        disabledSlots: {},
      }),
    ).toEqual({ "misc.misc": 5, "group.group": 3 });
  });
});

describe("normalize", () => {
  it("keeps a row count the build was saved with, filled or not", () => {
    const build = storage.normalize({
      choices: { "misc.misc#1": "vip-hp-bonus-self" },
      listRows: { "misc.misc": 4 },
    });
    expect(build.listRows["misc.misc"]).toBe(4);
  });

  it("grows a payload to cover a pick whose row count was lost", () => {
    const build = storage.normalize({
      choices: { "misc.misc#3": "vip-hp-bonus-self" },
    });
    expect(build.listRows["misc.misc"]).toBe(3);
  });

  it("coerces a nonsense count rather than carrying it through", () => {
    const build = storage.normalize({ listRows: { "misc.misc": -2.5 } });
    expect(build.listRows["misc.misc"]).toBe(0);
  });
});

describe("moving a list row", () => {
  it("shifts the rows between the two places by one, either way", () => {
    expect([1, 2, 3, 4].map((i) => movedRowIndex(i, 1, 3))).toEqual([
      3, 1, 2, 4,
    ]);
    expect([1, 2, 3, 4].map((i) => movedRowIndex(i, 4, 2))).toEqual([
      1, 3, 4, 2,
    ]);
  });

  it("re-keys only the moved list's rows", () => {
    const build = storage.defaultBuild("B");
    build.choices = {
      "misc.misc#1": "a",
      "misc.misc#2": "b",
      "other#1": "x",
      "misc.after": "y",
    };
    moveListRowData(build, "misc.misc", 2, 1);
    expect(build.choices).toEqual({
      "misc.misc#1": "b",
      "misc.misc#2": "a",
      "other#1": "x",
      "misc.after": "y",
    });
  });
});
