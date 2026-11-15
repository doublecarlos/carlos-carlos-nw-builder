// Value labels: an ordered number parameter, like an enemy rank, whose values read by name.
// The value stays a number, so `atLeast` conditions and `tierBy` ladders keep working, and
// only what the player reads changes.
import { describe, expect, it } from "vitest";
import * as db from "../../src/data/db";
import * as catalog from "../../src/data/catalog";
import * as engine from "../../src/engine/engine";
import { inputEntries } from "../../src/engine/inputs";
import { writeInput } from "../../src/lib/build-inputs";
import { tierHeading } from "../../src/lib/item-card-rows";
import type {
  Bonus,
  Build,
  BuildParameterSlot,
  Item,
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

const rank: BuildParameterSlot = {
  id: "globals.rank",
  label: "Rank",
  section: "globals",
  type: "build_parameter",
  paramType: "number",
  path: "globals.rank",
  default: 3,
  min: 1,
  max: 3,
  step: 1,
  valueLabels: { "1": "Weak", "3": "Strong" },
  globalInput: true,
};

const bane: Bonus = {
  id: "bane",
  name: "Bane",
  inputs: { rank: { global: rank.id } },
  grants: [
    {
      tierBy: { formula: "$rank" },
      tiers: [
        { atLeast: 2, stats: { power: 10 } },
        { atLeast: 3, stats: { power: 30 } },
      ],
    },
  ],
};

const items: Item[] = [
  { id: "blade", name: "Blade", filter: "gear", bonuses: ["bane"] },
];
const slots: Slot[] = [
  {
    id: "a",
    label: "a",
    section: "gear",
    type: "item_picker",
    filter: "gear",
  },
  rank,
];
const testDb = db.build(items, [bane], schema, {
  sections: [
    { id: "gear", label: "Gear", slotIds: [] },
    { id: "globals", label: "Global inputs", slotIds: [] },
  ],
  slots,
  presets: [],
});

function build(): Build {
  return {
    id: "b",
    name: "b",
    choices: { a: "blade" },
    values: {},
    bonusValues: {},
    assignments: {},
    listRows: {},
    disabledSlots: {},
    context: { role: "dps" } as Build["context"],
    compare: { id: "", highlight: false, onlyDiff: false, statLines: false },
  };
}

const bonusEntry = (b: Build) =>
  engine.resolveBuild(testDb, b).bonuses.find((entry) => entry.id === "bane")!;

describe("a labeled rank input", () => {
  // The slot's default stands in until the player picks a rank.
  it("picks the grant tier its value reaches, the default while nothing is stored", () => {
    const b = build();
    expect(bonusEntry(b).appliedStats?.power).toBe(30);
    writeInput(b, { store: "context", path: rank.path }, 2);
    expect(bonusEntry(b).appliedStats?.power).toBe(10);
    writeInput(b, { store: "context", path: rank.path }, 1);
    expect(bonusEntry(b).appliedStats?.power ?? 0).toBe(0);
  });

  it("names rungs by label, and unlabeled ones by number", () => {
    const grant = bonusEntry(build()).grants![0];
    expect(tierHeading(grant, 3)).toBe("Rank ≥ Strong");
    expect(tierHeading(grant, 2)).toBe("Rank ≥ 2");
  });

  // Preset buttons and range notes format through the reader's spec.
  it("formats the reader's control values by label", () => {
    const b = build();
    const entry = inputEntries(testDb, b, engine.resolveBuild(testDb, b)).find(
      (input) => input.bonusInput?.global === rank.id,
    )!;
    expect([1, 2, 3].map(entry.spec.format)).toEqual(["Weak", "2", "Strong"]);
  });
});

describe("catalog.validate: value labels", () => {
  const slotErrors = (overrides: Partial<BuildParameterSlot>) =>
    catalog
      .validateSlots([{ ...rank, ...overrides }])
      .filter((finding) => finding.level === "error")
      .map((finding) => finding.name);

  it("accepts whole numbers within the bounds", () => {
    expect(slotErrors({})).toEqual([]);
  });

  it("rejects labels on a percent, a key outside the bounds or not a whole number", () => {
    expect(slotErrors({ paramType: "percent", max: 1 })).toEqual([rank.id]);
    expect(slotErrors({ valueLabels: { "4": "Huge" } })).toEqual([rank.id]);
    expect(slotErrors({ valueLabels: { "1.5": "Half" } })).toEqual([rank.id]);
    expect(slotErrors({ valueLabels: { "2": " " } })).toEqual([rank.id]);
  });

  // The bonus editor has no field for them, so a bonus's own input would lose them on save.
  it("rejects labels on a bonus's own input", () => {
    const own: Bonus = {
      ...bane,
      inputs: {
        rank: {
          type: "number",
          min: 1,
          max: 3,
          default: 3,
          valueLabels: { "3": "Strong" },
        },
      },
    };
    const findings = catalog
      .validate([{ ...items[0] }], [own], undefined, [], slots, [
        { id: "gear", label: "Gear", slotIds: [] },
        { id: "globals", label: "Global inputs", slotIds: [] },
      ])
      .filter((finding) => finding.name === "bane")
      .map((finding) => finding.message);
    expect(findings).toEqual([expect.stringMatching(/value labels/)]);
  });
});
