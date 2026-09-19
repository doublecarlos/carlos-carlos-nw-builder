// A grant naming a scaler in `scaledBy` (bonus.ts's `evaluateGrant`): whichever payload shape
// wins is multiplied by that scaler's resolved multiplier, and `perSource` stacking then
// multiplies the already-scaled value.
//
// A synthetic catalog rather than the shipped one: one absolute scaler at a known share, and
// one bonus per payload shape so each claim reads on its own.
//
// The display half (`GrantEvaluation.scale` and item-card-rows.ts's `grantRows`) is covered
// here too, off the same fixture, so the card's numbers are checked against the engine's.

import { describe, it, expect } from "vitest";
import * as db from "../../src/data/db";
import * as engine from "../../src/engine/engine";
import * as catalog from "../../src/data/catalog";
import { storedListRows } from "../../src/lib/item-picker-list";
import { grantRows, itemCardRows } from "../../src/lib/item-card-rows";
import type {
  Build,
  Bonus,
  Item,
  ItemPickerSlot,
  BuildParameterSlot,
  Schema,
  SlotsData,
} from "../../src/types";

const schema: Schema = {
  stats: [
    { key: "power", label: "Power", kind: "rating" },
    { key: "outgoing_damage", label: "Outgoing Damage", kind: "percent" },
  ],
  statByKey: {
    power: { key: "power", label: "Power", kind: "rating" },
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
  roles: {
    dps: { label: "dps", hpBonus: 1, damageBonus: 1 },
    tank: { label: "tank", hpBonus: 1, damageBonus: 1 },
  },
};

const SCALER = "scalers.encounterDamage";

const flatBonus: Bonus = {
  id: "flat-scaled",
  grants: [{ stats: { outgoing_damage: 0.15, power: 100 }, scaledBy: SCALER }],
};
const tierBonus: Bonus = {
  id: "tier-scaled",
  grants: [
    {
      scaledBy: SCALER,
      tiers: [
        { bonusOccurrences: { atLeast: 1 }, stats: { outgoing_damage: 0.22 } },
        { bonusOccurrences: { atLeast: 5 }, stats: { outgoing_damage: 0.3 } },
      ],
    },
  ],
};
const variantBonus: Bonus = {
  id: "variant-scaled",
  grants: [
    {
      scaledBy: SCALER,
      variants: [
        { when: { role: "dps" }, stats: { outgoing_damage: 0.1 } },
        { when: { role: "tank" }, stats: { outgoing_damage: 0.2 } },
      ],
    },
  ],
};
const stackedBonus: Bonus = {
  id: "stacked-scaled",
  stacking: "perSource",
  grants: [{ stats: { outgoing_damage: 0.1 }, scaledBy: SCALER }],
};
const dynamicBonus: Bonus = {
  id: "dynamic-scaled",
  grants: [
    {
      stats: { outgoing_damage: 0.1 },
      dynamicStats: [{ stat: "power", min: 0, max: 1000, default: 250 }],
      scaledBy: SCALER,
    },
  ],
};
/** Names a scaler no slot declares: catalog validation rejects it, the engine leaves it at x1. */
const strayBonus: Bonus = {
  id: "stray-scaled",
  grants: [{ stats: { outgoing_damage: 0.1 }, scaledBy: "scalers.missing" }],
};
/** Scaled but gated on a toggle, so it can be evaluated inactive and previewed. */
const gatedBonus: Bonus = {
  id: "gated-scaled",
  grants: [
    {
      when: { toggle: "combat" },
      stats: { outgoing_damage: 0.15 },
      scaledBy: SCALER,
    },
  ],
};
const plainBonus: Bonus = {
  id: "plain",
  grants: [{ stats: { outgoing_damage: 0.15 } }],
};

const ring = (id: string, bonuses: Item["bonuses"]): Item => ({
  id,
  name: id,
  filter: "test_ring",
  bonuses,
});
const items: Item[] = [
  ring("flat-ring", ["flat-scaled"]),
  ring("tier-ring", [
    { bonus: "tier-scaled", min: 0, max: 5, default: 0, label: "Stacks" },
  ]),
  ring("variant-ring", ["variant-scaled"]),
  ring("stacked-ring", ["stacked-scaled"]),
  ring("dynamic-ring", ["dynamic-scaled"]),
  ring("stray-ring", ["stray-scaled"]),
  ring("gated-ring", ["gated-scaled"]),
  ring("plain-ring", ["plain"]),
];

const picker = (id: string): ItemPickerSlot => ({
  id,
  label: id,
  section: "gear",
  type: "item_picker",
  filter: "test_ring",
});
const shareParam: BuildParameterSlot = {
  id: "gear.encounterShare",
  label: "Encounter Damage",
  section: "gear",
  type: "build_parameter",
  paramType: "percent",
  path: SCALER,
  default: 0.4,
  min: 0,
  max: 1,
  scaler: { mode: "absolute" },
};
const slotsData: SlotsData = {
  sections: [{ id: "gear", label: "Gear" }],
  slots: [shareParam, picker("gear.ring1"), picker("gear.ring2")],
};

const testDb = db.build(
  items,
  [
    flatBonus,
    tierBonus,
    variantBonus,
    stackedBonus,
    dynamicBonus,
    strayBonus,
    gatedBonus,
    plainBonus,
  ],
  schema,
  slotsData,
);

/** `context` is untyped on purpose: a scaler path is an ordinary parameter path, not a
 *  `BuildContext` field, so it is written the way `setPath` would store it. */
function buildWith(
  choices: Record<string, string>,
  context: Record<string, unknown> = {},
  occurrenceInputs: Build["occurrenceInputs"] = {},
): Build {
  return {
    id: "b",
    name: "b",
    choices,
    values: {},
    assignments: {},
    occurrenceInputs,
    listRows: storedListRows({
      choices,
      values: {},
      assignments: {},
      disabledSlots: {},
    }),
    context: { role: "dps", forte: {}, toggles: {}, ...context },
    compare: { id: "", highlight: false, onlyDiff: false, statLines: false },
  } as unknown as Build;
}

function entryOf(build: Build, id: string) {
  return engine
    .resolveBuild(testDb, build)
    .bonuses.find((b) => b.bonusId === id)!;
}

/** The resolved payload of one bonus, both per-stack and as applied to the pipeline. */
function bonusOf(build: Build, id: string) {
  const entry = entryOf(build, id);
  return {
    stats: entry.stats!,
    applied: entry.appliedStats!,
    stacks: entry.stacks,
  };
}

const share = (value: number) => ({ scalers: { encounterDamage: value } });

describe("a flat grant scaled by an absolute scaler", () => {
  const flat = (value: number) =>
    bonusOf(
      buildWith({ "gear.ring1": "flat-ring" }, share(value)),
      "flat-scaled",
    );

  it("grants nothing at a share of 0", () => {
    expect(flat(0).stats).toEqual({ outgoing_damage: 0, power: 0 });
  });

  it("grants the share of the real value in between", () => {
    const { stats } = flat(0.4);
    expect(stats.outgoing_damage).toBeCloseTo(0.06, 9);
    expect(stats.power).toBeCloseTo(40, 9);
  });

  it("grants the real value at a share of 1", () => {
    expect(flat(1).stats).toEqual({ outgoing_damage: 0.15, power: 100 });
  });

  it("reads the slot default when the build has no value", () => {
    const { stats } = bonusOf(
      buildWith({ "gear.ring1": "flat-ring" }),
      "flat-scaled",
    );
    expect(stats.outgoing_damage).toBeCloseTo(0.06, 9);
  });

  it("scales a player-typed dynamic stat along with the fixed ones", () => {
    const { stats } = bonusOf(
      buildWith({ "gear.ring1": "dynamic-ring" }, share(0.4)),
      "dynamic-scaled",
    );
    expect(stats.outgoing_damage).toBeCloseTo(0.04, 9);
    expect(stats.power).toBeCloseTo(100, 9);
  });

  it("leaves a grant naming an unknown scaler unscaled", () => {
    const { stats } = bonusOf(
      buildWith({ "gear.ring1": "stray-ring" }, share(0.4)),
      "stray-scaled",
    );
    expect(stats.outgoing_damage).toBe(0.1);
  });
});

describe("tier and variant payloads", () => {
  it("scales whichever tier wins", () => {
    const at = (count: number) =>
      bonusOf(
        buildWith({ "gear.ring1": "tier-ring" }, share(0.4), {
          "tier-ring": { "tier-scaled": count },
        }),
        "tier-scaled",
      ).stats.outgoing_damage;
    expect(at(1)).toBeCloseTo(0.088, 9);
    expect(at(5)).toBeCloseTo(0.12, 9);
  });

  it("scales whichever variant wins", () => {
    const as = (role: string) =>
      bonusOf(
        buildWith({ "gear.ring1": "variant-ring" }, { role, ...share(0.4) }),
        "variant-scaled",
      ).stats.outgoing_damage;
    expect(as("dps")).toBeCloseTo(0.04, 9);
    expect(as("tank")).toBeCloseTo(0.08, 9);
  });
});

describe("stacking on top of a scaled grant", () => {
  it("multiplies the scaled per-stack value by the source count", () => {
    const { stats, applied, stacks } = bonusOf(
      buildWith(
        { "gear.ring1": "stacked-ring", "gear.ring2": "stacked-ring" },
        share(0.4),
      ),
      "stacked-scaled",
    );
    expect(stacks).toBe(2);
    expect(stats.outgoing_damage).toBeCloseTo(0.04, 9);
    expect(applied.outgoing_damage).toBeCloseTo(0.08, 9);
  });
});

describe("catalog.validateScaledBy", () => {
  it("rejects a scaledBy naming no scaler parameter", () => {
    const findings = catalog.validateScaledBy(slotsData.slots, [strayBonus]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      level: "error",
      kind: "bonus",
      name: "stray-scaled",
    });
    expect(findings[0].message).toMatch(
      /grant 1: scaledBy names "scalers.missing"/,
    );
  });

  it("rejects a parameter that is not a scaler", () => {
    const plain: BuildParameterSlot = { ...shareParam, scaler: undefined };
    const findings = catalog.validateScaledBy([plain], [flatBonus]);
    expect(findings.map((f) => f.name)).toEqual(["flat-scaled"]);
  });

  it("accepts a scaledBy naming a declared scaler", () => {
    expect(
      catalog.validateScaledBy(slotsData.slots, [
        flatBonus,
        tierBonus,
        variantBonus,
      ]),
    ).toEqual([]);
  });

  it("accepts a scaler an overlay added to the shipped slots", () => {
    const added: BuildParameterSlot = {
      ...shareParam,
      id: "gear.aoeShare",
      path: "scalers.aoeDamage",
    };
    const reader: Bonus = {
      id: "reads-added",
      grants: [{ stats: { outgoing_damage: 0.1 }, scaledBy: added.path }],
    };
    const shipped = catalog.base().slots;
    expect(catalog.validateScaledBy(shipped, [reader])).toHaveLength(1);
    expect(catalog.validateScaledBy([...shipped, added], [reader])).toEqual([]);
  });

  it("is wired into validate()", () => {
    const findings = catalog.validate([], [strayBonus]);
    expect(
      findings.some(
        (f) => f.name === "stray-scaled" && /scaledBy names/.test(f.message),
      ),
    ).toBe(true);
  });
});

