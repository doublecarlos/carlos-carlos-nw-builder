// Unit tests for the bonus model's semantics (plan Part 2).
//
// The golden fixture proves the engine reproduces the sheet.
// Each test names the behavior and, where relevant, the legacy bug it prevents.

import { describe, it, expect } from "vitest";
import * as db from "../../src/data/db";
import * as engine from "../../src/engine/engine";
import { isHiddenBonus } from "../../src/engine/bonus";
import { storedListRows } from "../../src/lib/item-picker-list";
import type {
  Build,
  BuildContext,
  Bonus,
  EvaluatedBonus,
  EngineError,
  Grant,
  ConditionWhen,
  Item,
  ItemPickerSlot,
  PointAssignmentSlot,
  Schema,
  SlotsData,
} from "../../src/types";

const built = db.fromData();

// A deliberately empty build: only what each test slots in is present, so nothing else can
// perturb the numbers.
const BASE_CONTEXT: BuildContext = {
  class: "warlock",
  role: "dps",
  duration: 60,
  enemies: 1,
  damageType: "magical",
  // The shipped maxima, matching what `defaultBuild` seeds -- an item scaled by bolster
  // should read here the way a real build reads it, not as if the collection were empty.
  magnitude: 100,
  m32Forte: false,
  mountBolster: 1.25,
  companionBolster: 1.2,
  forte: {},
  toggles: {
    combat: true,
    party: true,
    consumables: true,
    artifactCall: true,
  },
};

/** Every test below writes `choices` by item *name* -- far more readable than the ids that
 * actually key `build.choices` -- so this resolves each one against the real shipped data
 * before handing it to the engine. Throws on a typo'd name rather than silently resolving to
 * nothing, which a bad string in `choices` would otherwise do. */
function idOf(name: string): string {
  const item = built.items.find((i) => i.name === name);
  if (!item) throw new Error(`no shipped item named "${name}"`);
  return item.id;
}

/** Extended ResolvedBuild with test helpers. The engine doesn't create these;
 * `runBuild` adds them for convenience. */
type RunResult = ReturnType<typeof engine.resolveBuild> & {
  activeById: Map<string, EvaluatedBonus>;
  statOf: (id: string, stat: string) => number | undefined;
  appliedStatOf: (id: string, stat: string) => number | undefined;
};

function runBuild(
  choicesByName: Record<string, string>,
  contextOverrides: Partial<BuildContext> = {},
  values: Build["values"] = {},
): RunResult {
  const choices = Object.fromEntries(
    Object.entries(choicesByName).map(([slot, name]) => [slot, idOf(name)]),
  );
  const context: BuildContext = { ...BASE_CONTEXT, ...contextOverrides };
  if (contextOverrides.toggles) {
    context.toggles = { ...BASE_CONTEXT.toggles, ...contextOverrides.toggles };
  }
  // Deliberately minimal -- only choices/values/context are exercised by resolveBuild, so
  // this test fixture skips the rest of Build's fields (id/name/updated/compare).
  const result = engine.resolveBuild(built, {
    choices,
    values,
    context,
    listRows: storedListRows({
      choices,
      values,
      assignments: {},
      disabledSlots: {},
    }),
  } as unknown as Build) as RunResult;
  result.activeById = new Map(
    result.bonuses
      .filter((b: EvaluatedBonus) => b.active)
      .map((b: EvaluatedBonus) => [b.id, b]),
  );
  // Per-stack payload, as the inspector shows it next to the stack count.
  result.statOf = (id: string, stat: string) =>
    result.activeById.get(id)?.stats?.[stat];
  // What actually reaches the pipeline: payload × stacks.
  result.appliedStatOf = (id: string, stat: string) =>
    result.activeById.get(id)?.appliedStats?.[stat];
  return result;
}

