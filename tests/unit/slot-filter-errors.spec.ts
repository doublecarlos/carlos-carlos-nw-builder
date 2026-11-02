// A pick its slot doesn't accept is a build error, however it got there: a replacement from
// another filter accepted into the slot, or a hand-edited build. Purpose-made catalog, so the
// tests stay independent of which items ship.
import { describe, it, expect } from "vitest";
import * as db from "../../src/data/db";
import * as engine from "../../src/engine/engine";
import { migrateItemIds } from "../../src/storage/migrate-item-ids";
import { rowSlotId } from "../../src/lib/item-picker-list";
import { NW_SCHEMA } from "../../src/data/data";
import type { Build, Item, SlotsData } from "../../src/types";

const slotsData: SlotsData = {
  sections: [{ id: "gear", label: "Gear", slotIds: [] }],
  slots: [
    {
      id: "ring",
      label: "Ring",
      section: "gear",
      type: "item_picker",
      filter: "test_ring",
    },
    {
      id: "power",
      label: "Power",
      section: "gear",
      type: "item_picker",
      tags: ["test_power"],
    },
    {
      id: "misc",
      label: "Misc",
      section: "gear",
      type: "item_picker_list",
      filter: "test_misc",
      defaultRows: 1,
    },
  ],
};

const ring: Item = { id: "ring", name: "Ring", filter: "test_ring" };
const neck: Item = { id: "neck", name: "Neck", filter: "test_neck" };
const oldRing: Item = {
  id: "old-ring",
  name: "Old Ring",
  filter: "test_ring",
  hideFromPicker: true,
  replacedBy: "neck",
};
const power: Item = {
  id: "power",
  name: "Power",
  filter: "test_other",
  tags: ["test_power"],
};
const misc: Item = { id: "misc", name: "Misc", filter: "test_misc" };

const testDb = db.build(
  [ring, neck, oldRing, power, misc],
  [],
  NW_SCHEMA,
  slotsData,
);

const buildWith = (choices: Record<string, string>): Build =>
  ({
    id: "b",
    name: "b",
    choices,
    values: {},
    assignments: {},
    listRows: {},
    disabledSlots: {},
    context: {},
    compare: { id: "", highlight: false, onlyDiff: false, statLines: false },
  }) as unknown as Build;

const filterErrors = (build: Build) =>
  engine
    .resolveBuild(testDb, build)
    .errors.filter((error) => error.kind === "slotFilter");

describe("a pick outside its slot's filter", () => {
  it("is flagged once a cross-filter replacement is accepted", () => {
    const build = buildWith({ ring: "old-ring" });
    expect(filterErrors(build)).toEqual([]);

    const migrated = migrateItemIds(testDb, build);
    expect(migrated.choices.ring).toBe("neck");
    expect(filterErrors(migrated)).toEqual([
      expect.objectContaining({ slotId: "ring", severity: "error" }),
    ]);
  });

  it("is flagged when a saved build names it directly", () => {
    expect(filterErrors(buildWith({ ring: "neck" }))).toHaveLength(1);
  });

  it("is flagged on a list row", () => {
    const row = rowSlotId("misc", 1);
    expect(filterErrors(buildWith({ [row]: "neck" }))).toEqual([
      expect.objectContaining({ slotId: row }),
    ]);
  });

  it("goes by tags on a slot that selects by tag", () => {
    // `power` carries the tag but not a matching filter; `ring` has neither.
    expect(filterErrors(buildWith({ power: "power" }))).toEqual([]);
    expect(filterErrors(buildWith({ power: "ring" }))).toHaveLength(1);
  });

  it("leaves picks the slot offers alone", () => {
    const build = buildWith({ ring: "ring", [rowSlotId("misc", 1)]: "misc" });
    expect(filterErrors(build)).toEqual([]);
  });
});
