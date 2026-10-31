// The bonus model's semantics: occurrences, conditions, tiers, variants, stacking, exclusion
// and the errors a build reports. Each rule runs on a synthetic catalog built for it, so a
// failure means the rule changed, not the shipped data.

import { describe, it, expect } from "vitest";
import * as db from "../../src/data/db";
import * as engine from "../../src/engine/engine";
import { isHiddenBonus } from "../../src/engine/bonus";
import {
  appliedStatOf,
  bonusOf,
  isActive,
  picker,
  statOf,
  testBuild,
  testDb,
  testSchema,
  type TestBuildParts,
} from "./engine-fixtures";
import type {
  Build,
  BuildContext,
  Bonus,
  EngineError,
  Item,
  ItemPickerSlot,
  PointAssignmentSlot,
  SlotsData,
} from "../../src/types";

const BASE_CONTEXT: BuildContext = {
  class: "warlock",
  role: "dps",
  duration: 60,
  enemies: 1,
  damageType: "magical",
  magnitude: 100,
  m32Forte: false,
  mountBolster: 0,
  companionBolster: 0,
  forte: {},
  toggles: { combat: true, artifactCall: true },
};

const item = (id: string, filter: string, extra: Partial<Item> = {}): Item => ({
  id,
  name: id,
  filter,
  ...extra,
});

const bonuses: Bonus[] = [
  // One bonus shared by two items: any number of copies grants it once.
  { id: "single", grants: [{ stats: { strike_p: 0.09 } }] },
  {
    id: "gem-gated",
    grants: [{ when: { equipped: { tag: "gem" } }, stats: { ca_p: 0.03 } }],
  },
  {
    id: "long-fight",
    grants: [
      { stats: { strike_p: 0.06 } },
      { when: { duration: { atLeast: 10 } }, stats: { mana_regen: 0.1 } },
    ],
  },
  // 1.1% per full 5s, at most 6 intervals.
  {
    id: "per-interval",
    grants: [
      {
        when: { toggle: "combat" },
        stats: { strike_p: 0.011 },
        scale: { formula: "intervals(duration, 5, 6)" },
      },
    ],
  },
  {
    id: "tiered",
    grants: [
      {
        tiers: [
          { atLeast: 1, stats: { defense: 2500 } },
          { atLeast: 2, stats: { defense: 3000 } },
          { atLeast: 3, stats: { defense: 3500 } },
        ],
      },
    ],
  },
  {
    id: "halving",
    grants: [
      {
        stats: { movement: 0.1 },
        scale: { formula: "geometric(min(occurrences(), 3), 0.5)" },
      },
    ],
  },
  // A two-piece set: a flat grant, a location grant and one role variant per role.
  {
    id: "set",
    grants: [
      {
        when: { bonusOccurrences: { atLeast: 2 } },
        stats: { overall_healing: 0.05, incoming_damage: -0.05 },
      },
      {
        when: {
          equipped: { item: "location-a" },
          bonusOccurrences: { atLeast: 2 },
        },
        stats: { movement: 0.12 },
      },
      {
        when: {
          enemies: { exactly: 1 },
          toggle: "combat",
          bonusOccurrences: { atLeast: 2 },
        },
        variants: [
          { when: { role: "dps" }, stats: { outgoing_damage: 0.006 } },
          { when: { role: "healer" }, stats: { overall_healing: 0.006 } },
          { when: { role: "tank" }, stats: { incoming_damage: -0.006 } },
        ],
        scale: { formula: "intervals(duration, 2, 10)" },
      },
    ],
  },
  // The first variant whose condition holds wins; the last is the fallback.
  {
    id: "location-variant",
    grants: [
      {
        variants: [
          {
            when: { equipped: { item: "location-b" } },
            stats: { outgoing_damage: 0.05 },
          },
          { stats: { outgoing_damage: 0.02 } },
        ],
      },
    ],
  },
  {
    id: "per-source",
    stacking: "perSource",
    grants: [
      {
        when: { toggle: "artifactCall" },
        stats: { enemy_incoming_damage: 0.207 },
      },
    ],
  },
  { id: "excluded", grants: [{ stats: { outgoing_damage: 0.09 } }] },
  {
    id: "excluder",
    excludes: ["excluded"],
    grants: [{ stats: { outgoing_damage: 0.035 } }],
  },
];

const items: Item[] = [
  item("head", "gear_head", { bonuses: ["single"] }),
  item("boots", "gear_boots", { bonuses: ["single"] }),
  item("gem-ring", "gear_ring", { bonuses: ["gem-gated"] }),
  item("tagged-gem", "gem", { tags: ["gem"] }),
  item("bracers", "gear_arms", { bonuses: ["long-fight"] }),
  item("interval-ring", "gear_ring", { bonuses: ["per-interval"] }),
  item("tier-insignia", "insignia_bonus", { bonuses: ["tiered"] }),
  item("halving-insignia", "insignia_bonus", {
    bonuses: ["halving"],
    maxCopies: 3,
  }),
  item("set-mainhand", "gear_mainhand", {
    bonuses: ["set"],
    allowedClass: ["warlock"],
  }),
  item("set-offhand", "gear_offhand", { bonuses: ["set"] }),
  item("location-a", "location"),
  item("location-b", "location"),
  item("location-ring", "gear_ring", { bonuses: ["location-variant"] }),
  item("call", "artifact_call", { bonuses: ["per-source"] }),
  item("excluded-boots", "gear_boots", { bonuses: ["excluded"] }),
  item("excluder-shirt", "gear_shirt", { bonuses: ["excluder"] }),
  item("ca-mod", "mod", {
    dynamicStats: [{ stat: "ca", min: 600, max: 3600, default: 600 }],
  }),
];

