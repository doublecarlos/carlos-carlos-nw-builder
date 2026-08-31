// An `item_picker` slot whose chosen item declares an `Item.inlineRepetition`: the pick is in
// the build N times rather than once. The contract the whole feature rests on is that N
// repetitions of one pick resolve exactly as N separate picks of the same item would -- stats,
// tags, equipped counts and plain bonus attachments all scale, while a `BonusOccurrenceConfig`
// keeps its own independent count.
import { describe, it, expect } from "vitest";
import * as db from "../../src/data/db";
import * as bonus from "../../src/engine/bonus";
import * as engine from "../../src/engine/engine";
import { inlineRepetitionCount } from "../../src/lib/inline-repetition";
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

const STACK_BONUS = "stack-bonus";
const PROC_BONUS = "proc-bonus";

/** Repeats 0-3 times, carrying both attachment shapes so the two counts can be told apart. */
const shard: Item = {
  id: "shard",
  name: "Test Shard",
  filter: "shards",
  tags: ["shard"],
  power: 10,
  maxCopies: 2,
  inlineRepetition: { min: 0, max: 3, default: 1 },
  bonuses: [STACK_BONUS, { bonus: PROC_BONUS, min: 0, max: 1, default: 0 }],
};

/** Repeats, carries stats, carries no bonuses -- so a row's stats are the item's line alone. */
const gem: Item = {
  id: "gem",
  name: "Test Gem",
  filter: "shards",
  tags: ["shard"],
  power: 10,
  inlineRepetition: { min: 0, max: 3, default: 1 },
};

/** Same slot, no repetition config at all -- the "in the build exactly once" baseline. */
const plain: Item = {
  id: "plain",
  name: "Plain Shard",
  filter: "shards",
  tags: ["shard"],
  power: 10,
};

const bonuses: Bonus[] = [
  { id: STACK_BONUS, name: "Stack", grants: [{ stats: { power: 100 } }] },
  { id: PROC_BONUS, name: "Proc", grants: [{ stats: { power: 1000 } }] },
];

const slots: Slot[] = [
  {
    id: "gear.shard",
    label: "Shard",
    section: "gear",
    type: "item_picker",
    filter: "shards",
  },
];

const slotsData: SlotsData = {
  sections: [{ id: "gear", label: "Gear" }],
  slots,
  presets: [],
};

const testDb = db.build([shard, gem, plain], bonuses, schema, slotsData);

function testBuild(overrides: Partial<Build> = {}): Build {
  return {
    id: "b",
    name: "b",
    choices: { "gear.shard": shard.id },
    values: {},
    assignments: {},
    occurrenceInputs: {},
    listRows: {},
    context: { role: "dps" } as Build["context"],
    compare: { id: "", highlight: false, onlyDiff: false, statLines: false },
    ...overrides,
  };
}

/** The count as the build stores it: `assignments[slotId][itemId]`, the same field a
 *  point_assignment row writes into. */
const withCount = (count: number) =>
  testBuild({ assignments: { "gear.shard": { [shard.id]: count } } });

describe("reading the count", () => {
  it("falls back to the config's own default when the build has never touched it", () => {
    expect(inlineRepetitionCount(testBuild(), "gear.shard", shard)).toBe(1);
  });

  it("reads the stored count once there is one", () => {
    expect(inlineRepetitionCount(withCount(3), "gear.shard", shard)).toBe(3);
  });

  it("is 1 for an item that declares no config", () => {
    expect(inlineRepetitionCount(testBuild(), "gear.shard", plain)).toBe(1);
  });
});

