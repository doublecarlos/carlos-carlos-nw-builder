// The engine's contribution stage: every rule reads its source at the source's cap, so forte
// over 120% splits only 120%, and overall healing carries the capped outgoing healing.
import { describe, it, expect } from "vitest";
import * as db from "../../src/data/db";
import * as engine from "../../src/engine/engine";
import type {
  Build,
  BuildContext,
  Item,
  Schema,
  SlotsData,
  StatDef,
} from "../../src/types";

const stats: StatDef[] = [
  { key: "il", label: "Item Level", kind: "flat" },
  { key: "combined_rating", label: "Combined Rating", kind: "flat" },
  { key: "forte", label: "Forte", kind: "rating" },
  { key: "forte_p", label: "Forte", kind: "percent", rating: "forte" },
  { key: "out_healing", label: "Outgoing Healing", kind: "rating" },
  {
    key: "out_healing_p",
    label: "Outgoing Healing",
    kind: "percent",
    rating: "out_healing",
  },
  { key: "overall_healing", label: "Overall Healing", kind: "percent" },
  { key: "power_p", label: "Power", kind: "percent" },
  { key: "sev_p", label: "Severity", kind: "percent" },
  { key: "hit_points_mult", label: "Hit Points Mult", kind: "mult" },
  { key: "dex", label: "Dexterity", kind: "flat", ability: true },
  { key: "con", label: "Constitution", kind: "flat", ability: true },
  { key: "wis", label: "Wisdom", kind: "flat", ability: true },
  {
    key: "enemy_incoming_damage",
    label: "Enemy Incoming Damage",
    kind: "percent",
    enemy: true,
  },
  {
    key: "enemy_incoming_damage_magical",
    label: "Enemy Incoming Magical Damage",
    kind: "percent",
    enemy: true,
  },
  {
    key: "enemy_incoming_damage_physical",
    label: "Enemy Incoming Physical Damage",
    kind: "percent",
    enemy: true,
  },
] as StatDef[];

// A shipped-shaped conversion: with no rating at all the percent starts 0.1 under `capPct`,
// which is the baseline every expectation below adds its item stats to.
const RATING_BASELINE = 0.5;

const schema: Schema = {
  stats,
  statByKey: Object.fromEntries(stats.map((s) => [s.key, s])),
  statKeys: stats.map((s) => s.key),
  multiplicativeStats: ["hit_points_mult"],
  ratingStats: ["forte", "out_healing"],
  abilityStats: ["dex", "con", "wis"],
  ratingConversion: [
    {
      percent: "forte_p",
      rating: "forte",
      capPct: 0.6,
      allowedOver: 10000,
      pctCap: 1.2,
    },
    {
      percent: "out_healing_p",
      rating: "out_healing",
      capPct: 0.6,
      allowedOver: 10000,
      pctCap: 1.2,
    },
  ],
  statContributions: [
    { source: "dex", target: "sev_p", divisor: 200 },
    { source: "wis", target: "out_healing_p", divisor: 400 },
    { source: "con", target: "hit_points_mult", divisor: 200 },
    { source: "out_healing_p", target: "overall_healing", divisor: 1 },
  ],
  forteSplit: { primary: 2, secondaryA: 4, secondaryB: 4 },
  roles: { dps: { label: "dps", hpBonus: 1, damageBonus: 1 } },
  statScalers: [],
};

const slotsData: SlotsData = {
  sections: [{ id: "gear", label: "Gear" }],
  slots: [
    {
      id: "gear.neck",
      label: "Neck",
      section: "gear",
      type: "item_picker",
      filter: "necks",
    },
  ],
};

const CONTEXT: BuildContext = {
  class: "warlock",
  role: "dps",
  damageType: "magical",
  duration: 60,
  enemies: 1,
  magnitude: 100,
  m32Forte: false,
  forte: {},
  toggles: {},
  mountBolster: 1,
  companionBolster: 1,
};

/** Resolves a build wearing one neck item carrying exactly `itemStats`. */
function resolveWith(
  itemStats: Partial<Item>,
  context: Partial<BuildContext> = {},
) {
  const neck: Item = {
    id: "neck",
    name: "Neck",
    filter: "necks",
    ...itemStats,
  };
  const testDb = db.build([neck], [], schema, slotsData);
  const build = {
    id: "b",
    name: "b",
    choices: { "gear.neck": neck.id },
    values: {},
    assignments: {},
    occurrenceInputs: {},
    listRows: {},
    disabledSlots: {},
    context: { ...CONTEXT, ...context },
    compare: { id: "", highlight: false, onlyDiff: false, statLines: false },
  } as unknown as Build;
  return engine.resolveBuild(testDb, build);
}

const forte = { primary: "power_p", secondaryA: "sev_p" };