const semanticsDb = testDb(
  testSchema([
    "strike_p",
    "ca_p",
    "ca",
    "mana_regen",
    "defense",
    "movement",
    "outgoing_damage",
    "overall_healing",
    "incoming_damage",
    "enemy_incoming_damage",
  ]),
  items,
  bonuses,
  [
    picker("gear.head", "gear_head"),
    picker("gear.boots", "gear_boots"),
    picker("gear.arms", "gear_arms"),
    picker("gear.ring1", "gear_ring"),
    picker("gear.mainhand", "gear_mainhand"),
    picker("gear.offhand", "gear_offhand"),
    picker("gear.shirt", "gear_shirt"),
    picker("gear.mod", "mod"),
    picker("gems.gem1", "gem"),
    picker("gems.gem2", "gem"),
    picker("gems.gem3", "gem"),
    picker("insignia.bonus1", "insignia_bonus"),
    picker("insignia.bonus2", "insignia_bonus"),
    picker("insignia.bonus3", "insignia_bonus"),
    picker("insignia.bonus4", "insignia_bonus"),
    picker("options.location", "location"),
    picker("artifactCall.call1", "artifact_call"),
    picker("artifactCall.call2", "artifact_call"),
  ],
);

function runBuild(
  choices: Record<string, string>,
  context: TestBuildParts["context"] = {},
  values: Build["values"] = {},
) {
  return engine.resolveBuild(
    semanticsDb,
    testBuild({ choices, context, values }, BASE_CONTEXT),
  );
}