describe("what the engine collects", () => {
  it("counts the pick as N equipped copies and N of each of its tags", () => {
    const { ctx } = bonus.collect(testDb, withCount(3));
    expect(ctx.equipped.get(shard.id)).toBe(3);
    expect(ctx.tags.get("shard")).toBe(3);
  });

  it("scales a bare-id bonus attachment with the count", () => {
    const { ctx } = bonus.collect(testDb, withCount(3));
    expect(ctx.bonusOccurrences.get(STACK_BONUS)).toBe(3);
  });

  it("leaves a BonusOccurrenceConfig attachment on its own independent count", () => {
    const build = withCount(3);
    build.occurrenceInputs = { [shard.id]: { [PROC_BONUS]: 1 } };
    const { ctx } = bonus.collect(testDb, build);
    expect(ctx.bonusOccurrences.get(STACK_BONUS)).toBe(3);
    expect(ctx.bonusOccurrences.get(PROC_BONUS)).toBe(1);
  });

  it("equips nothing at a count of 0, while keeping the bonus reachable", () => {
    const { ctx, zeroCandidates } = bonus.collect(testDb, withCount(0));
    expect(ctx.equipped.has(shard.id)).toBe(false);
    expect(ctx.tags.has("shard")).toBe(false);
    // Nothing to count, but the bonus stays reachable through an anchor-only entry so a hover
    // card can tell "this pick is at 0" apart from "this item doesn't carry it".
    expect(ctx.bonusOccurrences.get(STACK_BONUS) ?? 0).toBe(0);
    expect(zeroCandidates.some((c) => c.bonusId === STACK_BONUS)).toBe(true);
  });

  it("counts an item with no config exactly once", () => {
    const { ctx } = bonus.collect(
      testDb,
      testBuild({ choices: { "gear.shard": plain.id } }),
    );
    expect(ctx.equipped.get(plain.id)).toBe(1);
    expect(ctx.tags.get("shard")).toBe(1);
  });
});

describe("what the engine computes", () => {
  /** One row's stats. Driven by `gem` (no bonuses), so this reads the item's own line rather
   *  than the bonus stats a row is also credited with. */
  const gemPowerAt = (count: number) => {
    const build = testBuild({
      choices: { "gear.shard": gem.id },
      assignments: { "gear.shard": { [gem.id]: count } },
    });
    const result = engine.resolveBuild(testDb, build);
    return result.rows.find((row) => row.slotId === "gear.shard")!.stats.power;
  };

  it("multiplies the item's own stat line by the count", () => {
    expect(gemPowerAt(1)).toBe(10);
    expect(gemPowerAt(3)).toBe(30);
    expect(gemPowerAt(0)).toBe(0);
  });

  it("matches what the same count spread over separate picks would total", () => {
    // Two slots, one copy each, against one slot at two copies: the same totals either way,
    // which is the whole claim inline repetition makes.
    const twoSlots = db.build([shard, gem, plain], bonuses, schema, {
      ...slotsData,
      slots: [
        ...slots,
        { ...slots[0], id: "gear.shard2", label: "Shard 2" } as Slot,
      ],
    });
    const spread = engine.resolveBuild(
      twoSlots,
      testBuild({
        choices: { "gear.shard": gem.id, "gear.shard2": gem.id },
        assignments: {
          "gear.shard": { [gem.id]: 1 },
          "gear.shard2": { [gem.id]: 1 },
        },
      }),
    );
    const spreadPower = spread.rows.reduce(
      (sum, row) => sum + (row.stats.power ?? 0),
      0,
    );
    expect(gemPowerAt(2)).toBe(spreadPower);
  });
});

describe("what the engine reports", () => {
  const messagesFor = (build: Build) =>
    engine.resolveBuild(testDb, build).errors.map((error) => error.message);

  it("flags a count outside the config's declared bounds", () => {
    expect(messagesFor(withCount(9)).join(" ")).toMatch(
      /Test Shard: 9 is outside 0–3/,
    );
    expect(messagesFor(withCount(2))).toEqual([]);
  });

  it("counts repetitions toward maxCopies", () => {
    // maxCopies is 2, so three repetitions of the one pick is two copies too many -- the same
    // report three separate picks of it would produce.
    expect(messagesFor(withCount(3)).join(" ")).toMatch(
      /Test Shard is equipped 3 times, maximum 2/,
    );
  });
});
