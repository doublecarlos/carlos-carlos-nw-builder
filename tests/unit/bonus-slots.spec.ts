// "Where could this bonus come from" -- the lookup behind the Bonuses tab's locate action.
// Built on its own fixture rather than the shipped catalogue, so it keeps meaning something
// when the shipped data moves.
import { describe, it, expect } from "vitest";
import * as db from "../../src/data/db";
import { slotsSupplying, hasSuppliers } from "../../src/lib/bonus-slots";
import { NW_SCHEMA } from "../../src/data/data";
import type { Bonus, Item, SlotsData } from "../../src/types";

const bonuses: Bonus[] = [
  { id: "set-bonus", name: "Set Bonus", grants: [] },
  { id: "lonely-bonus", name: "Lonely Bonus", grants: [] },
];

const items: Item[] = [
  { id: "helm", name: "Helm", filter: "gear_head", bonuses: ["set-bonus"] },
  { id: "plain-helm", name: "Plain Helm", filter: "gear_head" },
  { id: "ring", name: "Ring", filter: "gear_ring", bonuses: ["set-bonus"] },
  { id: "boot", name: "Boot", filter: "gear_boots" },
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

describe("slotsSupplying", () => {
  it("names every slot whose candidates include a contributing item", () => {
    expect([...slotsSupplying(built, "set-bonus")].sort()).toEqual([
      "gear.head",
      "gear.ring1",
    ]);
  });

  it("leaves out a slot none of whose candidates contribute", () => {
    expect(slotsSupplying(built, "set-bonus").has("gear.boots")).toBe(false);
  });

  it("is empty for a bonus no item carries", () => {
    expect(slotsSupplying(built, "lonely-bonus").size).toBe(0);
  });

  it("is empty for a bonus id that does not exist", () => {
    expect(slotsSupplying(built, "no-such-bonus").size).toBe(0);
  });

  it("answers from one index, so repeated asks are the same set", () => {
    // The inspector asks this per row on every render; the memo is what keeps that from
    // walking the whole slot list once per bonus.
    expect(slotsSupplying(built, "set-bonus")).toBe(
      slotsSupplying(built, "set-bonus"),
    );
  });

  it("indexes a rebuilt catalogue separately", () => {
    const rebuilt = db.build(items, bonuses, NW_SCHEMA, slots);
    expect(slotsSupplying(rebuilt, "set-bonus")).not.toBe(
      slotsSupplying(built, "set-bonus"),
    );
    expect([...slotsSupplying(rebuilt, "set-bonus")].sort()).toEqual([
      "gear.head",
      "gear.ring1",
    ]);
  });
});

describe("hasSuppliers", () => {
  it("is true only when the filter would lead somewhere", () => {
    expect(hasSuppliers(built, "set-bonus")).toBe(true);
    expect(hasSuppliers(built, "lonely-bonus")).toBe(false);
  });
});