describe("bonus model semantics", () => {
  it("a shared bonus applies once at one occurrence, and still once at two", () => {
    const one = runBuild({ "gear.head": "head" });
    const two = runBuild({ "gear.head": "head", "gear.boots": "boots" });
    expect(statOf(one, "single", "strike_p")).toBeCloseTo(0.09, 9);
    expect(statOf(two, "single", "strike_p")).toBeCloseTo(0.09, 9);
    expect(bonusOf(two, "single")!.stacks).toBe(1);
    expect(two.stages.sums.strike_p - one.stages.sums.strike_p).toBeCloseTo(
      0,
      9,
    );
  });

  it("a tag-gated bonus survives three qualifying gems", () => {
    // Counting each extra gem as a new occurrence once made the bonus vanish at three.
    const ring = { "gear.ring1": "gem-ring" };
    const none = runBuild(ring);
    const one = runBuild({ ...ring, "gems.gem1": "tagged-gem" });
    const three = runBuild({
      ...ring,
      "gems.gem1": "tagged-gem",
      "gems.gem2": "tagged-gem",
      "gems.gem3": "tagged-gem",
    });
    expect(isActive(none, "gem-gated")).toBe(false);
    expect(statOf(one, "gem-gated", "ca_p")).toBeCloseTo(0.03, 9);
    expect(statOf(three, "gem-gated", "ca_p")).toBeCloseTo(0.03, 9);
  });

  it("a duration threshold is inclusive", () => {
    const at = (duration: number) =>
      runBuild({ "gear.arms": "bracers" }, { duration });
    expect(statOf(at(9), "long-fight", "mana_regen")).toBeUndefined();
    expect(statOf(at(10), "long-fight", "mana_regen")).toBeCloseTo(0.1, 9);
    expect(statOf(at(85), "long-fight", "mana_regen")).toBeCloseTo(0.1, 9);
  });

  it("duration scaling counts full intervals, up to the cap", () => {
    const at = (duration: number) =>
      statOf(
        runBuild({ "gear.ring1": "interval-ring" }, { duration }),
        "per-interval",
        "strike_p",
      );
    expect(at(4)).toBeUndefined();
    expect(at(5)).toBeCloseTo(0.011, 9);
    expect(at(29)).toBeCloseTo(0.055, 9);
    expect(at(30)).toBeCloseTo(0.066, 9);
    expect(at(85)).toBeCloseTo(0.066, 9);
  });

  it("a toggle gates its bonus", () => {
    const ring = { "gear.ring1": "interval-ring" };
    expect(isActive(runBuild(ring), "per-interval")).toBe(true);
    expect(
      isActive(runBuild(ring, { toggles: { combat: false } }), "per-interval"),
    ).toBe(false);
  });

  it("occurrence tiers are absolute and mutually exclusive, not cumulative", () => {
    const one = runBuild({ "insignia.bonus1": "tier-insignia" });
    const two = runBuild({
      "insignia.bonus1": "tier-insignia",
      "insignia.bonus2": "tier-insignia",
    });
    expect(statOf(one, "tiered", "defense")).toBeCloseTo(2500, 9);
    expect(bonusOf(one, "tiered")!.chose).toBe("tier:1");
    expect(statOf(two, "tiered", "defense")).toBeCloseTo(3000, 9);
    expect(bonusOf(two, "tiered")!.chose).toBe("tier:2");
  });

  it("halving stacks scale geometrically, capped at three", () => {
    const slots = [
      "insignia.bonus1",
      "insignia.bonus2",
      "insignia.bonus3",
      "insignia.bonus4",
    ];
    const withCopies = (n: number) =>
      statOf(
        runBuild(
          Object.fromEntries(
            slots.slice(0, n).map((slot) => [slot, "halving-insignia"]),
          ),
        ),
        "halving",
        "movement",
      );
    expect(withCopies(1)).toBeCloseTo(0.1, 9);
    expect(withCopies(2)).toBeCloseTo(0.15, 9);
    expect(withCopies(3)).toBeCloseTo(0.175, 9);
    expect(withCopies(4)).toBeCloseTo(0.175, 9);
  });

  const SET = {
    "gear.mainhand": "set-mainhand",
    "gear.offhand": "set-offhand",
  };

  it("role variants select exactly one payload, summed with the bonus's other grants", () => {
    // The flat grant applies for every role; only the matching role's variant adds to it.
    const dps = runBuild(SET, { role: "dps" });
    const healer = runBuild(SET, { role: "healer" });
    const tank = runBuild(SET, { role: "tank" });
    expect(statOf(dps, "set", "outgoing_damage")).toBeCloseTo(0.06, 9);
    expect(statOf(dps, "set", "overall_healing")).toBeCloseTo(0.05, 9);
    expect(statOf(healer, "set", "overall_healing")).toBeCloseTo(
      0.05 + 0.06,
      9,
    );
    expect(statOf(tank, "set", "incoming_damage")).toBeCloseTo(-0.05 - 0.06, 9);
    expect(statOf(healer, "set", "outgoing_damage")).toBeUndefined();
  });

  it("a variant grant under an unmet gate still explains every variant branch", () => {
    // Against several enemies the grant is inactive, and the hover card still needs each
    // variant's own conditions to label its rungs.
    const result = runBuild(SET, { role: "dps", enemies: 3 });
    const gated = bonusOf(result, "set")!.grants!.find(
      (grant) => grant.raw.variants && !grant.active && !grant.gate.ok,
    )!;
    expect(gated.chose).toBeNull();
    expect(gated.variantBranches?.map((b) => b.leaves[0]?.label)).toEqual([
      "Role: dps",
      "Role: healer",
      "Role: tank",
    ]);
    expect(gated.variantBranches?.map((b) => b.ok)).toEqual([
      true,
      false,
      false,
    ]);
  });

  it("a bonus needing two occurrences needs both items equipped", () => {
    expect(isActive(runBuild({ "gear.mainhand": "set-mainhand" }), "set")).toBe(
      false,
    );
    expect(isActive(runBuild(SET), "set")).toBe(true);
  });

  it("an item_picker choice is read through an `equipped` condition", () => {
    expect(statOf(runBuild(SET), "set", "movement")).toBeUndefined();
    expect(
      statOf(
        runBuild({ ...SET, "options.location": "location-a" }),
        "set",
        "movement",
      ),
    ).toBeCloseTo(0.12, 9);

    const ring = { "gear.ring1": "location-ring" };
    expect(
      statOf(runBuild(ring), "location-variant", "outgoing_damage"),
    ).toBeCloseTo(0.02, 9);
    expect(
      statOf(
        runBuild({ ...ring, "options.location": "location-b" }),
        "location-variant",
        "outgoing_damage",
      ),
    ).toBeCloseTo(0.05, 9);
  });

  it("perSource stacking multiplies by contributing slots", () => {
    const one = runBuild({ "artifactCall.call1": "call" });
    const two = runBuild({
      "artifactCall.call1": "call",
      "artifactCall.call2": "call",
    });
    expect(bonusOf(one, "per-source")!.stacks).toBe(1);
    expect(bonusOf(two, "per-source")!.stacks).toBe(2);
    const stat = "enemy_incoming_damage";
    // `stats` stays the per-stack payload, `appliedStats` doubles.
    expect(statOf(two, "per-source", stat)).toBeCloseTo(
      statOf(one, "per-source", stat)!,
      9,
    );
    const oneApplied = appliedStatOf(one, "per-source", stat)!;
    expect(appliedStatOf(two, "per-source", stat)).toBeCloseTo(2 * oneApplied);
    // And the doubled value reaches the pipeline.
    expect(two.stages.sums.enemy_incoming_damage).toBeCloseTo(2 * oneApplied);
  });

  it("exclusion suppresses the excluded bonus", () => {
    const alone = runBuild({ "gear.boots": "excluded-boots" });
    const suppressed = runBuild({
      "gear.boots": "excluded-boots",
      "gear.shirt": "excluder-shirt",
    });
    expect(isActive(alone, "excluded")).toBe(true);
    expect(isActive(suppressed, "excluded")).toBe(false);
    expect(bonusOf(suppressed, "excluded")?.excluded).toBe(true);
  });

  it("resolution does not depend on slot order", () => {
    const a = runBuild({ "gear.head": "head", "gear.boots": "boots" });
    const b = runBuild({ "gear.boots": "boots", "gear.head": "head" });
    expect(a.stages.totals.strike_p).toBeCloseTo(b.stages.totals.strike_p, 9);
  });

  it("dynamic stats use the typed value and warn when out of range", () => {
    // Clamping would silently rewrite the number the user typed.
    const dynamicCa = (result: ReturnType<typeof runBuild>) =>
      result.ledger.find(
        (entry) =>
          entry.kind === "dynamic" &&
          entry.slotId === "gear.mod" &&
          entry.stat === "ca",
      )?.value;
    const typed = (ca: number) =>
      runBuild({ "gear.mod": "ca-mod" }, {}, { "gear.mod": { stat: { ca } } });
    const inRange = typed(2000);
    const over = typed(5800);
    expect(dynamicCa(inRange)).toBeCloseTo(2000, 9);
    expect(
      inRange.errors.some((e: EngineError) => e.kind === "outOfRange"),
    ).toBe(false);
    expect(dynamicCa(over)).toBeCloseTo(5800, 9);
    expect(over.errors.some((e: EngineError) => e.kind === "outOfRange")).toBe(
      true,
    );
  });

  it("maxCopies and class restrictions are reported", () => {
    const tooMany = runBuild({
      "insignia.bonus1": "halving-insignia",
      "insignia.bonus2": "halving-insignia",
      "insignia.bonus3": "halving-insignia",
      "insignia.bonus4": "halving-insignia",
    });
    expect(
      tooMany.errors.some((e: EngineError) => e.kind === "maxCopies"),
    ).toBe(true);
    const wrongClass = runBuild(
      { "gear.mainhand": "set-mainhand" },
      { class: "barbarian" },
    );
    expect(wrongClass.errors.some((e: EngineError) => e.kind === "class")).toBe(
      true,
    );
  });
});