describe("bonus model semantics", () => {
  // --- the bug that motivated the redesign -------------------------------------------
  it("Critical Breaker applies once at one occurrence, and still once at two", () => {
    // Legacy enumerated only `::1:2`, so wearing both copies computed `::2:2`, found no
    // payload row and silently granted nothing. Confirmed 2026-07-26 as a single-item bonus:
    // any number of copies grants it exactly once.
    const ID = "m33-critical-breaker";
    const one = runBuild({ "gear.head": "M33 Wintermarked Hunter Hood" });
    const two = runBuild({
      "gear.head": "M33 Wintermarked Hunter Hood",
      "gear.boots": "M33 Wintermarked Marcher Poleyns",
    });
    expect(one.statOf(ID, "strike_p")).toBeCloseTo(0.09, 9);
    expect(two.statOf(ID, "strike_p")).toBeCloseTo(0.09, 9);
    const twoBonus = two.activeById.get(ID)!;
    expect(twoBonus.stacks).toBe(1);
    expect(two.stages.sums.strike_p - one.stages.sums.strike_p).toBeCloseTo(
      0,
      9,
    );
  });

  it("A gem-gated ring bonus survives three qualifying gems", () => {
    // The `::1:3` bug: legacy enumerated only `::1:1` and `::1:2`, so a third distinct
    // qualifying gem made the bonus vanish entirely.
    const ID = "m33-frostsilver-coil-of-wrath-ca";
    const ring = { "gear.ring1": "M33 Frostsilver Coil of Wrath" };
    const none = runBuild(ring);
    const one = runBuild({
      ...ring,
      "enchantments.offense1": "Celestial Amethyst",
    });
    const three = runBuild({
      ...ring,
      "enchantments.offense1": "Celestial Amethyst",
      "enchantments.offense2": "Celestial Amethyst",
      "enchantments.defense1": "Celestial Amethyst",
    });
    expect(none.activeById.has(ID)).toBe(false);
    expect(one.statOf(ID, "ca_p")).toBeCloseTo(0.03, 9);
    expect(three.statOf(ID, "ca_p")).toBeCloseTo(0.03, 9);
  });

  // --- condition language --------------------------------------------------------------
  it("A duration threshold is inclusive", () => {
    const ID = "m33-relentless-reserves";
    const bracers = { "gear.arms": "M33 Wintermarked Skirmisher Bracers" };
    const at = (duration: number) =>
      runBuild(bracers, { class: "rogue", duration });

    expect(at(9).statOf(ID, "mana_regen")).toBeUndefined();
    expect(at(10).statOf(ID, "mana_regen")).toBeCloseTo(0.1, 9);
    expect(at(85).statOf(ID, "mana_regen")).toBeCloseTo(0.1, 9);
  });

  it("Duration scaling counts full intervals, up to the cap", () => {
    // 1.1% per full 5s, at most 6 stacks.
    const ID = "m32-critical-spiker";
    const ring = { "gear.ring1": "M32 Deathsilver Ring of Submission" };
    const at = (duration: number) =>
      runBuild(ring, { duration }).statOf(ID, "strike_p");

    expect(at(4)).toBeUndefined();
    expect(at(5)).toBeCloseTo(0.011, 9);
    expect(at(29)).toBeCloseTo(0.055, 9);
    expect(at(30)).toBeCloseTo(0.066, 9);
    expect(at(85)).toBeCloseTo(0.066, 9);
  });

  it("Toggles gate bonuses, and a two-toggle condition needs both", () => {
    const ID = "m32-critical-spiker";
    const ring = {
      "gear.ring1": "M32 Deathsilver Ring of Submission",
    };
    expect(runBuild(ring).activeById.has(ID)).toBe(true);
    expect(
      runBuild(ring, { toggles: { combat: false } }).activeById.has(ID),
    ).toBe(false);
  });

  // --- tiers, variants, stacking, exclusion ---------------------------------------------
  it("Occurrence tiers are absolute and mutually exclusive, not cumulative", () => {
    // Guardian's Spirit grants 2500 defense at one insignia and 3000 at two, not 5500.
    const ID = "guardian-s-spirit";
    const one = runBuild({ "insignia.bonus1": "Guardian's Spirit" });
    const two = runBuild({
      "insignia.bonus1": "Guardian's Spirit",
      "insignia.bonus2": "Guardian's Spirit",
    });
    expect(one.statOf(ID, "defense")).toBeCloseTo(2500, 9);
    expect(one.activeById.get(ID)!.chose).toBe("tier:1");
    expect(two.statOf(ID, "defense")).toBeCloseTo(3000, 9);
    expect(two.activeById.get(ID)!.chose).toBe("tier:2");
  });

  it("Halving insignia stacks scale geometrically, capped at three", () => {
    const ID = "gladiator-s-guile";
    const slots = [
      "insignia.bonus1",
      "insignia.bonus2",
      "insignia.bonus3",
      "insignia.bonus4",
    ];
    const withCopies = (n: number) =>
      runBuild(
        Object.fromEntries(
          slots.slice(0, n).map((slot) => [slot, "Gladiator's Guile"]),
        ),
      ).statOf(ID, "movement");
    expect(withCopies(1)).toBeCloseTo(0.1, 9);
    expect(withCopies(2)).toBeCloseTo(0.15, 9);
    expect(withCopies(3)).toBeCloseTo(0.175, 9);
    expect(withCopies(4)).toBeCloseTo(0.175, 9);
  });

  it("Role variants select exactly one payload, summed with the bonus's other grants", () => {
    // Grants restructuring (2026-07-27): this bonus is 4 grants now, not 4 separately-tracked
    // bonuses -- a flat 2-occurrence grant (-5% incoming, +5% healing) is active alongside the
    // role variant whenever 2 occurrences are equipped, so a role that is not the matching
    // variant still carries the flat grant's own stats, just not the other roles'
    // variant-specific ones.
    const ID = "m28-voidtouched-set";
    const gear = {
      "gear.mainhand": "M28 Voidtouched Pactblade",
      "gear.offhand": "M28 Voidtouched Tome",
    };
    const dps = runBuild(gear, { role: "dps" });
    const healer = runBuild(gear, { role: "healer" });
    const tank = runBuild(gear, { role: "tank" });
    expect(dps.statOf(ID, "outgoing_damage")).toBeCloseTo(0.06, 9);
    expect(dps.statOf(ID, "overall_healing")).toBeCloseTo(0.05, 9);
    expect(healer.statOf(ID, "overall_healing")).toBeCloseTo(0.05 + 0.06, 9);
    expect(tank.statOf(ID, "incoming_damage")).toBeCloseTo(-0.05 - 0.06, 9);
    // healer's variant doesn't grant outgoing_damage - verify its stats don't include it
    const healerBonus = healer.activeById.get(ID)!;
    expect(healerBonus.stats?.outgoing_damage).toBeUndefined();
  });

  it("A variant grant under an unmet gate still explains every variant branch", () => {
    // The set's role variants want a single enemy; against several the grant is inactive, and
    // the hover card still needs each variant's own conditions to label its rungs.
    const ID = "m28-voidtouched-set";
    const result = runBuild(
      {
        "gear.mainhand": "M28 Voidtouched Pactblade",
        "gear.offhand": "M28 Voidtouched Tome",
      },
      { role: "dps", enemies: 3 },
    );
    const gated = result.activeById
      .get(ID)!
      .grants!.find(
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

  it("A bonus needing two occurrences needs both items equipped", () => {
    const ID = "m28-voidtouched-set";
    expect(
      runBuild({ "gear.mainhand": "M28 Voidtouched Pactblade" }).activeById.has(
        ID,
      ),
    ).toBe(false);
    expect(
      runBuild({
        "gear.mainhand": "M28 Voidtouched Pactblade",
        "gear.offhand": "M28 Voidtouched Tome",
      }).activeById.has(ID),
    ).toBe(true);
  });

  it("Location is an item_picker choice, read via an `equipped` condition", () => {
    const gear = {
      "gear.mainhand": "M28 Voidtouched Pactblade",
      "gear.offhand": "M28 Voidtouched Tome",
    };
    const ID = "m28-voidtouched-set";
    expect(runBuild(gear).statOf(ID, "movement")).toBeUndefined();
    expect(
      runBuild({ ...gear, "options.scenario#1": "Location: Wildspace" }).statOf(
        ID,
        "movement",
      ),
    ).toBeCloseTo(0.12, 9);

    const predatorId = "m31-thayan-predator";
    const ring = { "gear.ring1": "M31 Runebound Shackle" };
    expect(runBuild(ring).statOf(predatorId, "outgoing_damage")).toBeCloseTo(
      0.02,
      9,
    );
    expect(
      runBuild({ ...ring, "options.scenario#1": "Location: Thay" }).statOf(
        predatorId,
        "outgoing_damage",
      ),
    ).toBeCloseTo(0.05, 9);
  });

  it("perSource stacking multiplies by contributing slots", () => {
    // Replaces legacy `bonus_max_instances: 100` + `max_copies: 3`.
    const ID = "mount-vortex-panther-necrotic";
    const one = runBuild({
      "artifactCall.artifactCall#1": "Mount: Vortex/Panther/Necrotic",
    });
    const two = runBuild({
      "artifactCall.artifactCall#1": "Mount: Vortex/Panther/Necrotic",
      "artifactCall.artifactCall#2": "Mount: Vortex/Panther/Necrotic",
    });
    const oneBonus = one.activeById.get(ID)!;
    const twoBonus = two.activeById.get(ID)!;
    expect(oneBonus.stacks).toBe(1);
    expect(twoBonus.stacks).toBe(2);
    const oneApplied = one.appliedStatOf(ID, "enemy_incoming_damage")!;
    // `stats` stays the per-stack payload.
    const twoStatOf = two.statOf(ID, "enemy_incoming_damage")!;
    const oneStatOf = one.statOf(ID, "enemy_incoming_damage")!;
    expect(twoStatOf).toBeCloseTo(oneStatOf, 9);
    // but `appliedStats` doubles.
    expect(two.appliedStatOf(ID, "enemy_incoming_damage")!).toBeCloseTo(
      2 * oneApplied,
    );
    // and the doubled value reaches the pipeline.
    expect(two.stages.sums.enemy_incoming_damage).toBeCloseTo(2 * oneApplied);
  });

  it("Exclusion suppresses the excluded bonus", () => {
    // Replaces legacy `bonus_overrides`.
    const ID = "m31-bloodletting-ascendant";
    const alone = runBuild({
      "gear.boots": "M31 Greaves of the Crimson March",
    });
    const suppressed = runBuild({
      "gear.boots": "M31 Greaves of the Crimson March",
      "gear.shirt": "M33 Cracked Stormbind Tunic Shirt",
    });
    expect(alone.activeById.has(ID)).toBe(true);
    expect(suppressed.activeById.has(ID)).toBe(false);
    expect(
      suppressed.bonuses.find((b: EvaluatedBonus) => b.id === ID)?.excluded,
    ).toBe(true);
  });

  // --- order independence ----------------------------------------------------------------
  it("Resolution does not depend on slot order", () => {
    // The sheet counted instances by scanning rows above while checking overrides against all
    // rows, so results could shift when rows moved.
    const a = runBuild({
      "gear.head": "M33 Wintermarked Hunter Hood",
      "gear.boots": "M33 Wintermarked Marcher Poleyns",
    });
    const b = runBuild({
      "gear.boots": "M33 Wintermarked Marcher Poleyns",
      "gear.head": "M33 Wintermarked Hunter Hood",
    });
    expect(a.stages.totals.strike_p).toBeCloseTo(b.stages.totals.strike_p, 9);
  });

  // --- validation ---------------------------------------------------------------------
  it("Dynamic stats use the typed value and warn when out of range", () => {
    // FIX #6. Clamping silently rewrites the number the user typed, and would make the engine
    // disagree with the sheet for no stated reason.
    const dynamicCa = (result: ReturnType<typeof runBuild>) =>
      result.ledger.find(
        (entry) =>
          entry.kind === "dynamic" &&
          entry.slotId === "gear.offhandMod2" &&
          entry.stat === "ca",
      )?.value;
    const inRange = runBuild(
      { "gear.offhandMod2": "CA (M32+, 600 to 3600)" },
      {},
      { "gear.offhandMod2": { stat: { ca: 2000 } } },
    );
    const over = runBuild(
      { "gear.offhandMod2": "CA (M32+, 600 to 3600)" },
      {},
      { "gear.offhandMod2": { stat: { ca: 5800 } } },
    );
    expect(dynamicCa(inRange)).toBeCloseTo(2000, 9);
    // Not errors.length === 0: BASE_CONTEXT leaves every leveling ability-score slot at its
    // default (unassigned), which trips the unrelated "level-attr-warning" bonusRule -- this
    // assertion only cares that an in-range typed value raises no outOfRange error.
    expect(
      inRange.errors.some((e: EngineError) => e.kind === "outOfRange"),
    ).toBe(false);
    expect(dynamicCa(over)).toBeCloseTo(5800, 9);
    expect(over.errors.some((e: EngineError) => e.kind === "outOfRange")).toBe(
      true,
    );
  });

  it("maxCopies and class restrictions are reported", () => {
    // Four groups: an insignia bonus caps at 3, so three copies is a legal stable.
    const tooMany = runBuild({
      "insignia.bonus1": "Gladiator's Guile",
      "insignia.bonus2": "Gladiator's Guile",
      "insignia.bonus3": "Gladiator's Guile",
      "insignia.bonus4": "Gladiator's Guile",
    });
    expect(
      tooMany.errors.some((e: EngineError) => e.kind === "maxCopies"),
    ).toBe(true);
    const wrongClass = runBuild(
      { "gear.mainhand": "M28 Voidtouched Pactblade" },
      { class: "barbarian" },
    );
    expect(wrongClass.errors.some((e: EngineError) => e.kind === "class")).toBe(
      true,
    );
  });

  it("Conditions read the build, never the results", () => {
    // Design rule from plan §2.2 -- keeps evaluation single-pass and acyclic.
    const seen = new Set<string>();
    const walk = (when: ConditionWhen | undefined): void => {
      if (!when) return;
      for (const [key, value] of Object.entries(when)) {
        if (key === "any" || key === "all")
          (value as ConditionWhen[]).forEach(walk);
        else if (key === "not") walk(value as ConditionWhen | undefined);
        else seen.add(key);
      }
    };
    const visit = (grant: Grant) => {
      walk(grant.when);
      (grant.variants ?? []).forEach((v: Grant) => walk(v.when));
    };
    for (const bonus of built.bonuses) bonus.grants?.forEach(visit);
    const allowed = new Set([
      "toggle",
      "proc",
      "role",
      "class",
      "damageType",
      "duration",
      "enemies",
      "bonusOccurrences",
      "equipped",
      "input",
    ]);
    const unknown = [...seen].filter((k) => !allowed.has(k));
    expect(unknown).toEqual([]);
  });
});

// A point_assignment slot's count is meant to resolve exactly like N separate item_picker
// picks of the same item -- a synthetic db (not the real shipped one) isolates that claim
// with a bonus built specifically to prove stacking scales with the count.
describe("point_assignment resolution", () => {
  const schema: Schema = {
    stats: [],
    statByKey: {},
    statKeys: ["power_p"],
    multiplicativeStats: [],
    ratingStats: [],
    abilityStats: [],
    ratingConversion: [],
    statContributions: [],
    forteSplit: {},
    roles: { dps: { label: "dps", hpBonus: 1, damageBonus: 1 } },
  };

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
    // Not achievable through the UI's own -/+ buttons (they clamp), but a hand-edited or
    // imported build can carry one -- same reasoning as dynamicStat's own outOfRange check.
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

// A point_assignment item at 0 points is reachable (an anchor, same as the item_picker case)
// rather than skipped entirely -- but reachable must not mean "resolved for real": a proc left
// on must not activate the bonus just because the item itself is still walked for
// reachability. A synthetic db mirrors the shipped "Deathly Rage" shape: a proc input gating
// tiers on the boon's own rank.
describe("a point_assignment item's bonus stays inactive while the item itself is at 0 points", () => {
  const schema: Schema = {
    stats: [],
    statByKey: {},
    statKeys: ["power_p"],
    multiplicativeStats: [],
    ratingStats: [],
    abilityStats: [],
    ratingConversion: [],
    statContributions: [],
    forteSplit: {},
    roles: { dps: { label: "dps", hpBonus: 1, damageBonus: 1 } },
  };

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

// A bonus whose only source anywhere is currently a pick repeated 0 times still resolves --
// inactive, via a sources-less "anchor" group (bonus.ts's `collectAttachments`/`resolve()`) --
// rather than being absent from `result.bonuses` entirely. The anchor must never be counted
// as a real source anywhere stacking/attribution reads `sources`, which the mixed-source tests
// below exist to pin down.
describe("a bonus reachable only through a currently-zero repetition count", () => {
  const schema: Schema = {
    stats: [],
    statByKey: {},
    statKeys: ["power_p"],
    multiplicativeStats: [],
    ratingStats: [],
    abilityStats: [],
    ratingConversion: [],
    statContributions: [],
    forteSplit: {},
    roles: { dps: { label: "dps", hpBonus: 1, damageBonus: 1 } },
  };

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
    // Only dial-item's 2 real occurrences count -- other-dial-item's 0 contributes nothing to
    // stacks, sources, or the applied stats, even though it's equipped in the same build.
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

// Unlike every fixture above (a self-referential `bonusOccurrences` gate, which naturally
// fails at 0 real occurrences on its own), this grant has no `when` at all -- e.g. Shattered
// Resolve's flat per-stack payload. Without `evaluateBonus` also forcing the grant's own
// `.active` false, it stays `true` on its own and gets multiplied by `entry.stacks` (0 while
// inactive) instead of falling through to the near-miss preview -- showing 0 instead of what
// one stack would actually give.
describe("an unconditional stacking grant reachable only through a currently-zero count", () => {
  const schema: Schema = {
    stats: [],
    statByKey: {},
    statKeys: ["power_p"],
    multiplicativeStats: [],
    ratingStats: [],
    abilityStats: [],
    ratingConversion: [],
    statContributions: [],
    forteSplit: {},
    roles: { dps: { label: "dps", hpBonus: 1, damageBonus: 1 } },
  };

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

// A build_parameter's `linkedItem` is meant to resolve through the exact same
// equip/tag/bonus-occurrence/bonus-candidate bookkeeping an item_picker pick does (bonus.ts's
// `collect()` derives the row's "choice" from the param's current value instead of
// `build.choices`, but everything downstream is shared) -- a synthetic db isolates both
// authoring shapes: a `list` param's per-option item and a `boolean`
// param's single item.
describe("race restrictions ride on the generic equipped condition", () => {
  const schema: Schema = {
    stats: [],
    statByKey: {},
    statKeys: ["power_p", "hit_points"],
    multiplicativeStats: [],
    ratingStats: [],
    abilityStats: [],
    ratingConversion: [],
    statContributions: [],
    forteSplit: {},
    roles: { dps: { label: "dps", hpBonus: 1, damageBonus: 1 } },
  };

  // Race restrictions are no longer a dedicated `allowedRace`/`kind: "race"` check -- race
  // is an `item_picker` slot again, and a race-restricted item expresses its
  // restriction the same way any other conditional problem does: a `hideFromPicker` grant
  // gated on the generic `equipped` leaf against the race item's own id.
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
  const schema: Schema = {
    stats: [],
    statByKey: {},
    statKeys: ["power_p"],
    multiplicativeStats: [],
    ratingStats: [],
    abilityStats: [],
    ratingConversion: [],
    statContributions: [],
    forteSplit: {},
    roles: { dps: { label: "dps", hpBonus: 1, damageBonus: 1 } },
  };

  // item_picker case: an error grant gated on the build's own class -- stands in for "the
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
  // A `hideFromPicker` problem grant -- signals that a consumer (ItemPicker.vue) should drop
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

  // point_assignment case: a warning gated on a tag threshold -- "warning if a tier 2 boon is
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

  // `hideFromPicker` is only meaningful to a UI consumer (ItemPicker.vue) -- the engine's job
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
