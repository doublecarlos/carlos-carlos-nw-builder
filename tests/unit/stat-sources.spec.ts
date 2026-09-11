// The stat source popover's per-line attribution (engine/stat-sources.ts): one line per build
// row, each linking back to the row that produced it, while a pipeline stage's own line links
// nowhere.
import { describe, it, expect } from "vitest";
import * as db from "../../src/data/db";
import * as engine from "../../src/engine/engine";
import { sectionsFor } from "../../src/engine/stat-sources";
import type {
  Bonus,
  Build,
  Item,
  Schema,
  Slot,
  SlotsData,
} from "../../src/types";

const schema: Schema = {
  stats: [{ key: "power", label: "Power", kind: "int" }],
  statByKey: { power: { key: "power", label: "Power", kind: "int" } },
  statKeys: ["power"],
  multiplicativeStats: [],
  ratingStats: [],
  abilityStats: [],
  ratingConversion: [],
  abilityContributions: [],
  forteSplit: {},
  roles: { dps: { label: "DPS", hpBonus: 1, damageBonus: 1.2 } },
  statScalers: [],
};

const BONUS = "ring-bonus";

const ring: Item = {
  id: "ring",
  name: "Test Ring",
  filter: "rings",
  tags: ["ring"],
  power: 10,
  bonuses: [BONUS],
};

const bonuses: Bonus[] = [
  { id: BONUS, name: "Ring Bonus", grants: [{ stats: { power: 100 } }] },
];

const slots: Slot[] = [
  {
    id: "gear.ring1",
    label: "Ring 1",
    section: "gear",
    type: "item_picker",
    filter: "rings",
  },
  {
    id: "gear.ring2",
    label: "Ring 2",
    section: "gear",
    type: "item_picker",
    filter: "rings",
  },
];

const slotsData: SlotsData = {
  sections: [{ id: "gear", label: "Gear" }],
  slots,
  presets: [],
};

const testDb = db.build([ring], bonuses, schema, slotsData);

const build: Build = {
  id: "b",
  name: "b",
  choices: { "gear.ring1": ring.id, "gear.ring2": ring.id },
  values: {},
  assignments: {},
  occurrenceInputs: {},
  listRows: {},
  disabledSlots: {},
  context: { role: "dps" } as Build["context"],
  compare: { id: "", highlight: false, onlyDiff: false, statLines: false },
};

describe("stat source lines", () => {
  const result = engine.resolveBuild(testDb, build);
  const [rating, percentage] = sectionsFor(result, build, testDb, "power");

  it("lists the same item in two slots as two lines, each linked to its own slot", () => {
    const itemLines = rating.sources.filter((s) => s.name === ring.name);
    expect(itemLines).toEqual([
      { name: ring.name, value: 10, slotId: "gear.ring1" },
      { name: ring.name, value: 10, slotId: "gear.ring2" },
    ]);
  });

  it("links a bonus line to the bonus's instancing slot", () => {
    const bonusLine = rating.sources.find((s) => s.name === "Ring Bonus");
    expect(bonusLine).toMatchObject({ value: 100, slotId: "gear.ring1" });
  });

  it("leaves a pipeline stage's own line unlinked", () => {
    const [conversion] = percentage.sources;
    expect(conversion.name).toBe("Rating contribution");
    expect(conversion).not.toHaveProperty("slotId");
  });
});
