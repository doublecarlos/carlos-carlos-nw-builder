// useCompareDiff's typed-value diffing (`inputDiffs`), and `paramDiffTitle`'s display string
// for what the compare build holds.
import { describe, it, expect } from "vitest";
import { ref } from "vue";
import * as db from "../../../src/data/db";
import * as engine from "../../../src/engine/engine";
import {
  paramDiffTitle,
  useCompareDiff,
} from "../../../src/composables/useCompareDiff";
import {
  assignmentAddress,
  bonusStatAddress,
  itemStatAddress,
} from "../../../src/lib/build-inputs";
import type {
  Bonus,
  Build,
  BuildParameterSlot,
  Item,
  Schema,
  SlotsData,
} from "../../../src/types";

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
  roles: { dps: { label: "DPS", hpBonus: 1, damageBonus: 1 } },
};

const ring: Item = {
  id: "ring",
  name: "Test Ring",
  filter: "rings",
  dynamicStats: [{ stat: "power", min: 0, max: 100, default: 10 }],
  bonuses: ["proc"],
};
const plainRing: Item = { id: "plain", name: "Plain Ring", filter: "rings" };
const boon: Item = {
  id: "boon",
  name: "Test Boon",
  filter: "boons",
  inlineRepetition: { min: 0, max: 3, default: 0 },
};
const bonuses: Bonus[] = [
  {
    id: "proc",
    name: "Proc",
    grants: [
      {
        when: { toggle: "combat" },
        dynamicStats: [
          { stat: "power", min: 0, max: 500, default: 50, label: "Proc power" },
        ],
      },
    ],
  },
];
const slotsData: SlotsData = {
  sections: [{ id: "gear", label: "Gear", slotIds: [] }],
  slots: [
    {
      id: "gear.ring",
      label: "Ring",
      section: "gear",
      type: "item_picker",
      filter: "rings",
    },
    {
      id: "boons.row",
      label: "Boons",
      section: "gear",
      type: "point_assignment",
      filter: "boons",
    },
  ],
  presets: [],
};
const testDb = db.build([ring, plainRing, boon], bonuses, schema, slotsData);

function build(overrides: Partial<Build> = {}): Build {
  return {
    id: "b",
    name: "Other",
    choices: { "gear.ring": ring.id },
    values: {},
    bonusValues: {},
    assignments: {},
    listRows: {},
    disabledSlots: {},
    context: { role: "dps" } as Build["context"],
    compare: { id: "", highlight: false, onlyDiff: false, statLines: false },
    ...overrides,
  };
}

function diffsFor(own: Build, other: Build, slotId: string) {
  const { inputDiffs } = useCompareDiff({
    db: ref(testDb),
    build: ref(own),
    result: ref(engine.resolveBuild(testDb, own)),
    compareBuild: ref(other),
    compareResult: ref(engine.resolveBuild(testDb, other)),
    itemIn: (id) => testDb.get(own.choices[id]) ?? null,
  });
  return inputDiffs(slotId);
}

describe("inputDiffs", () => {
  it("reports a bonus's dynamic stat at its anchor slot, even while its grant is inactive", () => {
    const own = build({ bonusValues: { proc: { stat: { power: 200 } } } });
    expect(diffsFor(own, build(), "gear.ring")).toEqual([
      {
        address: bonusStatAddress("proc", "power"),
        label: "Proc power",
        otherLabel: "50",
      },
    ]);
  });

  it("reports an item's own dynamic stat", () => {
    const other = build({ values: { "gear.ring": { stat: { power: 70 } } } });
    expect(diffsFor(build(), other, "gear.ring")).toEqual([
      {
        address: itemStatAddress("gear.ring", "power"),
        label: "Power",
        otherLabel: "70",
      },
    ]);
  });

  it("compares resolved values, so an explicit default matches an unset one", () => {
    const own = build({ bonusValues: { proc: { stat: { power: 50 } } } });
    expect(diffsFor(own, build(), "gear.ring")).toEqual([]);
  });

  it("leaves a slot whose choice differs to the choice note", () => {
    const own = build({ values: { "gear.ring": { stat: { power: 70 } } } });
    const other = build({ choices: { "gear.ring": plainRing.id } });
    expect(diffsFor(own, other, "gear.ring")).toEqual([]);
  });

  it("reports one point_assignment item's count", () => {
    const other = build({ assignments: { "boons.row": { boon: 2 } } });
    expect(diffsFor(build(), other, "boons.row")).toEqual([
      {
        address: assignmentAddress("boons.row", "boon"),
        label: "Test Boon",
        otherLabel: "2",
      },
    ]);
  });
});

describe("paramDiffTitle", () => {
  const percentSlot: BuildParameterSlot = {
    id: "scalers.encounterDamage",
    label: "Encounter damage",
    section: "scalers",
    type: "build_parameter",
    paramType: "percent",
    path: "scalers.encounterDamage",
  };

  it("shows a percent parameter in percent units", () => {
    const other = { context: { scalers: { encounterDamage: 0.55 } } };
    expect(paramDiffTitle(other as unknown as Build, percentSlot)).toBe("55%");
  });

  it("shows (none) for an unset percent parameter", () => {
    const other = { context: {} };
    expect(paramDiffTitle(other as unknown as Build, percentSlot)).toBe(
      "(none)",
    );
  });
});
