// A shared picker is an ordinary pick whose readers are derived: every bonus testing one of
// its candidates, or a tag one carries, through `equipped`. Sharing only decides where its
// control shows, never what the engine resolves.
import { describe, expect, it } from "vitest";
import * as db from "../../src/data/db";
import * as catalog from "../../src/data/catalog";
import * as engine from "../../src/engine/engine";
import {
  sharedPickerReaders,
  sharedPickersByRow,
  sharedRowIds,
  sharedUsers,
} from "../../src/lib/shared-inputs";
import type {
  Bonus,
  Build,
  Item,
  ItemPickerSlot,
  Schema,
  Slot,
} from "../../src/types";

const schema: Schema = {
  stats: [{ key: "power", label: "Power", kind: "int" }],
  statByKey: { power: { key: "power", label: "Power", kind: "int" } },
  statKeys: ["power"],
  multiplicativeStats: [],
  ratingStats: [],
  abilityStats: [],
  ratingConversion: [],
  statContributions: [],
  forteSplit: {},
  roles: { dps: { label: "DPS", hpBonus: 1, damageBonus: 1.2 } },
};

const place: ItemPickerSlot = {
  id: "globals.place",
  label: "Place",
  section: "globals",
  type: "item_picker",
  filter: "place",
  globalInput: true,
};
const gear = (id: string): Slot => ({
  id,
  label: id,
  section: "gear",
  type: "item_picker",
  filter: "gear",
});

// "coast" reads the region tag, "chart" the place by id, "inland" a `not` on the tag, and
// "harbor" is the port's own bonus, which does not read its own slot.
const coast: Bonus = {
  id: "coast",
  name: "Coast",
  grants: [
    { when: { equipped: { tag: "region:coast" } }, stats: { power: 10 } },
  ],
};
const chart: Bonus = {
  id: "chart",
  name: "Chart",
  grants: [{ when: { equipped: { item: "port" } }, stats: { power: 1 } }],
};
const inland: Bonus = {
  id: "inland",
  name: "Inland",
  grants: [
    {
      when: { not: { equipped: { tag: "region:coast" } } },
      stats: { power: 100 },
    },
  ],
};
const harbor: Bonus = {
  id: "harbor",
  name: "Harbor",
  grants: [
    { when: { equipped: { tag: "region:coast" } }, stats: { power: 1000 } },
  ],
};
const plain: Bonus = {
  id: "plain",
  name: "Plain",
  grants: [{ stats: { power: 2 } }],
};

const items: Item[] = [
  {
    id: "port",
    name: "Port",
    filter: "place",
    tags: ["region:coast"],
    bonuses: ["harbor"],
  },
  { id: "desert", name: "Desert", filter: "place", tags: ["region:sand"] },
  { id: "shell", name: "Shell", filter: "gear", bonuses: ["coast"] },
  { id: "map", name: "Map", filter: "gear", bonuses: ["chart"] },
  { id: "camel", name: "Camel", filter: "gear", bonuses: ["inland"] },
  { id: "rock", name: "Rock", filter: "gear", bonuses: ["plain"] },
];
const bonuses = [coast, chart, inland, harbor, plain];
const slots: Slot[] = [gear("a"), gear("b"), place];
const testDb = db.build(items, bonuses, schema, {
  sections: [
    { id: "gear", label: "Gear", slotIds: [] },
    { id: "globals", label: "Shared inputs", slotIds: [] },
  ],
  slots,
  presets: [],
});

function build(choices: Record<string, string>): Build {
  return {
    id: "b",
    name: "b",
    choices,
    values: {},
    bonusValues: {},
    assignments: {},
    listRows: {},
    disabledSlots: {},
    context: { role: "dps" } as Build["context"],
    compare: { id: "", highlight: false, onlyDiff: false, statLines: false },
  };
}

const power = (b: Build, bonusId: string) =>
  engine.resolveBuild(testDb, b).bonuses.find((entry) => entry.id === bonusId)
    ?.appliedStats?.power ?? 0;

