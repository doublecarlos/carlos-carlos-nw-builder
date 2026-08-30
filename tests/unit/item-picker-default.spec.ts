// `ItemPickerSlot.default`: a slot whose empty state is not a sensible build starts on a named
// item, and returns to it when cleared, the same way a `build_parameter` starts on (and returns
// to) its own `default`.
import { describe, it, expect } from "vitest";
import * as db from "../../src/data/db";
import * as storage from "../../src/storage/storage";
import type { Item, Schema, Slot, SlotsData } from "../../src/types";

const schema: Schema = {
  stats: [],
  statByKey: {},
  statKeys: [],
  multiplicativeStats: [],
  ratingStats: [],
  abilityStats: [],
  ratingConversion: [],
  abilityContributions: [],
  forteSplit: {},
  roles: { dps: { label: "DPS", hpBonus: 1, damageBonus: 1.2 } },
  statScalers: [],
};

const thay: Item = { id: "location-thay", name: "Thay", filter: "location" };
const avernus: Item = {
  id: "location-avernus",
  name: "Avernus",
  filter: "location",
};

const defaulted: Slot = {
  id: "options.location",
  label: "Location",
  section: "options",
  type: "item_picker",
  filter: "location",
  default: thay.id,
  disallowEmpty: true,
};

const undefaulted: Slot = {
  id: "options.enemyType",
  label: "Enemy Type",
  section: "options",
  type: "item_picker",
  filter: "enemy_type",
};

const slotsData: SlotsData = {
  sections: [{ id: "options", label: "Options" }],
  slots: [defaulted, undefaulted],
  presets: [],
};

const testDb = db.build([thay, avernus], [], schema, slotsData);

describe("seeding a fresh build", () => {
  it("starts a defaulted slot on its item", () => {
    const { choices } = storage.seededDefaults(slotsData.slots, testDb);
    expect(choices["options.location"]).toBe(thay.id);
  });

  it("leaves a slot with no default empty", () => {
    const { choices } = storage.seededDefaults(slotsData.slots, testDb);
    expect(choices["options.enemyType"]).toBeUndefined();
  });

  it("seeds nothing for a build_parameter or point_assignment it wasn't given", () => {
    const { context, assignments } = storage.seededDefaults(
      slotsData.slots,
      testDb,
    );
    expect(context).toEqual({});
    expect(assignments).toEqual({});
  });
});

describe("what a seeded default is not", () => {
  it("is a plain stored choice, so a build that cleared the slot stays cleared", () => {
    // `normalise` replaces `choices` wholesale rather than merging the seeded defaults in --
    // a slot the player emptied must not quietly come back on the next load.
    const { choices } = storage.seededDefaults(slotsData.slots, testDb);
    const stored: Record<string, string> = {};
    expect(
      storage.normalise({ choices: stored }).choices["options.location"],
    ).toBeUndefined();
    expect(choices["options.location"]).toBe(thay.id);
  });
});
