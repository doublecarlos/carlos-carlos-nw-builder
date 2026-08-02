// Stable item ids (build-parameters plan 0004): `Item.id` is the identifier, `name` is
// display-only and may repeat. These prove the two behaviours the plan's own verification
// section calls out: two items sharing a display name still resolve and count independently,
// and renaming an item's display name leaves anything that refers to it by id unaffected.
import { describe, it, expect } from "vitest";
import * as db from "../../src/data/db";
import * as engine from "../../src/engine/engine";
import * as catalog from "../../src/data/catalog";
import type { Build, Item, Schema, SlotsData } from "../../src/types";

const schema: Schema = {
  stats: [{ key: "il", label: "Item Level", kind: "flat" }],
  statByKey: { il: { key: "il", label: "Item Level", kind: "flat" } },
  statKeys: ["il"],
  multiplicativeStats: [],
  ratingStats: [],
  abilityStats: [],
  ratingConversion: [],
  abilityContributions: [],
  forteSplit: {},
  roles: { dps: { label: "DPS", hpBonus: 1, damageBonus: 1 } },
};

const slots: SlotsData = {
  sections: [{ id: "gear", label: "Gear" }],
  slots: [
    {
      id: "gear.ring1",
      label: "Ring 1",
      section: "gear",
      type: "item_picker",
      filter: "gear_ring",
    },
    {
      id: "gear.ring2",
      label: "Ring 2",
      section: "gear",
      type: "item_picker",
      filter: "gear_ring",
    },
  ],
};

function testBuild(choices: Record<string, string>): Build {
  return {
    id: "b",
    name: "b",
    choices,
    values: {},
    context: {
      class: "",
      role: "",
      combatType: "",
      location: "",
      damageType: "",
      duration: 0,
      magnitude: 0,
      m32Forte: false,
      forte: {},
      toggles: {},
    },
    compare: { id: "", highlight: false, onlyDiff: false },
  };
}

describe("item ids: two items sharing a display name", () => {
  const itemA: Item = {
    id: "ring-a",
    name: "Ring",
    filter: "gear_ring",
    il: 100,
    maxCopies: 1,
  };
  const itemB: Item = {
    id: "ring-b",
    name: "Ring",
    filter: "gear_ring",
    il: 200,
    maxCopies: 1,
  };
  const testDb = db.build([itemA, itemB], [], schema, slots);

  it("both resolve independently by id", () => {
    expect(testDb.get("ring-a")).toBe(itemA);
    expect(testDb.get("ring-b")).toBe(itemB);
  });

  it("count separately for maxCopies -- one of each is fine, two of the same id is not", () => {
    const oneEach = engine.resolveBuild(
      testDb,
      testBuild({ "gear.ring1": "ring-a", "gear.ring2": "ring-b" }),
    );
    expect(oneEach.errors).toEqual([]);

    const twoOfA = engine.resolveBuild(
      testDb,
      testBuild({ "gear.ring1": "ring-a", "gear.ring2": "ring-a" }),
    );
    expect(twoOfA.errors.some((e) => e.kind === "maxCopies")).toBe(true);
  });
});

describe("item ids: renaming leaves an id-keyed reference intact", () => {
  it("a build choosing an item by id still resolves it, to the renamed item, after an overlay edit", () => {
    const created = catalog.upsert(
      catalog.emptyOverlay(),
      "items",
      "some-item",
      {
        id: "some-item",
        name: "Old Name",
        filter: "gear_ring",
        il: 500,
      },
    );
    const build = testBuild({ "gear.ring1": "some-item" });

    const beforeRename = engine.resolveBuild(catalog.makeDb([created]), build);
    expect(
      beforeRename.rows.find((r) => r.slotId === "gear.ring1")?.item?.name,
    ).toBe("Old Name");

    // Same id, edited name -- what ItemForm.vue's save path does when only the Name field changes.
    const renamed = catalog.upsert(created, "items", "some-item", {
      id: "some-item",
      name: "New Name",
      filter: "gear_ring",
      il: 500,
    });
    const afterRename = engine.resolveBuild(catalog.makeDb([renamed]), build);
    expect(
      afterRename.rows.find((r) => r.slotId === "gear.ring1")?.item?.name,
    ).toBe("New Name");
  });
});
