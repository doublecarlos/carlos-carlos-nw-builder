// "Where could this come from": the lookup behind the Bonuses tab's locate actions, for a
// bonus, a tag or an item. Built on its own fixture rather than the shipped catalog, so it
// keeps meaning something when the shipped data moves.
import { describe, it, expect } from "vitest";
import * as db from "../../src/data/db";
import {
  slotsSupplying,
  hasSuppliers,
  supplyNeedFor,
} from "../../src/lib/bonus-slots";
import { NW_SCHEMA } from "../../src/data/data";
import type { Bonus, Item, SlotsData, SupplyNeed } from "../../src/types";

const SET: SupplyNeed = { kind: "bonus", bonusId: "set-bonus" };
const LONELY: SupplyNeed = { kind: "bonus", bonusId: "lonely-bonus" };

const bonuses: Bonus[] = [
  { id: "set-bonus", name: "Set Bonus", grants: [] },
  { id: "lonely-bonus", name: "Lonely Bonus", grants: [] },
];

const items: Item[] = [
  {
    id: "helm",
    name: "Helm",
    filter: "gear_head",
    bonuses: ["set-bonus"],
    tags: ["gem:amethyst"],
  },
  { id: "plain-helm", name: "Plain Helm", filter: "gear_head" },
  {
    id: "ring",
    name: "Ring",
    filter: "gear_ring",
    bonuses: ["set-bonus"],
    tags: ["gem:jade"],
  },
  { id: "boot", name: "Boot", filter: "gear_boots", tags: ["gem:jade"] },
];

const slots: SlotsData = {
  sections: [{ id: "gear", label: "Gear" }],
  slots: [
    {
      id: "gear.head",
      label: "Head",
      section: "gear",
      type: "item_picker",
      filter: "gear_head",
    },
    {
      id: "gear.ring1",
      label: "Ring 1",
      section: "gear",
      type: "item_picker",
      filter: "gear_ring",
    },
    {
      id: "gear.boots",
      label: "Boots",
      section: "gear",
      type: "item_picker",
      filter: "gear_boots",
    },
  ],
};

const built = db.build(items, bonuses, NW_SCHEMA, slots);

const sorted = (need: SupplyNeed) => [...slotsSupplying(built, need)].sort();

describe("slotsSupplying a bonus", () => {
  it("names every slot whose candidates include a contributing item", () => {
    expect(sorted(SET)).toEqual(["gear.head", "gear.ring1"]);
  });

  it("leaves out a slot none of whose candidates contribute", () => {
    expect(slotsSupplying(built, SET).has("gear.boots")).toBe(false);
  });

  it("is empty for a bonus no item carries", () => {
    expect(slotsSupplying(built, LONELY).size).toBe(0);
  });

  it("is empty for a bonus id that does not exist", () => {
    expect(
      slotsSupplying(built, { kind: "bonus", bonusId: "no-such-bonus" }).size,
    ).toBe(0);
  });

  it("answers from one index, so repeated asks are the same set", () => {
    // The inspector asks this per row on every render; the memo is what keeps that from
    // walking the whole slot list once per bonus.
    expect(slotsSupplying(built, SET)).toBe(slotsSupplying(built, SET));
  });

  it("indexes a rebuilt catalog separately", () => {
    const rebuilt = db.build(items, bonuses, NW_SCHEMA, slots);
    expect(slotsSupplying(rebuilt, SET)).not.toBe(slotsSupplying(built, SET));
    expect([...slotsSupplying(rebuilt, SET)].sort()).toEqual([
      "gear.head",
      "gear.ring1",
    ]);
  });
});

describe("slotsSupplying a tag", () => {
  it("names every slot whose candidates include an item carrying it", () => {
    expect(sorted({ kind: "tag", tag: "gem:jade" })).toEqual([
      "gear.boots",
      "gear.ring1",
    ]);
    expect(sorted({ kind: "tag", tag: "gem:amethyst" })).toEqual(["gear.head"]);
  });

  it("is empty for a tag no item carries", () => {
    expect(slotsSupplying(built, { kind: "tag", tag: "gem:opal" }).size).toBe(
      0,
    );
  });
});

describe("slotsSupplying an item", () => {
  it("names every slot the item is a candidate for", () => {
    expect(sorted({ kind: "item", itemId: "plain-helm" })).toEqual([
      "gear.head",
    ]);
  });

  it("is empty for an item id that does not exist", () => {
    expect(
      slotsSupplying(built, { kind: "item", itemId: "no-such-item" }).size,
    ).toBe(0);
  });
});

describe("hasSuppliers", () => {
  it("is true only when the filter would lead somewhere", () => {
    expect(hasSuppliers(built, SET)).toBe(true);
    expect(hasSuppliers(built, LONELY)).toBe(false);
    expect(hasSuppliers(built, { kind: "tag", tag: "gem:jade" })).toBe(true);
    expect(hasSuppliers(built, { kind: "item", itemId: "boot" })).toBe(true);
  });
});

describe("supplyNeedFor", () => {
  const jade: SupplyNeed = { kind: "tag", tag: "gem:jade" };

  it("hands back a failing leaf's need when the catalog can supply it", () => {
    expect(supplyNeedFor(built, { ok: false, label: "", need: jade })).toEqual(
      jade,
    );
  });

  it("gives a met leaf nothing: more of it is the wrong direction", () => {
    expect(
      supplyNeedFor(built, { ok: true, label: "", need: jade }),
    ).toBeNull();
  });

  it("gives a leaf about the context nothing", () => {
    expect(supplyNeedFor(built, { ok: false, label: "duration" })).toBeNull();
  });

  it("gives a need nothing in the catalog offers nothing", () => {
    expect(
      supplyNeedFor(built, { ok: false, label: "", need: LONELY }),
    ).toBeNull();
  });
});
