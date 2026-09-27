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

// Stat labels come from the shipped schema; the contribution rules are made here.
const schema: Schema = {
  stats: [{ key: "power", label: "Power", kind: "int" }],
  statByKey: { power: { key: "power", label: "Power", kind: "int" } },
  statKeys: [
    "il",
    "power",
    "power_p",
    "forte_p",
    "out_healing_p",
    "overall_healing",
    "hit_points_mult",
  ],
  multiplicativeStats: ["hit_points_mult"],
  ratingStats: [],
  abilityStats: [],
  // `power_p` caps at 0.5: 0.4 from the conversion plus 0.3 of forte puts it over.
  ratingConversion: [
    {
      rating: "power",
      percent: "power_p",
      capPct: 0.4,
      allowedOver: 0,
      pctCap: 0.5,
    },
  ],
  statContributions: [
    { source: "out_healing_p", target: "overall_healing", divisor: 1 },
  ],
  forteSplit: { primary: 2 },
  roles: { dps: { label: "DPS", hpBonus: 1, damageBonus: 1.2 } },
};

const BONUS = "ring-bonus";

const ring: Item = {
  id: "ring",
  name: "Test Ring",
  filter: "rings",
  tags: ["ring"],
  power: 10,
  forte_p: 0.3,
  out_healing_p: 0.2,
  hit_points_mult: 0.1,
  bonuses: [BONUS],
};

const boon: Item = {
  id: "boon",
  name: "Test Boon",
  filter: "boons",
  power: 5,
  inlineRepetition: { min: 0, max: 5, default: 0 },
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
  {
    id: "boons.tier1",
    label: "Boons",
    section: "gear",
    type: "point_assignment",
    filter: "boons",
  },
];

const slotsData: SlotsData = {
  sections: [{ id: "gear", label: "Gear", slotIds: [] }],
  slots,
  presets: [],
};

const testDb = db.build([ring, boon], bonuses, schema, slotsData);

const build: Build = {
  id: "b",
  name: "b",
  choices: { "gear.ring1": ring.id, "gear.ring2": ring.id },
  values: {},
  bonusValues: {},
  assignments: { "boons.tier1": { [boon.id]: 3 } },
  occurrenceInputs: {},
  listRows: {},
  disabledSlots: {},
  context: { role: "dps", forte: { primary: "power_p" } } as Build["context"],
  compare: { id: "", highlight: false, onlyDiff: false, statLines: false },
};

describe("stat source lines", () => {
  const result = engine.resolveBuild(testDb, build);
  const [rating, percentage] = sectionsFor(result, "power");

  it("lists the same item in two slots as two lines, each linked to its own slot", () => {
    const itemLines = rating.sources.filter((s) => s.name === ring.name);
    expect(itemLines).toEqual([
      { name: ring.name, value: 10, slotId: "gear.ring1" },
      { name: ring.name, value: 10, slotId: "gear.ring2" },
    ]);
  });

  it("credits a point_assignment item its stat times its count, linked to the slot", () => {
    const boonLine = rating.sources.find((s) => s.name === boon.name);
    expect(boonLine).toEqual({
      name: boon.name,
      value: 15,
      slotId: "boons.tier1",
    });
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

  it("names a contribution line by its source stat", () => {
    const [overall] = sectionsFor(result, "overall_healing");
    expect(overall.sources).toEqual([{ name: "Outgoing Healing", value: 0.4 }]);
  });

  it("shows a forte pick's share as a Forte line, unlinked", () => {
    // Two rings at 0.3 forte each, halved by the primary slot's divisor.
    const forteLine = percentage.sources.find((s) => s.name === "Forte");
    expect(forteLine).toEqual({ name: "Forte", value: 0.3 });
  });

  it("closes a stat over its cap with a negative line, so the lines sum to the capped value", () => {
    const last = percentage.sources.at(-1);
    expect(last?.name).toBe("Over cap");
    expect(last?.value).toBeCloseTo(-0.2, 9);
    const sum = percentage.sources.reduce((total, s) => total + s.value, 0);
    expect(sum).toBeCloseTo(result.stages.capped.power_p, 9);
  });

  it("flags a multiplicative stat, and only that one", () => {
    const [mult] = sectionsFor(result, "hit_points_mult");
    expect(mult.multiplicative).toBe(true);
    expect(mult.sources.map((s) => s.value)).toEqual([0.1, 0.1]);
    expect(rating.multiplicative).toBe(false);
  });
});