describe("derived readers", () => {
  it("reads a candidate's tag or id, never a candidate's own bonus", () => {
    expect(testDb.sharedReaders.get(place.id)).toEqual([
      "coast",
      "chart",
      "inland",
    ]);
  });
});

describe("resolving a shared pick", () => {
  // Zone effects are item data, so they apply with nothing reading the slot.
  it("equips the pick with no reader carried", () => {
    expect(power(build({ "globals.place": "port" }), "harbor")).toBe(1000);
  });

  it("holds a `not` on a region tag while nothing is picked", () => {
    expect(power(build({ a: "camel" }), "inland")).toBe(100);
    expect(
      power(build({ a: "camel", "globals.place": "port" }), "inland"),
    ).toBe(0);
  });
});

describe("where a shared picker shows", () => {
  const visibility = (choices: Record<string, string>) => {
    const b = build(choices);
    const readers = sharedPickerReaders(
      testDb,
      engine.resolveBuild(testDb, b).bonuses,
    );
    return {
      users: sharedUsers(new Map(), readers),
      rows: sharedRowIds(testDb.slots, b, sharedUsers(new Map(), readers)),
      byRow: sharedPickersByRow(testDb, readers),
    };
  };

  it("shows its row while a reader is equipped, and on each reader's row", () => {
    const { users, rows, byRow } = visibility({ a: "shell", b: "map" });
    expect(users.get(place.id)).toEqual(["Coast", "Chart"]);
    expect(rows).toEqual(new Set([place.id]));
    expect(byRow.get("a")).toEqual([
      { slot: testDb.slotById.get(place.id), shared: "Shared with Chart" },
    ]);
    expect(byRow.get("b")?.[0].shared).toBe("Shared with Coast");
  });

  // A pick is never equipped without a row showing it.
  it("keeps its row while it holds a pick after its last reader leaves", () => {
    expect(visibility({ a: "rock", "globals.place": "port" }).rows).toEqual(
      new Set([place.id]),
    );
    expect(visibility({ a: "rock" }).rows).toEqual(new Set());
  });
});

describe("catalog.validate: shared pickers", () => {
  const validate = (
    slot: Partial<ItemPickerSlot> | Slot,
    extraItems: Item[] = [],
  ) =>
    catalog
      .validateSharedPickers(
        [{ ...place, ...slot } as Slot],
        [...items, ...extraItems],
        bonuses,
        [],
      )
      .map((finding) => finding.message);

  it("accepts a plain shared picker", () => {
    expect(validate({})).toEqual([]);
  });

  // A display rule must never prune, hide or switch off the pick.
  it("rejects quick, availableWhen, parent, toggleable and list rows", () => {
    for (const field of [
      { quick: true },
      { availableWhen: { equipped: { item: "rock" } } },
      { parent: "a" },
      { toggleable: true },
      { list: "misc" },
    ])
      expect(validate(field)).toEqual([
        expect.stringContaining(Object.keys(field)[0]),
      ]);
  });

  it("rejects a list picker", () => {
    expect(validate({ type: "item_picker_list" } as unknown as Slot)).toEqual([
      expect.stringContaining("item_picker_list"),
    ]);
  });

  it("rejects a reader tag that ordinary gear also carries", () => {
    expect(
      validate({}, [
        {
          id: "seaboots",
          name: "Sea boots",
          filter: "gear",
          tags: ["region:coast"],
        },
      ]),
    ).toEqual([
      expect.stringContaining('"seaboots" also carries'),
      expect.stringContaining('"seaboots" also carries'),
    ]);
  });

  it("rejects a picker with neither a label nor a labeled category", () => {
    const { label: _label, ...unlabeled } = place;
    expect(
      catalog
        .validateSharedPickers([unlabeled], items, bonuses, [])
        .map((finding) => finding.message),
    ).toEqual([expect.stringContaining("needs a label")]);
  });
});
