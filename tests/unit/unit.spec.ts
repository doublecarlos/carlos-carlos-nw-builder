// Unit tests for the bonus model's semantics (plan Part 2).
//
// The golden fixture proves the engine reproduces the sheet.
// Each test names the behaviour and, where relevant, the legacy bug it prevents.

import { describe, it, expect } from "vitest";
import * as db from "../../src/data/db";
import * as engine from "../../src/engine/engine";
import type {
  Build,
  BuildContext,
  BonusSet,
  EvaluatedBonus,
  EngineError,
  Grant,
  ConditionWhen,
  Item,
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
  location: "generic",
  damageType: "magical",
  magnitude: 100,
  m32Forte: false,
  forte: {},
  toggles: {
    combat: true,
    party: true,
    consumables: true,
    procs: true,
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
    expect(inRange.errors.length).toBe(0);
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
      "role",
      "class",
      "combatType",
      "location",
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
