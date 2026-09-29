// The typed-value substrate: reading and writing by address, and the engine's range check over
// every declared value.
import { describe, expect, it } from "vitest";
import * as db from "../../src/data/db";
import * as catalog from "../../src/data/catalog";
import * as engine from "../../src/engine/engine";
import {
  bonusStatAddress,
  inputKey,
  itemStatAddress,
  bonusInputAddress,
  readInput,
  storedInput,
  writeInput,
} from "../../src/lib/build-inputs";
import type {
  Bonus,
  Build,
  InputAddress,
  Item,
  Schema,
  Slot,
  SlotsData,
} from "../../src/types";

function emptyBuild(overrides: Partial<Build> = {}): Build {
  return {
    id: "b",
    name: "b",
    choices: {},
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

const bonusInput: InputAddress = {
  store: "bonusValues",
  bonusId: "proc",
  kind: "input",
  key: "stacks",
};

describe("readInput", () => {
  it("reads each store", () => {
    const build = emptyBuild({
      values: { ring: { stat: { power: 5 } } },
      bonusValues: { proc: { stat: { power: 7 }, input: { stacks: 3 } } },
      assignments: { boons: { boon: 4 } },
    });
    build.context.enemies = 6;

    expect(readInput(build, itemStatAddress("ring", "power"), 0)).toBe(5);
    expect(readInput(build, bonusStatAddress("proc", "power"), 0)).toBe(7);
    expect(readInput(build, bonusInput, 0)).toBe(3);
    expect(
      readInput(
        build,
        { store: "assignments", slotId: "boons", itemId: "boon" },
        0,
      ),
    ).toBe(4);
    expect(readInput(build, { store: "context", path: "enemies" }, 0)).toBe(6);
  });

  it("falls back to the default when nothing is stored", () => {
    const build = emptyBuild();
    expect(readInput(build, itemStatAddress("ring", "power"), 9)).toBe(9);
    expect(readInput(build, bonusStatAddress("proc", "power"), 8)).toBe(8);
    expect(storedInput(build, bonusInput)).toBeUndefined();
  });

  it("reads a boolean as 1 or 0", () => {
    const build = emptyBuild({
      bonusValues: { proc: { input: { on: true } } },
    });
    expect(readInput(build, { ...bonusInput, key: "on" }, 0)).toBe(1);
  });
});

describe("writeInput", () => {
  it("writes into missing containers", () => {
    const build = emptyBuild();
    writeInput(build, itemStatAddress("ring", "power"), 5);
    writeInput(build, bonusStatAddress("proc", "power"), 7);
    writeInput(build, bonusInput, true);
    expect(build.values).toEqual({ ring: { stat: { power: 5 } } });
    expect(build.bonusValues).toEqual({
      proc: { stat: { power: 7 }, input: { stacks: true } },
    });
  });

  it("drops a slot's entry once its last value is cleared", () => {
    const build = emptyBuild({
      values: { ring: { stat: { power: 5, crit: 1 } } },
    });
    writeInput(build, itemStatAddress("ring", "power"), null);
    expect(build.values).toEqual({ ring: { stat: { crit: 1 } } });
    writeInput(build, itemStatAddress("ring", "crit"), null);
    expect(build.values).toEqual({});
  });

  it("drops an empty kind, then an empty bonus entry", () => {
    const build = emptyBuild({
      bonusValues: { proc: { stat: { power: 7 }, input: { stacks: 3 } } },
    });
    writeInput(build, bonusInput, null);
    expect(build.bonusValues).toEqual({ proc: { stat: { power: 7 } } });
    writeInput(build, bonusStatAddress("proc", "power"), null);
    expect(build.bonusValues).toEqual({});
  });

  it("drops a repetition count's slot once its last count is cleared", () => {
    const build = emptyBuild({ assignments: { boons: { boon: 4 } } });
    writeInput(
      build,
      { store: "assignments", slotId: "boons", itemId: "boon" },
      null,
    );
    expect(build.assignments).toEqual({});
  });
});

describe("inputKey", () => {
  it("tells an item's stat and a bonus's stat apart", () => {
    expect(inputKey(itemStatAddress("proc", "power"))).not.toBe(
      inputKey(bonusStatAddress("proc", "power")),
    );
  });
});

describe("checkBounds", () => {
  it("accepts a default within its bounds", () => {
    expect(catalog.checkBounds({ min: 0, max: 3, default: 1 }, "x")).toBeNull();
  });

  it("names a non-numeric bound", () => {
    expect(catalog.checkBounds({ min: 0, max: "3", default: 1 }, "x")).toBe(
      "x has a non-numeric min/max/default",
    );
  });

  it("names a default outside its bounds", () => {
    expect(catalog.checkBounds({ min: 0, max: 3, default: 5 }, "x")).toBe(
      "x default: value 5 must be between 0 and 3",
    );
  });
});

describe("inputRanges", () => {
  const schema: Schema = {
    stats: [
      { key: "power", label: "Power", kind: "int" },
      { key: "outgoing_damage", label: "Outgoing Damage", kind: "percent" },
    ],
    statByKey: {
      power: { key: "power", label: "Power", kind: "int" },
      outgoing_damage: {
        key: "outgoing_damage",
        label: "Outgoing Damage",
        kind: "percent",
      },
    },
    statKeys: ["power", "outgoing_damage"],
    multiplicativeStats: [],
    ratingStats: [],
    abilityStats: [],
    ratingConversion: [],
    statContributions: [],
    forteSplit: {},
    roles: { dps: { label: "DPS", hpBonus: 1, damageBonus: 1.2 } },
  };

  const ring: Item = {
    id: "ring",
    name: "Test Ring",
    filter: "rings",
    dynamicStats: [
      { stat: "outgoing_damage", min: 0, max: 0.1, default: 0.05 },
    ],
    bonuses: ["proc"],
  };
  const boon: Item = {
    id: "boon",
    name: "Test Boon",
    filter: "boons",
    inlineRepetition: { min: 1, max: 3, default: 0 },
    bonuses: ["stack"],
  };
  const bonuses: Bonus[] = [
    {
      id: "stack",
      name: "Stack",
      inputs: { count: { type: "number", min: 0, max: 2, default: 0 } },
      grants: [],
    },
    {
      id: "proc",
      name: "Proc",
      grants: [
        { dynamicStats: [{ stat: "power", min: 0, max: 100, default: 50 }] },
      ],
    },
  ];
  const slots: Slot[] = [
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
  ];
  const slotsData: SlotsData = {
    sections: [{ id: "gear", label: "Gear", slotIds: [] }],
    slots,
    presets: [],
  };
  const testDb = db.build([ring, boon], bonuses, schema, slotsData);

  const errorsFor = (overrides: Partial<Build>) =>
    engine
      .resolveBuild(
        testDb,
        emptyBuild({ choices: { "gear.ring": ring.id }, ...overrides }),
      )
      .errors.filter((error) => error.kind === "outOfRange");

  it("reports nothing at the defaults", () => {
    expect(errorsFor({})).toEqual([]);
  });

  it("formats a percent dynamic stat as a percentage", () => {
    const [error] = errorsFor({
      values: { "gear.ring": { stat: { outgoing_damage: 0.25 } } },
    });
    expect(error.message).toBe(
      "Test Ring: value 25% must be between 0% and 10%",
    );
    expect(error.address).toEqual(
      itemStatAddress("gear.ring", "outgoing_damage"),
    );
  });

  it("attributes a bonus's dynamic stat to its anchor slot", () => {
    const [error] = errorsFor({
      bonusValues: { proc: { stat: { power: 500 } } },
    });
    expect(error.slotId).toBe("gear.ring");
    expect(error.address).toEqual(bonusStatAddress("proc", "power"));
  });

  it("checks the inputs of a point_assignment row's item bonuses", () => {
    const [error] = errorsFor({
      assignments: { "boons.row": { boon: 1 } },
      bonusValues: { stack: { input: { count: 3 } } },
    });
    expect(error.slotId).toBe("boons.row");
    expect(error.address).toEqual(bonusInputAddress("stack", "count"));
  });

  it("accepts 0 on a point_assignment row whatever its declared min", () => {
    expect(errorsFor({ assignments: { "boons.row": { boon: 0 } } })).toEqual(
      [],
    );
    expect(
      errorsFor({ assignments: { "boons.row": { boon: 5 } } }),
    ).toHaveLength(1);
  });
});