// A point_assignment slot's count resolves exactly like N separate item_picker picks of the
// same item, with a bonus built to prove stacking scales with the count.
describe("point_assignment resolution", () => {
  const schema = testSchema(["power_p"]);

  const powerItem: Item = {
    id: "boon-power",
    name: "Boon Power",
    filter: "test_boon_tier",
    power_p: 0.01,
    maxCopies: 3,
    bonuses: ["boon-power-bonus"],
    inlineRepetition: { min: 0, max: 4, default: 0 },
  };
  const powerBonus: Bonus = {
    id: "boon-power-bonus",
    stacking: "perSource",
    grants: [{ stats: { power_p: 0.02 } }],
  };
  const restrictedItem: Item = {
    id: "boon-restricted",
    name: "Boon Restricted",
    filter: "test_boon_tier",
    allowedClass: ["fighter"],
    inlineRepetition: { min: 0, max: 2, default: 0 },
  };

  const pointSlot: PointAssignmentSlot = {
    id: "boons.tier1",
    label: "Boons (Tier 1)",
    section: "boons",
    type: "point_assignment",
    filter: "test_boon_tier",
  };
  const slotsData: SlotsData = {
    sections: [{ id: "boons", label: "Boons", slotIds: [] }],
    slots: [pointSlot],
  };
  const testDb = db.build(
    [powerItem, restrictedItem],
    [powerBonus],
    schema,
    slotsData,
  );

  function buildWith(counts: Record<string, number>): Build {
    return {
      id: "b",
      name: "b",
      choices: {},
      values: {},
      assignments: { "boons.tier1": counts },
      context: BASE_CONTEXT,
      compare: { id: "", highlight: false, onlyDiff: false, statLines: false },
    } as unknown as Build;
  }

  it("a count of 0 (the default) contributes nothing", () => {
    const result = engine.resolveBuild(testDb, buildWith({}));
    expect(
      result.bonuses.find((b) => b.id === "boon-power-bonus")?.active,
    ).toBeFalsy();
    expect(result.stages.sums.power_p).toBe(0);
  });

  it("N points bump stacking the same way N separate item_picker picks would", () => {
    const one = engine.resolveBuild(testDb, buildWith({ "boon-power": 1 }));
    const two = engine.resolveBuild(testDb, buildWith({ "boon-power": 2 }));
    expect(one.bonuses.find((b) => b.id === "boon-power-bonus")?.stacks).toBe(
      1,
    );
    expect(two.bonuses.find((b) => b.id === "boon-power-bonus")?.stacks).toBe(
      2,
    );
  });

  it("the item's own stat scales by count, on top of the stacked bonus", () => {
    const two = engine.resolveBuild(testDb, buildWith({ "boon-power": 2 }));
    // item: 0.01 x 2 points, bonus: 0.02 per stack x 2 stacks
    expect(two.stages.sums.power_p).toBeCloseTo(2 * 0.01 + 2 * 0.02, 9);
  });

  it("a count over the item's maxCopies is flagged, same as too many picks", () => {
    const result = engine.resolveBuild(testDb, buildWith({ "boon-power": 4 }));
    expect(result.errors.some((e) => e.kind === "maxCopies")).toBe(true);
  });

  it("a count outside the row's min/max is flagged as outOfRange, not clamped", () => {
    // The UI's own -/+ buttons clamp, but a hand-edited or imported build can carry one.
    const result = engine.resolveBuild(testDb, buildWith({ "boon-power": 6 }));
    expect(result.errors.some((e) => e.kind === "outOfRange")).toBe(true);
  });

  it("a class-restricted item flags a class error the same way a picked item would", () => {
    const result = engine.resolveBuild(
      testDb,
      buildWith({ "boon-restricted": 1 }),
    );
    expect(result.errors.some((e) => e.kind === "class")).toBe(true);
  });
});

