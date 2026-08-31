// Expansion of `item_picker_list` containers into rows, and the row counts a stored build
// carries. Fixtures are local: what matters here is the shape of the expansion, not which
// slots happen to ship as lists.
import { describe, expect, it } from "vitest";
import {
  expandSlots,
  listRowCount,
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

  it("passes a tag selector and a visibility condition down to the row", () => {
    const tagged: ItemPickerListSlot = {
      ...misc,
      filter: undefined,
      tags: ["a", "b"],
      visibleWhen: { equipped: { tag: "x" } },
    };
    const row = rowSlot(tagged, 1);
    expect(row.tags).toEqual(["a", "b"]);
    expect(row.filter).toBeUndefined();
    expect(row.visibleWhen).toEqual({ equipped: { tag: "x" } });
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
        values: { "misc.misc#5": { power: 1 } },
        assignments: { "group.group#3": { "item-c": 2 } },
      }),
    ).toEqual({ "misc.misc": 5, "group.group": 3 });
  });
});

describe("normalise", () => {
  it("keeps a row count the build was saved with, filled or not", () => {
    const build = storage.normalise({
      choices: { "misc.misc#1": "vip-hp-bonus-self" },
      listRows: { "misc.misc": 4 },
    });
    expect(build.listRows["misc.misc"]).toBe(4);
  });

  it("grows a payload to cover a pick whose row count was lost", () => {
    const build = storage.normalise({
      choices: { "misc.misc#3": "vip-hp-bonus-self" },
    });
    expect(build.listRows["misc.misc"]).toBe(3);
  });

  it("coerces a nonsense count rather than carrying it through", () => {
    const build = storage.normalise({ listRows: { "misc.misc": -2.5 } });
    expect(build.listRows["misc.misc"]).toBe(0);
  });
});
