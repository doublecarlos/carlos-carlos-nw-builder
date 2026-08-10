// Unit tests for the bonus model's semantics (plan Part 2).
//
// The golden fixture proves the engine reproduces the sheet.
// Each test names the behaviour and, where relevant, the legacy bug it prevents.

import { describe, it, expect } from "vitest";
import * as db from "../../src/data/db";
import * as engine from "../../src/engine/engine";
import { isHiddenBonus } from "../../src/engine/bonus";
import type {
  Build,
  BuildContext,
  BuildParameterSlot,
  BonusSet,
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
  combatType: "single",
  duration: 60,
  damageType: "magical",
  magnitude: 100,
  m32Forte: false,
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
  values: Record<string, number> = {},
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
  it("Critical Breaker applies once at one piece, and still once at two", () => {
    // Legacy enumerated only `::1:2`, so wearing both pieces computed `::2:2`, found no
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
      "enchantments.offense1": "1) Amethyst (CA)",
    });
    const three = runBuild({
      ...ring,
      "enchantments.offense1": "1) Amethyst (CA)",
      "enchantments.offense2": "1) Amethyst (Awareness)",
      "enchantments.defense1": "1) Amethyst (Awareness)",
    });
    expect(none.activeById.has(ID)).toBe(false);
    expect(one.statOf(ID, "ca_p")).toBeCloseTo(0.03, 9);
    expect(three.statOf(ID, "ca_p")).toBeCloseTo(0.03, 9);
  });

  // --- condition language --------------------------------------------------------------
  it("Duration is a continuous axis, and bucket boundaries are half-open", () => {
    // Legacy had four fixed buckets; `-combat_short-` means [10, 30) and
    // `-combat_medium_plus-` means >= 30. Off-bucket values must behave sensibly. Also proves
    // the grants restructuring (2026-07-27): this set is two mutually-exclusive duration
    // grants under one id now, not two separately-tracked bonuses -- they'd better not both
    // fire at once.
    const ID = "m32-deathsilver-ring-of-submission-strike";
    const ring = {
      "gear.ring1": "M32 Deathsilver Ring of  Submission (Strike)",
    };
    const at = (duration: number) => runBuild(ring, { duration });

    expect(at(9).activeById.has(ID)).toBe(false);
    expect(at(10).activeById.has(ID)).toBe(true);
    expect(at(10).statOf(ID, "strike_p")).toBeCloseTo(0.022, 9);
    expect(at(29).statOf(ID, "strike_p")).toBeCloseTo(0.022, 9);
    expect(at(30).statOf(ID, "strike_p")).toBeCloseTo(0.066, 9);
    expect(at(85).statOf(ID, "strike_p")).toBeCloseTo(0.066, 9);
  });

  it("Toggles gate bonuses, and a two-toggle condition needs both", () => {
    const ID = "m32-deathsilver-ring-of-submission-strike";
    const ring = {
      "gear.ring1": "M32 Deathsilver Ring of  Submission (Strike)",
    };
    expect(runBuild(ring).activeById.has(ID)).toBe(true);
    expect(
      runBuild(ring, { toggles: { combat: false } }).activeById.has(ID),
    ).toBe(false);
  });

  // --- tiers, variants, stacking, exclusion ---------------------------------------------
  it("Piece tiers are absolute and mutually exclusive, not cumulative", () => {
    // Gladiator's Guile grants 10% at one insignia and 15% at two -- not 25%.
    const ID = "gladiator-s-guile";
    const one = runBuild({ "insignia.bonus1": "Gladiator's Guile" });
    const two = runBuild({
      "insignia.bonus1": "Gladiator's Guile",
      "insignia.bonus2": "Gladiator's Guile",
    });
    expect(one.statOf(ID, "movement")).toBeCloseTo(0.1, 9);
    expect(one.activeById.get(ID)!.chose).toBe("tier:1");
    expect(two.statOf(ID, "movement")).toBeCloseTo(0.15, 9);
    expect(two.activeById.get(ID)!.chose).toBe("tier:2");
  });

  it("Role variants select exactly one payload, summed with the set's other grants", () => {
    // Grants restructuring (2026-07-27): this set is 4 grants now, not 4 separately-tracked
    // bonuses -- a flat 2-piece grant (-5% incoming, +5% healing) is active alongside the role
    // variant whenever 2 pieces are worn, so a role that is not the matching variant still
    // carries the flat grant's own stats, just not the other roles' variant-specific ones.
    const ID = "m28-voidtouched-set";
    const set = {
      "gear.mainhand": "M28 Voidtouched Pactblade",
      "gear.offhand": "M28 Voidtouched Tome",
    };
    const dps = runBuild(set, { role: "dps" });
    const healer = runBuild(set, { role: "healer" });
    const tank = runBuild(set, { role: "tank" });
    expect(dps.statOf(ID, "outgoing_damage")).toBeCloseTo(0.06, 9);
    expect(dps.statOf(ID, "overall_healing")).toBeCloseTo(0.05, 9);
    expect(healer.statOf(ID, "overall_healing")).toBeCloseTo(0.05 + 0.06, 9);
    expect(tank.statOf(ID, "incoming_damage")).toBeCloseTo(-0.05 - 0.06, 9);
    // healer's variant doesn't grant outgoing_damage — verify its stats don't include it
    const healerBonus = healer.activeById.get(ID)!;
    expect(healerBonus.stats?.outgoing_damage).toBeUndefined();
  });

  it("A two-piece set needs two pieces", () => {
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
    const pieces = {
      "gear.mainhand": "M28 Voidtouched Pactblade",
      "gear.offhand": "M28 Voidtouched Tome",
    };
    const ID = "m28-voidtouched-set";
    expect(runBuild(pieces).statOf(ID, "movement")).toBeUndefined();
    expect(
      runBuild({ ...pieces, "options.location": "Wildspace" }).statOf(
        ID,
        "movement",
      ),
    ).toBeCloseTo(0.12, 9);

    const predatorId = "m31-thayan-predator";
    const ring = { "gear.ring1": "M31 Runebound Shackle (Damage)" };
    expect(runBuild(ring).statOf(predatorId, "outgoing_damage")).toBeCloseTo(
      0.02,
      9,
    );
    expect(
      runBuild({ ...ring, "options.location": "Thay" }).statOf(
        predatorId,
        "outgoing_damage",
      ),
    ).toBeCloseTo(0.05, 9);
  });

  it("perSource stacking multiplies by contributing slots", () => {
    // Replaces legacy `bonus_max_instances: 100` + `max_copies: 3`.
    const ID = "mount-vortex-panther-necrotic";
    const one = runBuild({
      "artifactCall.artifactCall1": "Mount: Vortex/Panther/Necrotic",
    });
    const two = runBuild({
      "artifactCall.artifactCall1": "Mount: Vortex/Panther/Necrotic",
      "artifactCall.artifactCall2": "Mount: Vortex/Panther/Necrotic",
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
      "gear.boots": "M31 Greaves of the Crimson March (Damage)",
    });
    const suppressed = runBuild({
      "gear.boots": "M31 Greaves of the Crimson March (Damage)",
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
  it("Dynamic weapon mods use the typed value and warn when out of range", () => {
    // FIX #6. Clamping silently rewrites the number the user typed, and would make the engine
    // disagree with the sheet for no stated reason.
    const inRange = runBuild(
      { "gear.offhandMod2": "CA (M32+, 600 to 3600)" },
      {},
      { "gear.offhandMod2": 2000 },
    );
    const over = runBuild(
      { "gear.offhandMod2": "CA (M32+, 600 to 3600)" },
      {},
      { "gear.offhandMod2": 5800 },
    );
    expect(inRange.stages.weaponMods.ca).toBeCloseTo(2000, 9);
    // Not errors.length === 0: BASE_CONTEXT leaves every leveling ability-score slot at its
    // default (unassigned), which trips the unrelated "level-attr-warning" bonusRule -- this
    // assertion only cares that an in-range typed value raises no outOfRange error.
    expect(
      inRange.errors.some((e: EngineError) => e.kind === "outOfRange"),
    ).toBe(false);
    expect(over.stages.weaponMods.ca).toBeCloseTo(5800, 9);
    expect(over.errors.some((e: EngineError) => e.kind === "outOfRange")).toBe(
      true,
    );
  });

  it("maxCopies and class restrictions are reported", () => {
    const tooMany = runBuild({
      "insignia.bonus1": "Gladiator's Guile",
      "insignia.bonus2": "Gladiator's Guile",
      "insignia.bonus3": "Gladiator's Guile",
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
    // item.bonuses is a string[] of BonusSet ids -- look up the actual sets by id.
    const setsById = new Map(built.bonusSets.map((s) => [s.id, s]));
    for (const item of built.items) {
      for (const setId of item.bonuses ?? []) {
        const bonusSet = setsById.get(setId);
        bonusSet?.grants?.forEach(visit);
      }
    }
    for (const set of built.bonusSets) set.grants?.forEach(visit);
    const allowed = new Set([
      "toggle",
      "proc",
      "role",
      "class",
      "combatType",
      "damageType",
      "duration",
      "pieces",
      "equipped",
    ]);
    const unknown = [...seen].filter((k) => !allowed.has(k));
    expect(unknown).toEqual([]);
  });
});

// A point_assignment slot's count is meant to resolve exactly like N separate item_picker
// picks of the same item -- a synthetic db (not the real shipped one) isolates that claim
// with a bonus set built specifically to prove stacking scales with the count.
describe("point_assignment resolution", () => {
  const schema: Schema = {
    stats: [],
    statByKey: {},
    statKeys: ["power_p"],
    multiplicativeStats: [],
    ratingStats: [],
    abilityStats: [],
    ratingConversion: [],
    abilityContributions: [],
    forteSplit: {},
    roles: { dps: { label: "dps", hpBonus: 1, damageBonus: 1 } },
  };

  const powerItem: Item = {
    id: "boon-power",
    name: "Boon Power",
    filter: "test_boon_tier",
    power_p: 0.01,
    maxCopies: 3,
    bonuses: ["boon-power-set"],
    pointAssignment: { min: 0, max: 4, default: 0 },
  };
  const powerSet: BonusSet = {
    id: "boon-power-set",
    stacking: "perSource",
    grants: [{ stats: { power_p: 0.02 } }],
  };
  const restrictedItem: Item = {
    id: "boon-restricted",
    name: "Boon Restricted",
    filter: "test_boon_tier",
    allowedClass: ["fighter"],
    pointAssignment: { min: 0, max: 2, default: 0 },
  };

  const pointSlot: PointAssignmentSlot = {
    id: "boons.tier1",
    label: "Boons (Tier 1)",
    section: "boons",
    type: "point_assignment",
    filter: "test_boon_tier",
  };
  const slotsData: SlotsData = {
    sections: [{ id: "boons", label: "Boons" }],
    slots: [pointSlot],
  };
  const testDb = db.build(
    [powerItem, restrictedItem],
    [powerSet],
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
      compare: { id: "", highlight: false, onlyDiff: false },
    } as unknown as Build;
  }

  it("a count of 0 (the default) contributes nothing", () => {
    const result = engine.resolveBuild(testDb, buildWith({}));
    expect(
      result.bonuses.find((b) => b.id === "boon-power-set")?.active,
    ).toBeFalsy();
    expect(result.stages.sums.power_p).toBe(0);
  });

  it("N points bump stacking the same way N separate item_picker picks would", () => {
    const one = engine.resolveBuild(testDb, buildWith({ "boon-power": 1 }));
    const two = engine.resolveBuild(testDb, buildWith({ "boon-power": 2 }));
    expect(one.bonuses.find((b) => b.id === "boon-power-set")?.stacks).toBe(1);
    expect(two.bonuses.find((b) => b.id === "boon-power-set")?.stacks).toBe(2);
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

// Per-item procs (#82): each proc-conditional grant reads its own toggle from `build.procs`,
// keyed by `${bonusSetId}:${grantIndex}` -- independent of any other grant's, and independent
// of the old build-wide `toggles` map. A synthetic db isolates the key format and default-on
// behaviour from the shipped data, which doesn't author any `proc` conditions yet.
describe("per-item procs", () => {
  const schema: Schema = {
    stats: [],
    statByKey: {},
    statKeys: ["power_p", "crit_p"],
    multiplicativeStats: [],
    ratingStats: [],
    abilityStats: [],
    ratingConversion: [],
    abilityContributions: [],
    forteSplit: {},
    roles: { dps: { label: "dps", hpBonus: 1, damageBonus: 1 } },
  };

  const procRing: Item = {
    id: "proc-ring",
    name: "Proc Ring",
    bonuses: ["proc-ring-set"],
  };
  const procRingSet: BonusSet = {
    id: "proc-ring-set",
    grants: [{ when: { proc: true }, stats: { power_p: 0.05 } }],
  };

  // Two independent procs modelled as two grants under one set, per the issue's own answer:
  // "any proc will be strictly modelled as a standalone grant".
  const doubleProcTrinket: Item = {
    id: "double-proc-trinket",
    name: "Double Proc Trinket",
    bonuses: ["double-proc-set"],
  };
  const doubleProcSet: BonusSet = {
    id: "double-proc-set",
    grants: [
      { when: { proc: true }, stats: { power_p: 0.01 } },
      { when: { proc: true }, stats: { crit_p: 0.02 } },
    ],
  };

  // The object form of `proc` -- a custom checkbox label, and a proc that starts off rather
  // than the usual default-on.
  const situationalTrinket: Item = {
    id: "situational-trinket",
    name: "Situational Trinket",
    bonuses: ["situational-trinket-set"],
  };
  const situationalTrinketSet: BonusSet = {
    id: "situational-trinket-set",
    grants: [
      {
        when: { proc: { label: "Only vs. bosses", default: false } },
        stats: { power_p: 0.07 },
      },
    ],
  };

  const gearSlot: ItemPickerSlot = {
    id: "gear.ring1",
    label: "Ring 1",
    section: "gear",
    type: "item_picker",
    filter: "test_gear",
  };
  const slotsData: SlotsData = {
    sections: [{ id: "gear", label: "Gear" }],
    slots: [gearSlot],
  };
  const testDb = db.build(
    [procRing, doubleProcTrinket, situationalTrinket],
    [procRingSet, doubleProcSet, situationalTrinketSet],
    schema,
    slotsData,
  );

  function buildWith(
    choice: string,
    procs: Record<string, boolean> = {},
  ): Build {
    return {
      id: "b",
      name: "b",
      choices: { "gear.ring1": choice },
      values: {},
      assignments: {},
      procs,
      context: BASE_CONTEXT,
      compare: { id: "", highlight: false, onlyDiff: false },
    } as unknown as Build;
  }

  it("defaults on: a grant with no explicit build.procs entry still fires", () => {
    const result = engine.resolveBuild(testDb, buildWith("proc-ring"));
    const bonus = result.bonuses.find((b) => b.id === "proc-ring-set");
    expect(bonus?.active).toBe(true);
    expect(bonus?.grants[0].procKey).toBe("proc-ring-set:0");
  });

  it("an explicit false for the grant's key turns it off", () => {
    const result = engine.resolveBuild(
      testDb,
      buildWith("proc-ring", { "proc-ring-set:0": false }),
    );
    expect(result.bonuses.find((b) => b.id === "proc-ring-set")?.active).toBe(
      false,
    );
  });

  it("a grant with no proc condition carries a null procKey", () => {
    const flat: BonusSet = {
      id: "flat-set",
      grants: [{ stats: { power_p: 0.03 } }],
    };
    const flatItem: Item = {
      id: "flat-ring",
      name: "Flat Ring",
      bonuses: ["flat-set"],
    };
    const flatDb = db.build([flatItem], [flat], schema, slotsData);
    const result = engine.resolveBuild(
      flatDb,
      buildWith("flat-ring") as unknown as Build,
    );
    expect(
      result.bonuses.find((b) => b.id === "flat-set")?.grants[0].procKey,
    ).toBeNull();
  });

  it("two proc grants in one set toggle independently by grant index", () => {
    const bothOn = engine.resolveBuild(
      testDb,
      buildWith("double-proc-trinket"),
    );
    expect(bothOn.stages.sums.power_p).toBeCloseTo(0.01, 9);
    expect(bothOn.stages.sums.crit_p).toBeCloseTo(0.02, 9);

    const firstOff = engine.resolveBuild(
      testDb,
      buildWith("double-proc-trinket", { "double-proc-set:0": false }),
    );
    expect(firstOff.stages.sums.power_p).toBe(0);
    expect(firstOff.stages.sums.crit_p).toBeCloseTo(0.02, 9);
  });

  it("feeds ConditionExplain the same way a toggle does, for the bonus inspector", () => {
    const off = engine.resolveBuild(
      testDb,
      buildWith("proc-ring", { "proc-ring-set:0": false }),
    );
    const bonus = off.bonuses.find((b) => b.id === "proc-ring-set")!;
    expect(bonus.gate.unmet[0]?.label).toBe("proc");
    expect(bonus.gate.unmet[0]?.detail).toBe("disabled");
  });

  it("a spec with default: false starts off with no explicit build.procs entry", () => {
    const result = engine.resolveBuild(
      testDb,
      buildWith("situational-trinket"),
    );
    expect(
      result.bonuses.find((b) => b.id === "situational-trinket-set")?.active,
    ).toBe(false);
  });

  it("an explicit true in build.procs overrides a spec's default: false", () => {
    const result = engine.resolveBuild(
      testDb,
      buildWith("situational-trinket", {
        "situational-trinket-set:0": true,
      }),
    );
    expect(
      result.bonuses.find((b) => b.id === "situational-trinket-set")?.active,
    ).toBe(true);
  });
});

// A build_parameter's `linkedItem` is meant to resolve through the exact same
// equip/tag/set-piece/bonus-candidate bookkeeping an item_picker pick does (bonus.ts's
// `collect()` derives the row's "choice" from the param's current value instead of
// `build.choices`, but everything downstream is shared) -- a synthetic db isolates both
// authoring shapes the issue asked for: a `list` param's per-option item and a `boolean`
// param's single item.
describe("build_parameter linked items", () => {
  const schema: Schema = {
    stats: [],
    statByKey: {},
    statKeys: ["power_p", "hit_points"],
    multiplicativeStats: [],
    ratingStats: [],
    abilityStats: [],
    ratingConversion: [],
    abilityContributions: [],
    forteSplit: {},
    roles: { dps: { label: "dps", hpBonus: 1, damageBonus: 1 } },
  };

  const halfOrcItem: Item = {
    id: "race-half-orc",
    name: "Race: Half-Orc",
    hit_points: 100,
    bonuses: ["half-orc-set"],
    maxCopies: 1,
  };
  const halfOrcSet: BonusSet = {
    id: "half-orc-set",
    grants: [{ stats: { power_p: 0.02 } }],
  };
  const restrictedRaceItem: Item = {
    id: "race-restricted",
    name: "Race: Restricted",
    allowedClass: ["fighter"],
  };
  const consumableItem: Item = {
    id: "consumable-buff",
    name: "Consumable Buff",
    power_p: 0.01,
  };

  const raceSlot: BuildParameterSlot = {
    id: "options.race",
    label: "Race",
    section: "options",
    type: "build_parameter",
    paramType: "list",
    path: "race",
    default: "",
    options: [
      { value: "", label: "— none —" },
      { value: "half-orc", label: "Half-Orc", linkedItem: "race-half-orc" },
      { value: "elf", label: "Elf" },
      {
        value: "restricted",
        label: "Restricted",
        linkedItem: "race-restricted",
      },
    ],
  };
  const consumableSlot: BuildParameterSlot = {
    id: "options.consumable",
    label: "Consumable buff",
    section: "options",
    type: "build_parameter",
    paramType: "boolean",
    path: "toggles.consumableBuff",
    default: false,
    linkedItem: "consumable-buff",
  };
  const slotsData: SlotsData = {
    sections: [{ id: "options", label: "Options" }],
    slots: [raceSlot, consumableSlot],
  };
  const testDb = db.build(
    [halfOrcItem, restrictedRaceItem, consumableItem],
    [halfOrcSet],
    schema,
    slotsData,
  );

  function buildWith(
    contextOverrides: Partial<BuildContext> & {
      race?: string;
      toggles?: Record<string, boolean>;
    } = {},
  ): Build {
    return {
      id: "b",
      name: "b",
      choices: {},
      values: {},
      assignments: {},
      context: { ...BASE_CONTEXT, race: "", ...contextOverrides },
      compare: { id: "", highlight: false, onlyDiff: false },
    } as unknown as Build;
  }

  it("an unset list param contributes nothing", () => {
    const result = engine.resolveBuild(testDb, buildWith());
    expect(result.stages.sums.hit_points).toBe(0);
    expect(
      result.bonuses.find((b) => b.id === "half-orc-set")?.active,
    ).toBeFalsy();
  });

  it("selecting an option with a linkedItem equips it: item stats and its bonuses both apply", () => {
    const result = engine.resolveBuild(testDb, buildWith({ race: "half-orc" }));
    expect(result.stages.sums.hit_points).toBeCloseTo(100, 9);
    expect(result.stages.sums.power_p).toBeCloseTo(0.02, 9);
    expect(result.bonuses.find((b) => b.id === "half-orc-set")?.active).toBe(
      true,
    );
  });

  it("selecting an option with no linkedItem contributes nothing", () => {
    const result = engine.resolveBuild(testDb, buildWith({ race: "elf" }));
    expect(result.stages.sums.hit_points).toBe(0);
  });

  it("a list param's and a boolean param's linked items compose, not overwrite each other", () => {
    const both = engine.resolveBuild(
      testDb,
      buildWith({ race: "half-orc", toggles: { consumableBuff: true } }),
    );
    // half-orc: hit_points 100, power_p 0.02 (bonus); consumable: power_p 0.01
    expect(both.stages.sums.hit_points).toBeCloseTo(100, 9);
    expect(both.stages.sums.power_p).toBeCloseTo(0.02 + 0.01, 9);
  });

  it("a checked boolean param's linkedItem applies; unchecked it does not", () => {
    const on = engine.resolveBuild(
      testDb,
      buildWith({ toggles: { consumableBuff: true } }),
    );
    const off = engine.resolveBuild(
      testDb,
      buildWith({ toggles: { consumableBuff: false } }),
    );
    expect(on.stages.sums.power_p).toBeCloseTo(0.01, 9);
    expect(off.stages.sums.power_p).toBe(0);
  });

  it("a class-restricted linked item flags a class error the same way a picked item would", () => {
    const result = engine.resolveBuild(
      testDb,
      buildWith({ race: "restricted", class: "rogue" }),
    );
    expect(result.errors.some((e) => e.kind === "class")).toBe(true);
  });

  // Race restrictions are no longer a dedicated `allowedRace`/`kind: "race"` check (issue
  // #197) -- race is an `item_picker` slot again, and a race-restricted item expresses its
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
    const raceRestrictionSet: BonusSet = {
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
      [raceRestrictionSet],
      schema,
      {
        sections: [
          { id: "raceLeveling", label: "Race" },
          { id: "gear", label: "Gear" },
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
      compare: { id: "", highlight: false, onlyDiff: false },
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
      compare: { id: "", highlight: false, onlyDiff: false },
    } as unknown as Build);
    expect(wrongRace.errors.some((e) => e.kind === "bonusRule")).toBe(true);
  });

  it("a linked item resolves onto its own row, not the item_picker row shape", () => {
    const result = engine.resolveBuild(testDb, buildWith({ race: "half-orc" }));
    const row = result.rows.find((r) => r.slotId === "options.race");
    expect(row?.item?.id).toBe("race-half-orc");
  });
});

// A `Grant.problem` reports a build error/warning instead of granting stats -- reuses the
// same `when` gating as a stat grant, so a synthetic db isolates both authoring shapes
// (item_picker and point_assignment) the issue asked for: an item-level mismatch check and a
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
    abilityContributions: [],
    forteSplit: {},
    roles: { dps: { label: "dps", hpBonus: 1, damageBonus: 1 } },
  };

  // item_picker case: an error grant gated on the build's own class -- stands in for "the
  // chosen race bonus doesn't match the race picked".
  const mismatchSet: BonusSet = {
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

  // Same shape as class-mismatch-check, but its problem grant carries its own `label` --
  // issue #95: the sidebar summary should prefer this over the triggering slot's name.
  const labeledMismatchSet: BonusSet = {
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
  const hideFromPickerSet: BonusSet = {
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
    pointAssignment: { min: 0, max: 10, default: 0 },
  };
  const tier2Set: BonusSet = {
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
    pointAssignment: { min: 0, max: 4, default: 0 },
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
      { id: "gear", label: "Gear" },
      { id: "boons", label: "Boons" },
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
    [mismatchSet, labeledMismatchSet, tier2Set, hideFromPickerSet],
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
      compare: { id: "", highlight: false, onlyDiff: false },
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
      (b) => b.setId === "hide-from-picker-check",
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
      (b) => b.setId === "hide-from-picker-check",
    );
    expect(evaluated?.active).toBe(false);
  });

  // Displays that list "bonuses" (ItemCard.vue's hover card, BonusInspector.vue's sidebar
  // table) should leave a problem-only set out entirely -- issue #94: it read as an inactive
  // (or, worse, active-looking) bonus that never actually grants anything.
  describe("isHiddenBonus", () => {
    it("hides a set whose only grant reports a problem", () => {
      expect(isHiddenBonus(mismatchSet)).toBe(true);
      expect(isHiddenBonus(tier2Set)).toBe(true);
    });

    it("does not hide a plain stats-only set", () => {
      const statsOnly: BonusSet = {
        id: "stats-only",
        grants: [{ stats: { power_p: 1 } }],
      };
      expect(isHiddenBonus(statsOnly)).toBe(false);
    });

    it("does not hide a set that mixes a problem grant with a stats grant", () => {
      const mixed: BonusSet = {
        id: "mixed",
        grants: [{ stats: { power_p: 1 } }, mismatchSet.grants![0]],
      };
      expect(isHiddenBonus(mixed)).toBe(false);
    });

    it("does not hide a set with no grants", () => {
      expect(isHiddenBonus({ id: "empty" })).toBe(false);
    });
  });
});