describe("forte split reads the capped forte percent", () => {
  it("splits at most the 120% cap between the picks", () => {
    const over = resolveWith({ forte_p: 4 }, { forte });
    expect(over.stages.totals.forte_p).toBeCloseTo(4 + RATING_BASELINE, 9);
    expect(over.stages.capped.forte_p).toBe(1.2);
    expect(over.stages.contributions.power_p).toBeCloseTo(1.2 / 2, 9);
    expect(over.stages.contributions.sev_p).toBeCloseTo(1.2 / 4, 9);
  });

  it("gives the same split as a build sitting exactly on the cap", () => {
    const over = resolveWith({ forte_p: 4 }, { forte });
    const atCap = resolveWith({ forte_p: 1.2 - RATING_BASELINE }, { forte });
    expect(atCap.stages.totals.forte_p).toBeCloseTo(1.2, 9);
    expect(over.stages.totals.power_p).toBeCloseTo(
      atCap.stages.totals.power_p,
      9,
    );
    expect(over.stages.totals.sev_p).toBeCloseTo(atCap.stages.totals.sev_p, 9);
  });

  it("splits the whole percent while it is under the cap", () => {
    const under = resolveWith({ forte_p: 0.3 }, { forte });
    const pool = 0.3 + RATING_BASELINE;
    expect(under.stages.contributions.power_p).toBeCloseTo(pool / 2, 9);
    expect(under.stages.contributions.sev_p).toBeCloseTo(pool / 4, 9);
  });

  it("rounds each forte share to two decimals in M32 forte mode", () => {
    // Pool 0.813: the primary's 0.4065 rounds up, the secondary's 0.20325 rounds down.
    const rounded = resolveWith({ forte_p: 0.313 }, { forte, m32Forte: true });
    expect(rounded.stages.contributions.power_p).toBe(0.41);
    expect(rounded.stages.contributions.sev_p).toBe(0.2);
  });
});

describe("overall healing carries outgoing healing", () => {
  it("adds the outgoing healing percent to the direct overall healing stat", () => {
    const result = resolveWith({ out_healing_p: 0.2, overall_healing: 0.05 });
    const outgoing = 0.2 + RATING_BASELINE;
    expect(result.stages.totals.out_healing_p).toBeCloseTo(outgoing, 9);
    expect(result.stages.totals.overall_healing).toBeCloseTo(
      0.05 + outgoing,
      9,
    );
    expect(result.stages.contributions.overall_healing).toBeCloseTo(
      outgoing,
      9,
    );
  });

  it("reads outgoing healing at its cap", () => {
    const result = resolveWith({ out_healing_p: 3, overall_healing: 0.05 });
    expect(result.stages.capped.out_healing_p).toBe(1.2);
    expect(result.stages.totals.overall_healing).toBeCloseTo(0.05 + 1.2, 9);
  });

  it("includes wisdom's share of outgoing healing, which the earlier rule produced", () => {
    const result = resolveWith({ wis: 40 });
    const outgoing = RATING_BASELINE + 40 / 400;
    expect(result.stages.totals.out_healing_p).toBeCloseTo(outgoing, 9);
    expect(result.stages.totals.overall_healing).toBeCloseTo(outgoing, 9);
  });
});

describe("stat contributions", () => {
  it("adds dexterity / 200 to severity", () => {
    const result = resolveWith({ dex: 30, sev_p: 0.1 });
    expect(result.stages.contributions.sev_p).toBeCloseTo(30 / 200, 9);
    expect(result.stages.totals.sev_p).toBeCloseTo(0.1 + 30 / 200, 9);
  });

  it("folds constitution into hit_points_mult as another factor", () => {
    const result = resolveWith({ con: 20, hit_points_mult: 0.5 });
    expect(result.stages.contributions.hit_points_mult).toBeCloseTo(
      20 / 200,
      9,
    );
    expect(result.stages.totals.hit_points_mult).toBeCloseTo(
      (1 + 0.5) * (1 + 20 / 200) - 1,
      9,
    );
  });

  it("lists every applied rule in pipeline order, forte last", () => {
    const result = resolveWith({ dex: 30, con: 20, wis: 40 }, { forte });
    expect(
      result.appliedContributions.map((c) => `${c.source}>${c.target}`),
    ).toEqual([
      "dex>sev_p",
      "wis>out_healing_p",
      "con>hit_points_mult",
      "out_healing_p>overall_healing",
      "forte_p>power_p",
      "forte_p>sev_p",
      "enemy_incoming_damage_magical>enemy_incoming_damage",
    ]);
  });

  it("picks physical debuff as source for a physical build", () => {
    const result = resolveWith({}, { forte, damageType: "physical" });
    expect(
      result.appliedContributions.map((c) => `${c.source}>${c.target}`),
    ).toContain("enemy_incoming_damage_physical>enemy_incoming_damage");
    expect(result.appliedContributions.map((c) => c.source)).not.toContain(
      "enemy_incoming_damage_magical",
    );
  });
});

describe("enemy incoming magical/physical damage debuff", () => {
  it("adds the magical debuff into enemy incoming damage for a magical build", () => {
    const result = resolveWith({
      enemy_incoming_damage_magical: 0.15,
      enemy_incoming_damage_physical: 0.3,
    });
    expect(result.stages.totals.enemy_incoming_damage).toBeCloseTo(0.15, 9);
  });

  it("adds the physical debuff into enemy incoming damage for a physical build", () => {
    const result = resolveWith(
      {
        enemy_incoming_damage_magical: 0.15,
        enemy_incoming_damage_physical: 0.3,
      },
      { damageType: "physical" },
    );
    expect(result.stages.totals.enemy_incoming_damage).toBeCloseTo(0.3, 9);
  });

  it("leaves enemy incoming damage untouched when only the other damage type's debuff is set", () => {
    const magicalBuild = resolveWith({ enemy_incoming_damage_physical: 0.3 });
    expect(magicalBuild.stages.totals.enemy_incoming_damage).toBeCloseTo(0, 9);

    const physicalBuild = resolveWith(
      { enemy_incoming_damage_magical: 0.15 },
      { damageType: "physical" },
    );
    expect(physicalBuild.stages.totals.enemy_incoming_damage).toBeCloseTo(0, 9);
  });
});