describe("GrantEvaluation.scale", () => {
  it("names the scaler and keeps the unscaled payload on an active scaled grant", () => {
    const [grant] = entryOf(
      buildWith({ "gear.ring1": "flat-ring" }, share(0.4)),
      "flat-scaled",
    ).grants;
    expect(grant.scale).toEqual({
      path: SCALER,
      label: "Encounter Damage",
      value: 0.4,
      multiplier: 0.4,
      unscaled: { outgoing_damage: 0.15, power: 100 },
    });
  });

  it("is present at a share of 0", () => {
    const [grant] = entryOf(
      buildWith({ "gear.ring1": "flat-ring" }, share(0)),
      "flat-scaled",
    ).grants;
    expect(grant.scale?.multiplier).toBe(0);
    expect(grant.stats).toEqual({ outgoing_damage: 0, power: 0 });
  });

  it("is carried by tier and variant grants", () => {
    const tier = entryOf(
      buildWith({ "gear.ring1": "tier-ring" }, share(0.4), {
        "tier-ring": { "tier-scaled": 5 },
      }),
      "tier-scaled",
    ).grants[0];
    expect(tier.scale).toMatchObject({
      multiplier: 0.4,
      unscaled: { outgoing_damage: 0.3 },
    });
    const variant = entryOf(
      buildWith({ "gear.ring1": "variant-ring" }, share(0.4)),
      "variant-scaled",
    ).grants[0];
    expect(variant.scale).toMatchObject({
      multiplier: 0.4,
      unscaled: { outgoing_damage: 0.1 },
    });
  });

  it("is absent from an unscaled grant and one naming an unknown scaler", () => {
    const plain = entryOf(
      buildWith({ "gear.ring1": "plain-ring" }, share(0.4)),
      "plain",
    ).grants[0];
    expect(plain).not.toHaveProperty("scale");
    const stray = entryOf(
      buildWith({ "gear.ring1": "stray-ring" }, share(0.4)),
      "stray-scaled",
    ).grants[0];
    expect(stray).not.toHaveProperty("scale");
  });

  it("stays on an inactive grant with no payload, and scales the bonus preview", () => {
    const entry = entryOf(
      buildWith({ "gear.ring1": "gated-ring" }, share(0.4)),
      "gated-scaled",
    );
    expect(entry.active).toBe(false);
    expect(entry.grants[0].scale).toMatchObject({
      multiplier: 0.4,
      unscaled: null,
    });
    expect(entry.previewStats?.outgoing_damage).toBeCloseTo(0.06, 9);
  });
});

