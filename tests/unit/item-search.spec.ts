// itemSearchText (#picker search): the extra haystack the item picker hands ComboBox so a typed
// query can match what an item grants, not just what it is called. The interesting property is
// that it is built statically off the catalogue -- a bonus contributes its terms whether or not
// it is currently active, which is what makes a partly-unlocked set findable.

import { describe, it, expect } from "vitest";
import * as db from "../../src/data/db";
import { NW_SCHEMA } from "../../src/data/data";
import { matchesQuery } from "../../src/lib/text-filter";
import { itemSearchText } from "../../src/lib/item-search";
import type { Bonus, Item, SlotsData } from "../../src/types";

const slotsData: SlotsData = {
  sections: [{ id: "gear", label: "Gear" }],
  slots: [
    {
      id: "gear.ring1",
      label: "Ring 1",
      section: "gear",
      type: "item_picker",
      filter: "gear_ring",
    },
  ],
};

/** A two-piece set whose second tier only pays out once both pieces are equipped -- the
 *  "potential" case: nothing here is active in any build, and the terms must still be found. */
const setBonus: Bonus = {
  id: "test-tyrants-grip",
  name: "Tyrant's Grip",
  grants: [
    {
      name: "Tyrant's Opening",
      stats: { severity: 400 },
    },
    {
      tiers: [{ bonusOccurrences: { atLeast: 2 }, stats: { crit_avoid: 250 } }],
    },
  ],
};

const ringWithSet: Item = {
  id: "ring-set-piece",
  name: "Band of Quiet Nights",
  filter: "gear_ring",
  il: 1000,
  power: 1200,
  bonuses: ["test-tyrants-grip"],
};

const plainRing: Item = {
  id: "ring-plain",
  name: "Simple Loop",
  filter: "gear_ring",
  il: 900,
  deflect: 800,
};

const testDb = db.build(
  [ringWithSet, plainRing],
  [setBonus],
  NW_SCHEMA,
  slotsData,
);

/** How ComboBox actually uses the two together, so these read as real queries. */
const finds = (item: Item, query: string) =>
  matchesQuery([item.name, itemSearchText(testDb, item)], query);

describe("itemSearchText", () => {
  it("matches an item by a stat it carries, by label and by raw key", () => {
    expect(finds(ringWithSet, NW_SCHEMA.statByKey.power.label)).toBe(true);
    expect(finds(ringWithSet, "power")).toBe(true);
    expect(finds(plainRing, "deflect")).toBe(true);
  });

  it("does not match an item on a stat it does not carry", () => {
    expect(finds(plainRing, "power")).toBe(false);
    expect(finds(ringWithSet, "deflect")).toBe(false);
  });

  it("matches on the name of a bonus the item belongs to", () => {
    expect(finds(ringWithSet, "tyrant")).toBe(true);
    expect(finds(ringWithSet, "quiet tyrant")).toBe(true);
    expect(finds(plainRing, "tyrant")).toBe(false);
  });

  it("matches on a named grant within a bonus", () => {
    expect(finds(ringWithSet, "opening")).toBe(true);
  });

  it("matches stats from a tier that no build has unlocked yet", () => {
    // `crit_avoid` is only ever paid out at 2 set pieces. Nothing is equipped here at all, and
    // it still has to be findable -- searching for the stat is how you go looking for the set.
    expect(finds(ringWithSet, "crit_avoid")).toBe(true);
    expect(finds(ringWithSet, NW_SCHEMA.statByKey.crit_avoid.label)).toBe(true);
  });

  it("leaves the item's own name matchable, unchanged", () => {
    expect(finds(ringWithSet, "band")).toBe(true);
    expect(finds(ringWithSet, "nights band")).toBe(true);
  });

  it("returns the same text on repeat calls (memoized per catalogue)", () => {
    expect(itemSearchText(testDb, ringWithSet)).toBe(
      itemSearchText(testDb, ringWithSet),
    );
  });
});