// A point_assignment item at 0 points is still walked as an anchor, but that must not resolve
// it for real: a proc left on must not activate the bonus. The bonus is a proc input gating
// tiers on the boon's own rank.
describe("a point_assignment item's bonus stays inactive while the item itself is at 0 points", () => {
  const schema = testSchema(["power_p"]);

  const statsBonus: Bonus = {
    id: "boon-master-stats",
    inputs: { active: { type: "boolean", default: false, label: "Proc" } },
    grants: [
      {
        when: { input: { key: "active", is: true } },
        tiers: [
          { atLeast: 1, stats: { power_p: 0.1 } },
          { atLeast: 3, stats: { power_p: 0.3 } },
        ],
      },
    ],
  };
  const masterItem: Item = {
    id: "boon-master",
    name: "Boon Master",
    filter: "test_boon_master",
    bonuses: ["boon-master-stats"],
    inlineRepetition: { min: 0, max: 3, default: 0 },
  };

  const pointSlot: PointAssignmentSlot = {
    id: "boons.master",
    label: "Master boons",
    section: "boons",
    type: "point_assignment",
    filter: "test_boon_master",
  };
  const slotsData: SlotsData = {
    sections: [{ id: "boons", label: "Boons", slotIds: [] }],
    slots: [pointSlot],
  };
  const testDb = db.build([masterItem], [statsBonus], schema, slotsData);

  const procOn = { "boon-master-stats": { input: { active: true } } };

  function buildWith(
    counts: Record<string, number>,
    bonusValues: Build["bonusValues"] = {},
  ): Build {
    return {
      id: "b",
      name: "b",
      choices: {},
      values: {},
      assignments: { "boons.master": counts },
      bonusValues,
      context: BASE_CONTEXT,
      compare: { id: "", highlight: false, onlyDiff: false, statLines: false },
    } as unknown as Build;
  }

  it("a checked proc doesn't activate the stats bonus while the item has 0 points", () => {
    const result = engine.resolveBuild(testDb, buildWith({}, procOn));
    const entry = result.bonuses.find((b) => b.id === "boon-master-stats");
    expect(entry?.active).toBe(false);
    expect(result.stages.sums.power_p).toBe(0);
  });

  it("still reaches the resolved list, inactive with no sources, rather than vanishing", () => {
    const result = engine.resolveBuild(testDb, buildWith({}, procOn));
    const entry = result.bonuses.find((b) => b.id === "boon-master-stats");
    expect(entry).toBeDefined();
    expect(entry?.sources).toEqual([]);
  });

  it("once real points are spent, the checked proc picks the tier for the rank", () => {
    const one = engine.resolveBuild(
      testDb,
      buildWith({ "boon-master": 1 }, procOn),
    );
    expect(one.stages.sums.power_p).toBeCloseTo(0.1, 9);
    const three = engine.resolveBuild(
      testDb,
      buildWith({ "boon-master": 3 }, procOn),
    );
    expect(three.stages.sums.power_p).toBeCloseTo(0.3, 9);
  });

  it("an unchecked proc keeps the bonus off at any rank", () => {
    const result = engine.resolveBuild(testDb, buildWith({ "boon-master": 3 }));
    const entry = result.bonuses.find((b) => b.id === "boon-master-stats");
    expect(entry?.active).toBe(false);
    expect(entry?.gate?.unmet).toHaveLength(1);
  });
});

// A bonus whose only source is a pick repeated 0 times still resolves, inactive, through a
// sources-less anchor group rather than vanishing from `result.bonuses`. The anchor must never
// count as a real source wherever stacking or attribution reads `sources`.
describe("a bonus reachable only through a currently-zero repetition count", () => {
  const schema = testSchema(["power_p"]);

  const stackingBonus: Bonus = {
    id: "stacking-bonus",
    stacking: "perSource",
    grants: [
      {
        when: { bonusOccurrences: { bonus: "stacking-bonus", atLeast: 1 } },
        stats: { power_p: 0.02 },
      },
    ],
  };
  const dialItem: Item = {
    id: "dial-item",
    name: "Dial Item",
    filter: "test_slot",
    bonuses: ["stacking-bonus"],
    inlineRepetition: { min: 0, max: 3, default: 0 },
  };
  const otherDialItem: Item = {
    id: "other-dial-item",
    name: "Other Dial Item",
    filter: "test_slot",
    bonuses: ["stacking-bonus"],
    inlineRepetition: { min: 0, max: 3, default: 0 },
  };

  const slotsData: SlotsData = {
    sections: [{ id: "test", label: "Test", slotIds: [] }],
    slots: [
      {
        id: "slot1",
        label: "Slot 1",
        section: "test",
        type: "item_picker",
        filter: "test_slot",
      },
      {
        id: "slot2",
        label: "Slot 2",
        section: "test",
        type: "item_picker",
        filter: "test_slot",
      },
    ],
  };
  const testDb = db.build(
    [dialItem, otherDialItem],
    [stackingBonus],
    schema,
    slotsData,
  );

  function buildWith(
    choices: Record<string, string>,
    assignments: Record<string, Record<string, number>> = {},
  ): Build {
    return {
      id: "b",
      name: "b",
      choices,
      values: {},
      assignments,
      context: BASE_CONTEXT,
      compare: { id: "", highlight: false, onlyDiff: false, statLines: false },
    } as unknown as Build;
  }

  it("the only equipped item's dial at 0 still resolves the bonus, inactive with no sources", () => {
    const result = engine.resolveBuild(
      testDb,
      buildWith({ slot1: "dial-item" }),
    );
    const entry = result.bonuses.find((b) => b.id === "stacking-bonus");
    expect(entry?.active).toBe(false);
    expect(entry?.sources).toEqual([]);
    expect(entry?.stacks).toBe(0);
  });

  it("a sibling item's dial at 0 doesn't inflate perSource stacking for the real contributor", () => {
    const result = engine.resolveBuild(
      testDb,
      buildWith(
        { slot1: "dial-item", slot2: "other-dial-item" },
        { slot1: { "dial-item": 2 } },
      ),
    );
    const entry = result.bonuses.find((b) => b.id === "stacking-bonus");
    expect(entry?.active).toBe(true);
    // Only dial-item's 2 real occurrences count. other-dial-item at 0 adds nothing to stacks,
    // sources or the applied stats, even though it's equipped.
    expect(entry?.stacks).toBe(2);
    expect(entry?.sources).toEqual([
      { name: "Dial Item", slotId: "slot1", itemId: "dial-item" },
      { name: "Dial Item", slotId: "slot1", itemId: "dial-item" },
    ]);
    expect(entry?.appliedStats?.power_p).toBeCloseTo(2 * 0.02, 9);
  });

  it("sources carry each contributing slot and item, in build order", () => {
    const result = engine.resolveBuild(
      testDb,
      buildWith(
        { slot2: "other-dial-item", slot1: "dial-item" },
        {
          slot1: { "dial-item": 1 },
          slot2: { "other-dial-item": 1 },
        },
      ),
    );
    const entry = result.bonuses.find((b) => b.id === "stacking-bonus");
    expect(entry?.stacks).toBe(2);
    expect(entry?.sources).toEqual([
      { name: "Dial Item", slotId: "slot1", itemId: "dial-item" },
      { name: "Other Dial Item", slotId: "slot2", itemId: "other-dial-item" },
    ]);
  });

  it("both equipped items' dials at 0 still resolves one inactive entry, not two", () => {
    const result = engine.resolveBuild(
      testDb,
      buildWith({ slot1: "dial-item", slot2: "other-dial-item" }),
    );
    const entries = result.bonuses.filter((b) => b.id === "stacking-bonus");
    expect(entries).toHaveLength(1);
    expect(entries[0].active).toBe(false);
    expect(entries[0].sources).toEqual([]);
  });
});

