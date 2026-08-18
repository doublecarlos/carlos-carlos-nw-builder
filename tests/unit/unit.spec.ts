// Unit tests for the bonus model's semantics (plan Part 2).
//
// The golden fixture proves the engine reproduces the sheet.
// Each test names the behaviour and, where relevant, the legacy bug it prevents.

import { describe, it, expect } from "vitest";
import * as db from "../../src/data/db";
import * as engine from "../../src/engine/engine";
import { isHiddenBonus } from "../../src/engine/bonus";
import { bonusIdOf } from "../../src/lib/bonus-attachment";
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
  values: Record<string, Record<string, number>> = {},
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
  it("Duration is a continuous axis, and bucket boundaries are half-open", () => {
    // Legacy had four fixed buckets; `-combat_short-` means [10, 30) and
    // `-combat_medium_plus-` means >= 30. Off-bucket values must behave sensibly. Also proves
    // the grants restructuring (2026-07-27): this bonus is two mutually-exclusive duration
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
  it("Occurrence tiers are absolute and mutually exclusive, not cumulative", () => {
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
    // healer's variant doesn't grant outgoing_damage — verify its stats don't include it
    const healerBonus = healer.activeById.get(ID)!;
    expect(healerBonus.stats?.outgoing_damage).toBeUndefined();
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
      runBuild({ ...gear, "options.location": "Wildspace" }).statOf(
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
  it("Dynamic stats use the typed value and warn when out of range", () => {
    // FIX #6. Clamping silently rewrites the number the user typed, and would make the engine
    // disagree with the sheet for no stated reason.
    const inRange = runBuild(
      { "gear.offhandMod2": "CA (M32+, 600 to 3600)" },
      {},
      { "gear.offhandMod2": { ca: 2000 } },
    );
    const over = runBuild(
      { "gear.offhandMod2": "CA (M32+, 600 to 3600)" },
      {},
      { "gear.offhandMod2": { ca: 5800 } },
    );
    expect(inRange.stages.dynamicStatMods.ca).toBeCloseTo(2000, 9);
    // Not errors.length === 0: BASE_CONTEXT leaves every leveling ability-score slot at its
    // default (unassigned), which trips the unrelated "level-attr-warning" bonusRule -- this
    // assertion only cares that an in-range typed value raises no outOfRange error.
    expect(
      inRange.errors.some((e: EngineError) => e.kind === "outOfRange"),
    ).toBe(false);
    expect(over.stages.dynamicStatMods.ca).toBeCloseTo(5800, 9);
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
    // item.bonuses is a (string | BonusOccurrenceConfig)[] -- look up the actual bonuses by id.
    const bonusesById = new Map(built.bonuses.map((b) => [b.id, b]));
    for (const item of built.items) {
      for (const attachment of item.bonuses ?? []) {
        const bonus = bonusesById.get(bonusIdOf(attachment));
        bonus?.grants?.forEach(visit);
      }
    }
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
    abilityContributions: [],
    forteSplit: {},
    roles: { dps: { label: "dps", hpBonus: 1, damageBonus: 1 } },
    statScalers: [],
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
  // #232: an item on a point_assignment row can also carry a BonusOccurrenceConfig attachment,
  // whose count is independent of the row's own repetition count -- unlike a bare-id
  // attachment (boon-power-bonus above), which scales with it.
  const configBonus: Bonus = {
    id: "boon-config-bonus",
    stacking: "perSource",
    grants: [{ stats: { power_p: 0.05 } }],
  };
  const configItem: Item = {
    id: "boon-config",
    name: "Boon Config",
    filter: "test_boon_tier",
    bonuses: [{ bonus: "boon-config-bonus", min: 0, max: 5, default: 0 }],
    inlineRepetition: { min: 0, max: 4, default: 0 },
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
    [powerItem, restrictedItem, configItem],
    [powerBonus, configBonus],
    schema,
    slotsData,
  );

  function buildWith(
    counts: Record<string, number>,
    occurrenceInputs: Record<string, Record<string, number>> = {},
  ): Build {
    return {
      id: "b",
      name: "b",
      choices: {},
      values: {},
      assignments: { "boons.tier1": counts },
      occurrenceInputs,
      context: BASE_CONTEXT,
      compare: { id: "", highlight: false, onlyDiff: false },
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

  it("a BonusOccurrenceConfig attachment's count is independent of the row's own repetition count", () => {
    // The row's own count (3) would apply to a bare-id bonus, but boon-config-bonus carries a
    // BonusOccurrenceConfig of its own -- its count comes from occurrenceInputs instead.
    const result = engine.resolveBuild(
      testDb,
      buildWith(
        { "boon-config": 3 },
        { "boon-config": { "boon-config-bonus": 5 } },
      ),
    );
    expect(
      result.bonuses.find((b) => b.id === "boon-config-bonus")?.stacks,
    ).toBe(5);
  });

  it("a BonusOccurrenceConfig attachment with no explicit input falls back to its own default, not the row's count", () => {
    const result = engine.resolveBuild(testDb, buildWith({ "boon-config": 3 }));
    expect(
      result.bonuses.find((b) => b.id === "boon-config-bonus")?.active,
    ).toBeFalsy();
  });
});

// A point_assignment item at 0 points is now reachable (an anchor, same as #255's item_picker
// case) rather than skipped entirely -- but reachable must not mean "resolved for real": a
// checked-but-inactive typed config (e.g. a proc checkbox left on from a previous count) must
// not leak through as a real occurrence just because the item itself is still walked for
// reachability. A synthetic db mirrors the shipped "Deathly Rage" shape: a bare-id bonus gated
// on a sibling BonusOccurrenceConfig attachment on the same item.
describe("a point_assignment item's own config stays 0 while the item itself is at 0 points", () => {
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
    statScalers: [],
  };

  const procBonus: Bonus = { id: "boon-master-proc", grants: [] };
  const statsBonus: Bonus = {
    id: "boon-master-stats",
    grants: [
      {
        when: { bonusOccurrences: { bonus: "boon-master-proc", exactly: 1 } },
        stats: { power_p: 0.1 },
      },
    ],
  };
  const masterItem: Item = {
    id: "boon-master",
    name: "Boon Master",
    filter: "test_boon_master",
    bonuses: [
      "boon-master-stats",
      { bonus: "boon-master-proc", min: 0, max: 1, default: 0, label: "proc" },
    ],
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
    sections: [{ id: "boons", label: "Boons" }],
    slots: [pointSlot],
  };
  const testDb = db.build(
    [masterItem],
    [procBonus, statsBonus],
    schema,
    slotsData,
  );

  function buildWith(
    counts: Record<string, number>,
    occurrenceInputs: Record<string, Record<string, number>> = {},
  ): Build {
    return {
      id: "b",
      name: "b",
      choices: {},
      values: {},
      assignments: { "boons.master": counts },
      occurrenceInputs,
      context: BASE_CONTEXT,
      compare: { id: "", highlight: false, onlyDiff: false },
    } as unknown as Build;
  }

  it("a checked proc doesn't activate the stats bonus while the item has 0 points", () => {
    const result = engine.resolveBuild(
      testDb,
      buildWith({}, { "boon-master": { "boon-master-proc": 1 } }),
    );
    const entry = result.bonuses.find((b) => b.id === "boon-master-stats");
    expect(entry?.active).toBe(false);
    expect(entry?.gate?.unmet?.[0]?.detail).toBe("you have 0");
    expect(result.stages.sums.power_p).toBe(0);
  });

  it("still reaches the resolved list, inactive with no sources, rather than vanishing", () => {
    const result = engine.resolveBuild(
      testDb,
      buildWith({}, { "boon-master": { "boon-master-proc": 1 } }),
    );
    const entry = result.bonuses.find((b) => b.id === "boon-master-stats");
    expect(entry).toBeDefined();
    expect(entry?.sources).toEqual([]);
  });

  it("once real points are spent, the same checked proc activates it for real", () => {
    const result = engine.resolveBuild(
      testDb,
      buildWith(
        { "boon-master": 1 },
        { "boon-master": { "boon-master-proc": 1 } },
      ),
    );
    const entry = result.bonuses.find((b) => b.id === "boon-master-stats");
    expect(entry?.active).toBe(true);
    expect(result.stages.sums.power_p).toBeCloseTo(0.1, 9);
  });
});

// BonusOccurrenceConfig (#217): an item_picker item can attach a typed, player-set occurrence
// count for one bonus instead of the fixed "1 occurrence per equip" a bare bonus id always
// means -- e.g. one item standing in for 1-5 stacks of a set bonus, or an item with both an
// always-on bonus and a separately-variable stacking one. A synthetic db isolates the mechanism
// from the shipped data, which doesn't author any of these yet.
describe("BonusOccurrenceConfig resolution", () => {
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
    statScalers: [],
  };

  // Mirrors the motivating "Shattered Resolve" example (#216): an always-on bonus (bare id,
  // always 1 occurrence) plus a separately-variable stacking bonus (BonusOccurrenceConfig,
  // 0-5), both on one item, alongside the item's own flat stat.
  const stackItem: Item = {
    id: "stack-item",
    name: "Stacking Trinket",
    filter: "test_slot",
    power_p: 0.005,
    bonuses: [
      "always-bonus",
      { bonus: "tier-bonus", min: 0, max: 5, default: 0 },
    ],
  };
  // A fixed (min === max) config: the item always contributes 3 occurrences, no player input
  // needed at all -- e.g. #216's "possible implementation 1" fixed-type attachment.
  const fixedItem: Item = {
    id: "fixed-item",
    name: "Fixed Triplet",
    filter: "test_slot",
    bonuses: [{ bonus: "fixed-bonus", min: 3, max: 3, default: 3 }],
  };

  const alwaysBonus: Bonus = {
    id: "always-bonus",
    grants: [{ stats: { power_p: 0.02 } }],
  };
  // Absolute, mutually-exclusive tiers -- same "highest matching occurrence threshold wins"
  // mechanism the shipped Gladiator's Guile bonus already uses, just fed by one item's typed
  // count instead of by several separately-equipped items.
  const tierBonus: Bonus = {
    id: "tier-bonus",
    grants: [
      {
        tiers: [
          {
            bonusOccurrences: { bonus: "tier-bonus", atLeast: 1 },
            stats: { power_p: 0.01 },
          },
          {
            bonusOccurrences: { bonus: "tier-bonus", atLeast: 3 },
            stats: { power_p: 0.05 },
          },
          {
            bonusOccurrences: { bonus: "tier-bonus", atLeast: 5 },
            stats: { power_p: 0.1 },
          },
        ],
      },
    ],
  };
  // perSource stacking: with a fixed 3-occurrence attachment, one item alone should produce the
  // same `stacks: 3` that three separate item_picker picks would.
  const fixedBonus: Bonus = {
    id: "fixed-bonus",
    stacking: "perSource",
    grants: [{ stats: { power_p: 0.02 } }],
  };

  const slotsData: SlotsData = {
    sections: [{ id: "test", label: "Test" }],
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
    [stackItem, fixedItem],
    [alwaysBonus, tierBonus, fixedBonus],
    schema,
    slotsData,
  );

  function buildWith(
    choices: Record<string, string>,
    occurrenceInputs: Record<string, Record<string, number>> = {},
  ): Build {
    return {
      id: "b",
      name: "b",
      choices,
      values: {},
      assignments: {},
      procs: {},
      occurrenceInputs,
      context: BASE_CONTEXT,
      compare: { id: "", highlight: false, onlyDiff: false },
    } as unknown as Build;
  }

  it("a bare string attachment always contributes exactly 1 occurrence, unaffected by a sibling config", () => {
    const result = engine.resolveBuild(
      testDb,
      buildWith({ slot1: "stack-item" }),
    );
    const activeById = new Map(
      result.bonuses.filter((b) => b.active).map((b) => [b.id, b]),
    );
    expect(activeById.get("always-bonus")?.stacks).toBe(1);
    expect(activeById.get("always-bonus")?.stats?.power_p).toBeCloseTo(0.02, 9);
    // tier-bonus defaults to 0 occurrences (its own `default`) -- no build entry needed, and
    // not active since no tier matches 0.
    expect(activeById.has("tier-bonus")).toBe(false);
    // The item's own flat stat still applies regardless of either bonus.
    expect(result.stages.sums.power_p).toBeCloseTo(0.005 + 0.02, 9);
  });

  it("build.occurrenceInputs sets a per-item, per-bonus count that picks the matching tier", () => {
    const result = engine.resolveBuild(
      testDb,
      buildWith({ slot1: "stack-item" }, { "stack-item": { "tier-bonus": 3 } }),
    );
    const tier = result.bonuses.find((b) => b.id === "tier-bonus");
    expect(tier?.active).toBe(true);
    expect(tier?.chose).toBe("tier:3");
    expect(tier?.stats?.power_p).toBeCloseTo(0.05, 9);
    // always-bonus (a bare id, still 1 occurrence) is untouched by tier-bonus's own count.
    const always = result.bonuses.find((b) => b.id === "always-bonus");
    expect(always?.active).toBe(true);
    expect(always?.stats?.power_p).toBeCloseTo(0.02, 9);
  });

  it("one item's count of 5 reaches the top tier -- the case that used to need 5 separate items", () => {
    const result = engine.resolveBuild(
      testDb,
      buildWith({ slot1: "stack-item" }, { "stack-item": { "tier-bonus": 5 } }),
    );
    const tier = result.bonuses.find((b) => b.id === "tier-bonus");
    expect(tier?.chose).toBe("tier:5");
    expect(tier?.stats?.power_p).toBeCloseTo(0.1, 9);
  });

  it("a min === max config contributes its fixed count with no build.occurrenceInputs entry", () => {
    const result = engine.resolveBuild(
      testDb,
      buildWith({ slot1: "fixed-item" }),
    );
    const fixed = result.bonuses.find((b) => b.id === "fixed-bonus");
    expect(fixed?.active).toBe(true);
    // perSource stacking sees 3 sources from the one item, same as 3 separate picks would.
    expect(fixed?.stacks).toBe(3);
    expect(fixed?.appliedStats?.power_p).toBeCloseTo(3 * 0.02, 9);
  });

  it("a count outside the config's min/max is flagged as outOfRange, not clamped", () => {
    // Not achievable through a stepper's own clamped +/- buttons (#218), but a hand-edited or
    // imported build can carry one -- same reasoning as point_assignment's own outOfRange check.
    const result = engine.resolveBuild(
      testDb,
      buildWith({ slot1: "stack-item" }, { "stack-item": { "tier-bonus": 9 } }),
    );
    expect(result.errors.some((e) => e.kind === "outOfRange")).toBe(true);
    // The raw (unclamped) count is still what the engine evaluates against.
    const tier = result.bonuses.find((b) => b.id === "tier-bonus");
    expect(tier?.chose).toBe("tier:5");
  });
});

// A bonus whose only source anywhere is currently a 0-valued BonusOccurrenceConfig still
// resolves -- inactive, via a sources-less "anchor" group (bonus.ts's `collectAttachments`/
// `resolve()`) -- rather than being absent from `result.bonuses` entirely. The anchor must never
// be counted as a real source anywhere stacking/attribution reads `sources`, which the
// mixed-source tests below exist to pin down.
describe("a bonus reachable only through a currently-zero occurrence count (#255)", () => {
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
    statScalers: [],
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
    bonuses: [{ bonus: "stacking-bonus", min: 0, max: 3, default: 0 }],
  };
  const otherDialItem: Item = {
    id: "other-dial-item",
    name: "Other Dial Item",
    filter: "test_slot",
    bonuses: [{ bonus: "stacking-bonus", min: 0, max: 3, default: 0 }],
  };

  const slotsData: SlotsData = {
    sections: [{ id: "test", label: "Test" }],
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
    occurrenceInputs: Record<string, Record<string, number>> = {},
  ): Build {
    return {
      id: "b",
      name: "b",
      choices,
      values: {},
      assignments: {},
      occurrenceInputs,
      context: BASE_CONTEXT,
      compare: { id: "", highlight: false, onlyDiff: false },
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
        { "dial-item": { "stacking-bonus": 2 } },
      ),
    );
    const entry = result.bonuses.find((b) => b.id === "stacking-bonus");
    expect(entry?.active).toBe(true);
    // Only dial-item's 2 real occurrences count -- other-dial-item's 0 contributes nothing to
    // stacks, sources, or the applied stats, even though it's equipped in the same build.
    expect(entry?.stacks).toBe(2);
    expect(entry?.sources).toEqual(["Dial Item", "Dial Item"]);
    expect(entry?.appliedStats?.power_p).toBeCloseTo(2 * 0.02, 9);
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
    abilityContributions: [],
    forteSplit: {},
    roles: { dps: { label: "dps", hpBonus: 1, damageBonus: 1 } },
    statScalers: [],
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
    bonuses: [
      { bonus: "unconditional-stacking-bonus", min: 0, max: 5, default: 5 },
    ],
  };

  const slotsData: SlotsData = {
    sections: [{ id: "test", label: "Test" }],
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
    occurrenceInputs: Record<string, Record<string, number>>,
  ): Build {
    return {
      id: "b",
      name: "b",
      choices: { slot1: "stack-item" },
      values: {},
      assignments: {},
      occurrenceInputs,
      context: BASE_CONTEXT,
      compare: { id: "", highlight: false, onlyDiff: false },
    } as unknown as Build;
  }

  it("at 0 stacks, both the bonus and its own (only) grant read inactive", () => {
    const result = engine.resolveBuild(
      testDb,
      buildWith({ "stack-item": { "unconditional-stacking-bonus": 0 } }),
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
      buildWith({ "stack-item": { "unconditional-stacking-bonus": 0 } }),
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

// Per-item boolean occurrence attachments, formerly "procs" (#222): a `min:0,max:1`
// BonusOccurrenceConfig attached to an item gates that same bonus's own grant via a
// self-referential `bonusOccurrences: { bonus: <own id>, atLeast: 1 }` condition, reading
// `build.occurrenceInputs` instead of the old dedicated `build.procs`/`proc` leaf. A synthetic
// db isolates this from the shipped data.
describe("per-item boolean occurrence attachments (formerly procs)", () => {
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
    statScalers: [],
  };

  const procRing: Item = {
    id: "proc-ring",
    name: "Proc Ring",
    bonuses: [{ bonus: "proc-ring-bonus", min: 0, max: 1, default: 1 }],
  };
  const procRingBonus: Bonus = {
    id: "proc-ring-bonus",
    grants: [
      {
        when: { bonusOccurrences: { bonus: "proc-ring-bonus", atLeast: 1 } },
        stats: { power_p: 0.05 },
      },
    ],
  };

  // Two independent toggles on one item are two separate bonuses, each with its own occurrence
  // attachment -- unlike the old grant-index-keyed proc, two grants sharing one bonus id would
  // now share that one bonus's occurrence count instead of toggling independently.
  const doubleProcTrinket: Item = {
    id: "double-proc-trinket",
    name: "Double Proc Trinket",
    bonuses: [
      { bonus: "double-proc-a", min: 0, max: 1, default: 1 },
      { bonus: "double-proc-b", min: 0, max: 1, default: 1 },
    ],
  };
  const doubleProcABonus: Bonus = {
    id: "double-proc-a",
    grants: [
      {
        when: { bonusOccurrences: { bonus: "double-proc-a", atLeast: 1 } },
        stats: { power_p: 0.01 },
      },
    ],
  };
  const doubleProcBBonus: Bonus = {
    id: "double-proc-b",
    grants: [
      {
        when: { bonusOccurrences: { bonus: "double-proc-b", atLeast: 1 } },
        stats: { crit_p: 0.02 },
      },
    ],
  };

  // A custom checkbox label (BonusOccurrenceConfig.label, #227) and a toggle that starts off
  // rather than the usual default-on.
  const situationalTrinket: Item = {
    id: "situational-trinket",
    name: "Situational Trinket",
    bonuses: [
      {
        bonus: "situational-trinket-bonus",
        min: 0,
        max: 1,
        default: 0,
        label: "Only vs. bosses",
      },
    ],
  };
  const situationalTrinketBonus: Bonus = {
    id: "situational-trinket-bonus",
    grants: [
      {
        when: {
          bonusOccurrences: { bonus: "situational-trinket-bonus", atLeast: 1 },
        },
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
    [
      procRingBonus,
      doubleProcABonus,
      doubleProcBBonus,
      situationalTrinketBonus,
    ],
    schema,
    slotsData,
  );

  function buildWith(
    choice: string,
    occurrenceInputs: Record<string, Record<string, number>> = {},
  ): Build {
    return {
      id: "b",
      name: "b",
      choices: { "gear.ring1": choice },
      values: {},
      assignments: {},
      occurrenceInputs,
      context: BASE_CONTEXT,
      compare: { id: "", highlight: false, onlyDiff: false },
    } as unknown as Build;
  }

  it("defaults on: a grant with no explicit occurrenceInputs entry still fires", () => {
    const result = engine.resolveBuild(testDb, buildWith("proc-ring"));
    expect(result.bonuses.find((b) => b.id === "proc-ring-bonus")?.active).toBe(
      true,
    );
  });

  // A self-referential attachment's own count *is* its candidate count (bonus.ts's
  // `collect()`): 0 occurrences means zero real candidates. The bonus still resolves --
  // inactive, with a preview of what it would grant -- rather than vanishing from
  // `result.bonuses` entirely, so a hover card/inspector can tell "typed to 0" apart from
  // "doesn't carry this bonus at all" (#255). Same behavior a stacking (non-boolean) config's
  // own 0-occurrence case already has -- a boolean attachment gets no special case.
  it("an explicit 0 count resolves the bonus as inactive, with a preview of what it would grant", () => {
    const result = engine.resolveBuild(
      testDb,
      buildWith("proc-ring", { "proc-ring": { "proc-ring-bonus": 0 } }),
    );
    const entry = result.bonuses.find((b) => b.id === "proc-ring-bonus");
    expect(entry?.active).toBe(false);
    expect(entry?.stats).toBeNull();
    expect(entry?.previewStats).toEqual({ power_p: 0.05 });
    expect(entry?.sources).toEqual([]);
  });

  it("two independent boolean attachments on one item toggle independently", () => {
    const bothOn = engine.resolveBuild(
      testDb,
      buildWith("double-proc-trinket"),
    );
    expect(bothOn.stages.sums.power_p).toBeCloseTo(0.01, 9);
    expect(bothOn.stages.sums.crit_p).toBeCloseTo(0.02, 9);

    const firstOff = engine.resolveBuild(
      testDb,
      buildWith("double-proc-trinket", {
        "double-proc-trinket": { "double-proc-a": 0 },
      }),
    );
    expect(firstOff.stages.sums.power_p).toBe(0);
    expect(firstOff.stages.sums.crit_p).toBeCloseTo(0.02, 9);
  });

  it("a default: 0 config starts off (resolved but inactive) with no explicit occurrenceInputs entry", () => {
    const result = engine.resolveBuild(
      testDb,
      buildWith("situational-trinket"),
    );
    const entry = result.bonuses.find(
      (b) => b.id === "situational-trinket-bonus",
    );
    expect(entry?.active).toBe(false);
    expect(entry?.previewStats).toEqual({ power_p: 0.07 });
  });

  it("an explicit 1 count overrides a config's default: 0", () => {
    const result = engine.resolveBuild(
      testDb,
      buildWith("situational-trinket", {
        "situational-trinket": { "situational-trinket-bonus": 1 },
      }),
    );
    expect(
      result.bonuses.find((b) => b.id === "situational-trinket-bonus")?.active,
    ).toBe(true);
  });
});

// A build_parameter's `linkedItem` is meant to resolve through the exact same
// equip/tag/bonus-occurrence/bonus-candidate bookkeeping an item_picker pick does (bonus.ts's
// `collect()` derives the row's "choice" from the param's current value instead of
// `build.choices`, but everything downstream is shared) -- a synthetic db isolates both
// authoring shapes the issue asked for: a `list` param's per-option item and a `boolean`
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
    abilityContributions: [],
    forteSplit: {},
    roles: { dps: { label: "dps", hpBonus: 1, damageBonus: 1 } },
    statScalers: [],
  };

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
});
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
    statScalers: [],
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

  // Same shape as class-mismatch-check, but its problem grant carries its own `label` --
  // issue #95: the sidebar summary should prefer this over the triggering slot's name.
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
  // table) should leave a problem-only bonus out entirely -- issue #94: it read as an inactive
  // (or, worse, active-looking) bonus that never actually grants anything.
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