describe("grantRows for a scaled grant", () => {
  const FACTOR = "x 40.00% Encounter Damage";

  it("shows the effective value with the real value and scaler under it", () => {
    const [row] = grantRows(
      entryOf(
        buildWith({ "gear.ring1": "flat-ring" }, share(0.4)),
        "flat-scaled",
      ),
      slotsData.slots,
    );
    expect(row.stats).toEqual([
      {
        key: "outgoing_damage",
        label: "Outgoing Damage",
        value: "+6.00%",
        note: `15.00% ${FACTOR}`,
      },
      { key: "power", label: "Power", value: "+40", note: `100 ${FACTOR}` },
    ]);
    expect(row.scale).toEqual({
      label: "Encounter Damage",
      factor: FACTOR,
      unset: false,
      slotId: "gear.encounterShare",
    });
  });

  it("keeps the row at a share of 0 and flags the share as unset with its slot", () => {
    const [row] = grantRows(
      entryOf(
        buildWith({ "gear.ring1": "flat-ring" }, share(0)),
        "flat-scaled",
      ),
      slotsData.slots,
    );
    expect(row.active).toBe(true);
    expect(row.stats?.[0]).toEqual({
      key: "outgoing_damage",
      label: "Outgoing Damage",
      value: "0.00%",
      note: "15.00% x 0.00% Encounter Damage",
    });
    expect(row.scale).toEqual({
      label: "Encounter Damage",
      factor: "x 0.00% Encounter Damage",
      unset: true,
      slotId: "gear.encounterShare",
    });
  });

  it("leaves the slot link out when no slot list is at hand", () => {
    const [row] = grantRows(
      entryOf(
        buildWith({ "gear.ring1": "flat-ring" }, share(0)),
        "flat-scaled",
      ),
    );
    expect(row.scale?.slotId).toBeNull();
  });

  it("gives no scale to an unscaled grant", () => {
    const [row] = grantRows(
      entryOf(buildWith({ "gear.ring1": "plain-ring" }, share(0.4)), "plain"),
      slotsData.slots,
    );
    expect(row.scale).toBeNull();
    expect(row.stats?.[0]).not.toHaveProperty("note");
  });

  it("multiplies the stack count on top of the scale, noting the per-stack real value", () => {
    const [row] = grantRows(
      entryOf(
        buildWith(
          { "gear.ring1": "stacked-ring", "gear.ring2": "stacked-ring" },
          share(0.4),
        ),
        "stacked-scaled",
      ),
      slotsData.slots,
    );
    expect(row.stats).toEqual([
      {
        key: "outgoing_damage",
        label: "Outgoing Damage",
        value: "+8.00%",
        note: `10.00% ${FACTOR}`,
      },
    ]);
  });

  it("keeps the tier ladder at the real values and captions it with the factor", () => {
    const [row] = grantRows(
      entryOf(
        buildWith({ "gear.ring1": "tier-ring" }, share(0.4), {
          "tier-ring": { "tier-scaled": 5 },
        }),
        "tier-scaled",
      ),
      slotsData.slots,
    );
    expect(
      row.tiers?.map((tier) => [tier.stats[0].value, tier.active]),
    ).toEqual([
      ["+22.00%", false],
      ["+30.00%", true],
    ]);
    expect(row.scale?.factor).toBe(FACTOR);
    // The live rung's effective line, which the inspector shows.
    expect(row.stats?.[0]).toMatchObject({
      value: "+12.00%",
      note: `30.00% ${FACTOR}`,
    });
  });

  it("keeps the variant ladder at the real values", () => {
    const [row] = grantRows(
      entryOf(
        buildWith({ "gear.ring1": "variant-ring" }, share(0.4)),
        "variant-scaled",
      ),
      slotsData.slots,
    );
    expect(row.variants?.map((v) => v.stats[0].value)).toEqual([
      "+10.00%",
      "+20.00%",
    ]);
    expect(row.scale?.factor).toBe(FACTOR);
  });

  it("previews an inactive scaled grant at the effective value, with the note", () => {
    const entry = entryOf(
      buildWith({ "gear.ring1": "gated-ring" }, share(0.4)),
      "gated-scaled",
    );
    const [row] = grantRows(entry, slotsData.slots);
    expect(row.active).toBe(false);
    expect(row.stats).toEqual([
      {
        key: "outgoing_damage",
        label: "Outgoing Damage",
        value: "+6.00%",
        note: `15.00% ${FACTOR}`,
      },
    ]);
    // The card's preview and the bonus-level one agree.
    expect(entry.previewStats?.outgoing_damage).toBeCloseTo(0.06, 9);
  });

  it("reaches the hover card rows with the slot list", () => {
    const entry = entryOf(
      buildWith({ "gear.ring1": "flat-ring" }, share(0)),
      "flat-scaled",
    );
    const [row] = itemCardRows(
      testDb.get("flat-ring")!,
      [entry],
      [],
      new Map(),
      slotsData.slots,
    );
    expect(row.grants[0].scale).toMatchObject({
      unset: true,
      slotId: "gear.encounterShare",
    });
  });
});