// This grant has no `when` at all, so nothing but the bonus itself turns it off at 0 stacks.
// The grant must read inactive then, so the preview shows what one stack would give instead
// of the payload times 0 stacks.
describe("an unconditional stacking grant reachable only through a currently-zero count", () => {
  const schema = testSchema(["power_p"]);

  const unconditionalStackingBonus: Bonus = {
    id: "unconditional-stacking-bonus",
    stacking: "perSource",
    maxStacks: 5,
    grants: [{ stats: { power_p: 0.036 } }],
  };
  const stackItem: Item = {
    id: "stack-item",
    name: "Stack Item",
    filter: "test_slot",
    bonuses: ["unconditional-stacking-bonus"],
    inlineRepetition: { min: 0, max: 5, default: 5 },
  };

  const slotsData: SlotsData = {
    sections: [{ id: "test", label: "Test", slotIds: [] }],
    slots: [
      {
        id: "slot1",
        label: "Slot 1",
        section: "test",
        type: "item_picker",
        filter: "test_slot",
      },
    ],
  };
  const testDb = db.build(
    [stackItem],
    [unconditionalStackingBonus],
    schema,
    slotsData,
  );

  function buildWith(
    assignments: Record<string, Record<string, number>>,
  ): Build {
    return {
      id: "b",
      name: "b",
      choices: { slot1: "stack-item" },
      values: {},
      assignments,
      context: BASE_CONTEXT,
      compare: { id: "", highlight: false, onlyDiff: false, statLines: false },
    } as unknown as Build;
  }

  it("at 0 stacks, both the bonus and its own (only) grant read inactive", () => {
    const result = engine.resolveBuild(
      testDb,
      buildWith({ slot1: { "stack-item": 0 } }),
    );
    const entry = result.bonuses.find(
      (b) => b.id === "unconditional-stacking-bonus",
    );
    expect(entry?.active).toBe(false);
    expect(entry?.grants?.[0]?.active).toBe(false);
    expect(entry?.grants?.[0]?.stats).toBeNull();
  });

  it("at 0 stacks, the preview is what one stack would give, not zero", () => {
    const result = engine.resolveBuild(
      testDb,
      buildWith({ slot1: { "stack-item": 0 } }),
    );
    const entry = result.bonuses.find(
      (b) => b.id === "unconditional-stacking-bonus",
    );
    expect(entry?.previewStats?.power_p).toBeCloseTo(0.036, 9);
  });

  it("at 5 stacks, the bonus and its grant are both active with the totaled stats", () => {
    const result = engine.resolveBuild(testDb, buildWith({}));
    const entry = result.bonuses.find(
      (b) => b.id === "unconditional-stacking-bonus",
    );
    expect(entry?.active).toBe(true);
    expect(entry?.grants?.[0]?.active).toBe(true);
    expect(entry?.stacks).toBe(5);
    expect(entry?.appliedStats?.power_p).toBeCloseTo(5 * 0.036, 9);
  });
});

describe("race restrictions ride on the generic equipped condition", () => {
  const schema = testSchema(["power_p", "hit_points"]);

  // Race is an item_picker slot, and a race-restricted item expresses its restriction like any
  // other conditional problem: a `hideFromPicker` grant gated on the generic `equipped` leaf
  // against the race item's own id.
  it("a race-restricted item flags a bonusRule problem via the generic equipped condition", () => {
    const halfOrcRaceItem: Item = {
      id: "race-test-half-orc",
      name: "Race: Half-Orc (test)",
      filter: "test_race",
    };
    const elfRaceItem: Item = {
      id: "race-test-elf",
      name: "Race: Elf (test)",
      filter: "test_race",
    };
    const raceRestrictionBonus: Bonus = {
      id: "race-restriction-check",
      grants: [
        {
          when: { not: { equipped: { item: "race-test-half-orc" } } },
          problem: {
            severity: "error",
            message: "Trinket requires Half-Orc",
            hideFromPicker: true,
          },
        },
      ],
    };
    const raceRestrictedItem: Item = {
      id: "trinket-race-restricted",
      name: "Trinket: Race Restricted",
      filter: "test_trinket",
      bonuses: ["race-restriction-check"],
    };
    const raceSlot: ItemPickerSlot = {
      id: "raceLeveling.race",
      label: "Race",
      section: "raceLeveling",
      type: "item_picker",
      filter: "test_race",
    };
    const trinketSlot: ItemPickerSlot = {
      id: "gear.trinket",
      label: "Trinket",
      section: "gear",
      type: "item_picker",
      filter: "test_trinket",
    };
    const raceRestrictedDb = db.build(
      [halfOrcRaceItem, elfRaceItem, raceRestrictedItem],
      [raceRestrictionBonus],
      schema,
      {
        sections: [
          { id: "raceLeveling", label: "Race", slotIds: [] },
          { id: "gear", label: "Gear", slotIds: [] },
        ],
        slots: [raceSlot, trinketSlot],
      },
    );

    const matchingRace = engine.resolveBuild(raceRestrictedDb, {
      id: "b",
      name: "b",
      choices: {
        "raceLeveling.race": halfOrcRaceItem.id,
        "gear.trinket": raceRestrictedItem.id,
      },
      values: {},
      assignments: {},
      context: BASE_CONTEXT,
      compare: { id: "", highlight: false, onlyDiff: false, statLines: false },
    } as unknown as Build);
    expect(matchingRace.errors.some((e) => e.kind === "bonusRule")).toBe(false);

    const wrongRace = engine.resolveBuild(raceRestrictedDb, {
      id: "b",
      name: "b",
      choices: {
        "raceLeveling.race": elfRaceItem.id,
        "gear.trinket": raceRestrictedItem.id,
      },
      values: {},
      assignments: {},
      context: BASE_CONTEXT,
      compare: { id: "", highlight: false, onlyDiff: false, statLines: false },
    } as unknown as Build);
    expect(wrongRace.errors.some((e) => e.kind === "bonusRule")).toBe(true);
  });
});
// Both slot kinds (item_picker and point_assignment): an item-level mismatch check and a
// point-threshold check.
describe("problem grants (bonus-authored errors/warnings)", () => {
  const schema = testSchema(["power_p"]);

  // item_picker case: an error grant gated on the build's own class, standing in for "the
  // chosen race bonus doesn't match the race picked".
  const mismatchBonus: Bonus = {
    id: "class-mismatch-check",
    grants: [
      {
        when: { not: { class: ["fighter"] } },
        problem: { severity: "error", message: "This bonus needs Fighter" },
      },
    ],
  };
  const mismatchItem: Item = {
    id: "fighter-bonus-item",
    name: "Fighter Bonus Item",
    filter: "test_slot",
    bonuses: ["class-mismatch-check"],
  };

  // Same shape as class-mismatch-check, but its problem grant carries its own `label`: the
  // sidebar summary should prefer this over the triggering slot's name.
  const labeledMismatchBonus: Bonus = {
    id: "class-mismatch-check-labeled",
    grants: [
      {
        when: { not: { class: ["fighter"] } },
        problem: {
          severity: "error",
          message: "This bonus needs Fighter",
          label: "Class Check",
        },
      },
    ],
  };
  const labeledMismatchItem: Item = {
    id: "fighter-bonus-item-labeled",
    name: "Fighter Bonus Item (Labeled)",
    filter: "test_slot",
    bonuses: ["class-mismatch-check-labeled"],
  };
  // A `hideFromPicker` problem grant tells a consumer (ItemPicker.vue) to drop
  // the item from its dropdown while the condition holds, on top of the usual sidebar/inline
  // warning. The engine itself doesn't act on the flag; it just has to carry it through intact.
  const hideFromPickerBonus: Bonus = {
    id: "hide-from-picker-check",
    grants: [
      {
        when: { class: "rogue" },
        problem: {
          severity: "warning",
          message: "Not recommended for Rogue",
          hideFromPicker: true,
        },
      },
    ],
  };
  const hideFromPickerItem: Item = {
    id: "hide-from-picker-item",
    name: "Hide From Picker Item",
    filter: "test_slot",
    bonuses: ["hide-from-picker-check"],
  };
  const pickerSlot: ItemPickerSlot = {
    id: "gear.test",
    label: "Test Gear",
    section: "gear",
    type: "item_picker",
    filter: "test_slot",
  };

  // point_assignment case: a warning gated on a tag threshold, "warning if a tier 2 boon is
  // picked but fewer than 10 points are spent on tier 1 boons".
  const tier1Item: Item = {
    id: "boon-tier1",
    name: "Boon Tier 1",
    filter: "test_boon",
    tags: ["tier1"],
    inlineRepetition: { min: 0, max: 10, default: 0 },
  };
  const tier2Bonus: Bonus = {
    id: "tier2-requires-tier1",
    grants: [
      {
        when: { not: { equipped: { tag: "tier1", atLeast: 10 } } },
        problem: {
          severity: "warning",
          message: "Spend at least 10 points on tier 1 boons first",
        },
      },
    ],
  };
  const tier2Item: Item = {
    id: "boon-tier2",
    name: "Boon Tier 2",
    filter: "test_boon",
    bonuses: ["tier2-requires-tier1"],
    inlineRepetition: { min: 0, max: 4, default: 0 },
  };
  const boonSlot: PointAssignmentSlot = {
    id: "boons.test",
    label: "Boons",
    section: "boons",
    type: "point_assignment",
    filter: "test_boon",
  };

  const slotsData: SlotsData = {
    sections: [
      { id: "gear", label: "Gear", slotIds: [] },
      { id: "boons", label: "Boons", slotIds: [] },
    ],
    slots: [pickerSlot, boonSlot],
  };
  const testDb = db.build(
    [
      mismatchItem,
      labeledMismatchItem,
      tier1Item,
      tier2Item,
      hideFromPickerItem,
    ],
    [mismatchBonus, labeledMismatchBonus, tier2Bonus, hideFromPickerBonus],
    schema,
    slotsData,
  );

  function buildWith(
    choices: Record<string, string>,
    assignments: Record<string, Record<string, number>> = {},
    contextOverrides: Partial<BuildContext> = {},
  ): Build {
    return {
      id: "b",
      name: "b",
      choices,
      values: {},
      assignments,
      context: { ...BASE_CONTEXT, ...contextOverrides },
      compare: { id: "", highlight: false, onlyDiff: false, statLines: false },
    } as unknown as Build;
  }

  it("reports an error when the grant's condition matches, attributed to the instancing slot", () => {
    const result = engine.resolveBuild(
      testDb,
      buildWith({ "gear.test": "fighter-bonus-item" }, {}, { class: "rogue" }),
    );
    const found = result.errors.find((e) => e.kind === "bonusRule");
    expect(found).toBeDefined();
    expect(found?.severity).toBe("error");
    expect(found?.slotId).toBe("gear.test");
    expect(found?.message).toBe("This bonus needs Fighter");
    expect(found?.label).toBeUndefined();
  });

  it("carries the problem grant's own label through, when it has one", () => {
    const result = engine.resolveBuild(
      testDb,
      buildWith(
        { "gear.test": "fighter-bonus-item-labeled" },
        {},
        { class: "rogue" },
      ),
    );
    const found = result.errors.find((e) => e.kind === "bonusRule");
    expect(found?.label).toBe("Class Check");
  });

  it("reports nothing when the condition doesn't match", () => {
    const result = engine.resolveBuild(
      testDb,
      buildWith(
        { "gear.test": "fighter-bonus-item" },
        {},
        { class: "fighter" },
      ),
    );
    expect(result.errors.some((e) => e.kind === "bonusRule")).toBe(false);
  });

  it("a problem grant contributes no stats", () => {
    const result = engine.resolveBuild(
      testDb,
      buildWith({ "gear.test": "fighter-bonus-item" }, {}, { class: "rogue" }),
    );
    expect(result.stages.sums.power_p).toBe(0);
  });

  it("a point_assignment-driven warning fires below the tag threshold", () => {
    const result = engine.resolveBuild(
      testDb,
      buildWith({}, { "boons.test": { "boon-tier1": 5, "boon-tier2": 1 } }),
    );
    const found = result.errors.find((e) => e.kind === "bonusRule");
    expect(found).toBeDefined();
    expect(found?.severity).toBe("warning");
    expect(found?.slotId).toBe("boons.test");
  });

  it("the same warning clears once the threshold is met", () => {
    const result = engine.resolveBuild(
      testDb,
      buildWith({}, { "boons.test": { "boon-tier1": 10, "boon-tier2": 1 } }),
    );
    expect(result.errors.some((e) => e.kind === "bonusRule")).toBe(false);
  });

  // `hideFromPicker` is only meaningful to a UI consumer (ItemPicker.vue). The engine's job
  // is just to carry the flag through `EvaluatedBonus.problems` intact.
  it("threads a problem grant's hideFromPicker flag through to the resolved bonus", () => {
    const result = engine.resolveBuild(
      testDb,
      buildWith(
        { "gear.test": "hide-from-picker-item" },
        {},
        { class: "rogue" },
      ),
    );
    const evaluated = result.bonuses.find(
      (b) => b.bonusId === "hide-from-picker-check",
    );
    expect(evaluated?.active).toBe(true);
    expect(evaluated?.problems[0]?.hideFromPicker).toBe(true);
  });

  it("the resolved bonus is inactive, and hideFromPicker moot, when the condition doesn't match", () => {
    const result = engine.resolveBuild(
      testDb,
      buildWith(
        { "gear.test": "hide-from-picker-item" },
        {},
        { class: "fighter" },
      ),
    );
    const evaluated = result.bonuses.find(
      (b) => b.bonusId === "hide-from-picker-check",
    );
    expect(evaluated?.active).toBe(false);
  });

  // Displays that list "bonuses" (ItemCard.vue's hover card, BonusInspector.vue's sidebar
  // table) should leave a problem-only bonus out entirely: it would otherwise read as an
  // inactive (or, worse, active-looking) bonus that never actually grants anything.
  describe("isHiddenBonus", () => {
    it("hides a bonus whose only grant reports a problem", () => {
      expect(isHiddenBonus(mismatchBonus)).toBe(true);
      expect(isHiddenBonus(tier2Bonus)).toBe(true);
    });

    it("does not hide a plain stats-only bonus", () => {
      const statsOnly: Bonus = {
        id: "stats-only",
        grants: [{ stats: { power_p: 1 } }],
      };
      expect(isHiddenBonus(statsOnly)).toBe(false);
    });

    it("does not hide a bonus that mixes a problem grant with a stats grant", () => {
      const mixed: Bonus = {
        id: "mixed",
        grants: [{ stats: { power_p: 1 } }, mismatchBonus.grants![0]],
      };
      expect(isHiddenBonus(mixed)).toBe(false);
    });

    it("does not hide a bonus with no grants", () => {
      expect(isHiddenBonus({ id: "empty" })).toBe(false);
    });
  });
});
