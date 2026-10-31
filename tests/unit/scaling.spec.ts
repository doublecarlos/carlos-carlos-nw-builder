// Item stat scaling (mount/companion bolster).
//
// A synthetic catalog rather than the shipped one, so each claim is isolated from whatever
// the real mount data happens to be today. The shipped wiring is guarded by
// `catalog.validateScalerTargets`.

import { describe, it, expect } from "vitest";
import * as db from "../../src/data/db";
import * as catalog from "../../src/data/catalog";
import * as engine from "../../src/engine/engine";
import { collect } from "../../src/engine/bonus";
import { NW_ITEMS, NW_SLOTS } from "../../src/data/data";
import { storedListRows } from "../../src/lib/item-picker-list";
import {
  bonusOf,
  isActive,
  picker as testPicker,
  rowOf,
  testBuild,
  testDb as syntheticDb,
  testSchema,
  type Resolved,
  type TestBuildParts,
} from "./engine-fixtures";
import type {
  Build,
  BuildContext,
  Bonus,
  Item,
  ItemPickerSlot,
  BuildParameterSlot,
  Schema,
  SlotsData,
} from "../../src/types";

const schema: Schema = {
  stats: [
    { key: "il", label: "Item Level", kind: "flat" },
    { key: "power", label: "Power", kind: "rating" },
    { key: "incoming_damage", label: "Incoming Damage", kind: "mult" },
  ],
  statByKey: {
    il: { key: "il", label: "Item Level", kind: "flat" },
    power: { key: "power", label: "Power", kind: "rating" },
    incoming_damage: {
      key: "incoming_damage",
      label: "Incoming Damage",
      kind: "mult",
    },
  },
  statKeys: ["il", "power", "incoming_damage"],
  multiplicativeStats: ["incoming_damage"],
  ratingStats: [],
  abilityStats: [],
  ratingConversion: [],
  statContributions: [],
  forteSplit: {},
  roles: { dps: { label: "dps", hpBonus: 1, damageBonus: 1 } },
};

const mount: Item = {
  id: "test-mount",
  name: "Test Mount",
  filter: "test_mount",
  il: 1000,
  power: 200,
  // The mount's aura: granted, not carried. Attributed to this slot but not the item's to
  // scale.
  bonuses: ["mount-aura"],
};
const mountAura: Bonus = {
  id: "mount-aura",
  grants: [{ stats: { power: 100 } }],
};
/** Scaled by tag rather than filter, and mult-flavoured, to pin both rules at once. */
const companion: Item = {
  id: "test-companion",
  name: "Test Companion",
  filter: "test_companion",
  tags: ["bolstered_companion"],
  il: 500,
  incoming_damage: 0.1,
};
/** Nothing scales this: same section, no matching filter or tag. */
const collar: Item = {
  id: "test-collar",
  name: "Test Collar",
  filter: "test_collar",
  il: 300,
  power: 50,
};

const picker = (id: string, filter: string): ItemPickerSlot => ({
  id,
  label: id,
  section: "gear",
  type: "item_picker",
  filter,
});
const scalerParam = (
  id: string,
  path: string,
  fallback: number,
  scaler: BuildParameterSlot["scaler"],
): BuildParameterSlot => ({
  id,
  label: id,
  section: "gear",
  type: "build_parameter",
  paramType: "percent",
  path,
  default: fallback,
  min: 0,
  max: fallback,
  scaler,
});

const slotsData: SlotsData = {
  sections: [{ id: "gear", label: "Gear", slotIds: [] }],
  slots: [
    scalerParam("gear.mountBolster", "mountBolster", 1.25, {
      mode: "relative",
      applies: { filter: ["test_mount"] },
    }),
    scalerParam("gear.companionBolster", "companionBolster", 1.2, {
      mode: "relative",
      applies: { tags: ["bolstered_companion"] },
    }),
    // Claims no item: only reachable by an explicit reference.
    scalerParam("gear.encounterShare", "scalers.encounterDamage", 0.4, {
      mode: "absolute",
    }),
    picker("gear.mount", "test_mount"),
    picker("gear.companion", "test_companion"),
    picker("gear.collar", "test_collar"),
  ],
};

const testDb = db.build(
  [mount, companion, collar],
  [mountAura],
  schema,
  slotsData,
);

const CONTEXT = {
  class: "",
  role: "dps",
  damageType: "",
  duration: 60,
  enemies: 1,
  magnitude: 100,
  m32Forte: false,
  forte: {},
  toggles: {},
  mountBolster: 1.25,
  companionBolster: 1.2,
} as unknown as BuildContext;

function buildWith(
  choices: Record<string, string>,
  context: Partial<BuildContext> = {},
): Build {
  return {
    id: "b",
    name: "b",
    choices,
    values: {},
    assignments: {},
    listRows: storedListRows({
      choices,
      values: {},
      assignments: {},
      disabledSlots: {},
    }),
    context: { ...CONTEXT, ...context },
    compare: { id: "", highlight: false, onlyDiff: false, statLines: false },
  } as unknown as Build;
}

const EQUIPPED = {
  "gear.mount": "test-mount",
  "gear.companion": "test-companion",
  "gear.collar": "test-collar",
};

describe("bolster scaling", () => {
  it("scales a matching item's whole stat line by 1 + bolster", () => {
    const result = engine.resolveBuild(testDb, buildWith(EQUIPPED));
    const row = result.rows.find((r) => r.slotId === "gear.mount")!;
    expect(row.stats.il).toBeCloseTo(1000 * 2.25, 9);
    expect(row.stats.power).toBeCloseTo(200 * 2.25 + 100, 9); // +100: the aura, unscaled
  });

  it("contributes exactly the base values at 0%", () => {
    const result = engine.resolveBuild(
      testDb,
      buildWith(EQUIPPED, { mountBolster: 0 }),
    );
    const row = result.rows.find((r) => r.slotId === "gear.mount")!;
    expect(row.stats.il).toBe(1000);
  });

  it("interpolates linearly between the two", () => {
    const result = engine.resolveBuild(
      testDb,
      buildWith(EQUIPPED, { mountBolster: 0.6 }),
    );
    const row = result.rows.find((r) => r.slotId === "gear.mount")!;
    expect(row.stats.il).toBeCloseTo(1600, 9);
  });

  it("leaves a bonus attributed to the same slot unscaled", () => {
    const full = engine.resolveBuild(testDb, buildWith(EQUIPPED));
    const none = engine.resolveBuild(
      testDb,
      buildWith(EQUIPPED, { mountBolster: 0 }),
    );
    // The aura is the difference between the two rows' power minus the item's own scaling:
    // it contributes the same 100 either way.
    expect(full.rows.find((r) => r.slotId === "gear.mount")!.stats.power).toBe(
      200 * 2.25 + 100,
    );
    expect(none.rows.find((r) => r.slotId === "gear.mount")!.stats.power).toBe(
      200 + 100,
    );
  });

  it("only touches the items a scaler's selector claims", () => {
    const result = engine.resolveBuild(
      testDb,
      buildWith(EQUIPPED, { mountBolster: 0, companionBolster: 0 }),
    );
    const collarRow = result.rows.find((r) => r.slotId === "gear.collar")!;
    // The collar shares a section with both, and neither scaler names it.
    expect(collarRow.stats.il).toBe(300);
    expect(collarRow.stats.power).toBe(50);
  });

  it("keeps the two bolsters independent", () => {
    const result = engine.resolveBuild(
      testDb,
      buildWith(EQUIPPED, { mountBolster: 0 }),
    );
    expect(result.rows.find((r) => r.slotId === "gear.mount")!.stats.il).toBe(
      1000,
    );
    expect(
      result.rows.find((r) => r.slotId === "gear.companion")!.stats.il,
    ).toBeCloseTo(500 * 2.2, 9);
  });

  it("selects by tag as well as by filter", () => {
    const result = engine.resolveBuild(testDb, buildWith(EQUIPPED));
    // The companion scaler names a tag, not `test_companion`.
    expect(
      result.rows.find((r) => r.slotId === "gear.companion")!.stats.il,
    ).toBeCloseTo(1100, 9);
  });

  it("scales a multiplicative stat like any other on the line", () => {
    const result = engine.resolveBuild(testDb, buildWith(EQUIPPED));
    expect(
      result.rows.find((r) => r.slotId === "gear.companion")!.stats
        .incoming_damage,
    ).toBeCloseTo(0.1 * 2.2, 9);
  });

  it("falls back to the parameter's declared default when the build has no value", () => {
    const result = engine.resolveBuild(
      testDb,
      buildWith(EQUIPPED, { mountBolster: undefined as unknown as number }),
    );
    // Missing reads as the slot's own default (1.25), not as zero: a build predating the
    // parameter must not silently lose its mount's stats.
    expect(result.rows.find((r) => r.slotId === "gear.mount")!.stats.il).toBe(
      2250,
    );
  });

  it("flags a bolster outside its declared range without clamping it", () => {
    const result = engine.resolveBuild(
      testDb,
      buildWith(EQUIPPED, { mountBolster: 10 }),
    );
    const error = result.errors.find(
      (e) => e.slotId === "gear.mountBolster" && e.kind === "outOfRange",
    );
    expect(error, "no range error for an out-of-range bolster").toBeTruthy();
    // Reported, not rewritten: the number someone typed is still the number that applies.
    expect(
      result.rows.find((r) => r.slotId === "gear.mount")!.stats.il,
    ).toBeCloseTo(11000, 9);
  });

  it("accepts a bolster at either end of its range", () => {
    for (const mountBolster of [0, 1.25]) {
      const result = engine.resolveBuild(
        testDb,
        buildWith(EQUIPPED, { mountBolster }),
      );
      expect(
        result.errors.filter((e) => e.slotId === "gear.mountBolster"),
        `${mountBolster} should be in range`,
      ).toEqual([]);
    }
  });

  it("treats an unreadable bolster as unscaled rather than NaN", () => {
    const result = engine.resolveBuild(
      testDb,
      buildWith(EQUIPPED, { mountBolster: "nonsense" as unknown as number }),
    );
    const row = result.rows.find((r) => r.slotId === "gear.mount")!;
    expect(Number.isNaN(row.stats.il)).toBe(false);
    expect(row.stats.il).toBe(1000);
  });
});

describe("resolved scaler map", () => {
  const scalersOf = (context: Record<string, unknown> = {}) =>
    collect(testDb, buildWith(EQUIPPED, context as Partial<BuildContext>)).ctx
      .scalers;

  it("resolves a relative scaler to 1 + value", () => {
    const scaler = scalersOf({ mountBolster: 0.6 }).get("mountBolster")!;
    expect(scaler.mode).toBe("relative");
    expect(scaler.value).toBe(0.6);
    expect(scaler.multiplier).toBeCloseTo(1.6, 9);
    expect(scaler.label).toBe("gear.mountBolster");
  });

  it("resolves an absolute scaler to its value as-is", () => {
    const scaler = scalersOf({ scalers: { encounterDamage: 0.25 } }).get(
      "scalers.encounterDamage",
    )!;
    expect(scaler.mode).toBe("absolute");
    expect(scaler.value).toBe(0.25);
    expect(scaler.multiplier).toBe(0.25);
  });

  it("reads the slot default when the build has no value", () => {
    expect(scalersOf().get("scalers.encounterDamage")!.multiplier).toBe(0.4);
  });

  it("pins an unreadable relative value to x1", () => {
    const scaler = scalersOf({ mountBolster: "nonsense" }).get("mountBolster")!;
    expect(scaler.value).toBe(0);
    expect(scaler.multiplier).toBe(1);
  });

  it("pins an unreadable absolute value to the slot default", () => {
    const scaler = scalersOf({ scalers: { encounterDamage: "nonsense" } }).get(
      "scalers.encounterDamage",
    )!;
    expect(scaler.value).toBe(0.4);
    expect(scaler.multiplier).toBe(0.4);
  });

  it("leaves every item alone through a scaler with no applies", () => {
    const result = engine.resolveBuild(
      testDb,
      buildWith(EQUIPPED, { mountBolster: 0, companionBolster: 0 }),
    );
    for (const slotId of ["gear.mount", "gear.companion", "gear.collar"]) {
      const row = result.rows.find((r) => r.slotId === slotId)!;
      expect(row.stats.il).toBe(row.item!.il);
    }
  });
});

// A scaler's `applies` is the only link from a bolster to its items, so a filter or tag
// nothing carries means a category silently stopped scaling.
describe("catalog.validateScalerTargets", () => {
  it("passes on the shipped catalog", () => {
    expect(catalog.validateScalerTargets(NW_SLOTS.slots, NW_ITEMS)).toEqual([]);
  });

  it("passes when every target is carried", () => {
    expect(
      catalog.validateScalerTargets(slotsData.slots, [
        mount,
        companion,
        collar,
      ]),
    ).toEqual([]);
  });

  it("warns about a filter and a tag no item carries", () => {
    const findings = catalog.validateScalerTargets(slotsData.slots, [collar]);
    expect(findings.map((f) => [f.level, f.name])).toEqual([
      ["warn", "gear.mountBolster"],
      ["warn", "gear.companionBolster"],
    ]);
    expect(findings[0].message).toMatch(/filter "test_mount"/);
    expect(findings[1].message).toMatch(/tag "bolstered_companion"/);
  });

  it("ignores a scaler without applies", () => {
    // gear.encounterShare claims no item by design.
    const findings = catalog.validateScalerTargets(slotsData.slots, []);
    expect(findings.some((f) => f.name === "gear.encounterShare")).toBe(false);
  });
});

// An aura mount equip comes in two parts: your own copy is a scaled item stat line, and a
// party member's copy is a group bonus. The group bonus is gated off while you have your own,
// so the two never double count, and it stays at a fixed payload since a stranger's bolster
// is unknown.
describe("aura mount equips carry their own payload", () => {
  const SELF_SLOT = "mounts.equip";
  const GROUP_SLOT = "group.buff";

  const auraDb = syntheticDb(
    testSchema(["il", "power", "ca"]),
    [
      { id: "aura-self", name: "Aura", filter: "mount_equip", power: 1000 },
      {
        id: "aura-group",
        name: "Aura",
        filter: "group_buff",
        bonuses: ["aura-group"],
      },
      { id: "pack-self", name: "Pack", filter: "mount_equip", ca: 1000 },
      {
        id: "pack-group",
        name: "Pack",
        filter: "group_buff",
        bonuses: ["pack"],
      },
    ],
    [
      {
        id: "aura-group",
        grants: [
          {
            when: {
              toggle: "party",
              not: { equipped: { item: "aura-self" } },
            },
            stats: { power: 2000 },
          },
        ],
      },
      // Each contributor adds half the one before. Owning one makes you the first
      // contributor, and your share is already your item's stat line.
      {
        id: "pack",
        inputs: {
          stacks: {
            type: "number",
            label: "Stacks",
            min: 0,
            max: 4,
            default: 1,
          },
        },
        formulas: {
          self: { formula: 'min(equipped("pack-self"), 1)' },
        },
        grants: [
          {
            when: { toggle: "party" },
            stats: { ca: 2000 },
            scale: { formula: "geometric($stacks + $self, 0.5) - $self" },
          },
        ],
      },
    ],
    [
      scalerParam("mounts.bolster", "mountBolster", 1.25, {
        mode: "relative",
        applies: { filter: ["mount_equip"] },
      }),
      testPicker(SELF_SLOT, "mount_equip"),
      testPicker(GROUP_SLOT, "group_buff"),
    ],
  );

  function run(
    choices: Record<string, string>,
    context: TestBuildParts["context"] = {},
    bonusValues: Build["bonusValues"] = {},
  ) {
    return engine.resolveBuild(
      auraDb,
      testBuild({
        choices,
        bonusValues,
        context: { toggles: { party: true }, mountBolster: 1.25, ...context },
      }),
    );
  }

  const selfRow = (result: Resolved) => rowOf(result, SELF_SLOT);
  const groupPower = (result: Resolved) =>
    bonusOf(result, "aura-group")?.stats?.power;

  it("scales your own aura with mount bolster", () => {
    expect(selfRow(run({ [SELF_SLOT]: "aura-self" })).stats.power).toBeCloseTo(
      1000 * 2.25,
      9,
    );
    expect(
      selfRow(run({ [SELF_SLOT]: "aura-self" }, { mountBolster: 0 })).stats
        .power,
    ).toBe(1000);
  });

  it("suppresses the group aura while you have the self item, so it cannot double", () => {
    const both = run({ [SELF_SLOT]: "aura-self", [GROUP_SLOT]: "aura-group" });
    expect(isActive(both, "aura-group")).toBe(false);
    // Your own copy is still there, as the item's stats.
    expect(selfRow(both).stats.power).toBeCloseTo(1000 * 2.25, 9);
  });

  it("grants the group aura when a party member supplies it instead", () => {
    const theirs = run({ [GROUP_SLOT]: "aura-group" });
    expect(isActive(theirs, "aura-group")).toBe(true);
    expect(groupPower(theirs)).toBe(2000);
  });

  it("leaves a party member's aura alone whatever your bolster is", () => {
    expect(
      groupPower(run({ [GROUP_SLOT]: "aura-group" }, { mountBolster: 0 })),
    ).toBe(2000);
  });

  it("needs the party toggle, since a group buff is not a solo effect", () => {
    const solo = run(
      { [GROUP_SLOT]: "aura-group" },
      { toggles: { party: false } },
    );
    expect(isActive(solo, "aura-group")).toBe(false);
  });

  const twoOthers = { pack: { input: { stacks: 2 } } };

  it("a stacking group aura without your own is the others' pool alone", () => {
    const result = run({ [GROUP_SLOT]: "pack-group" }, {}, twoOthers);
    // 2000 for the first, half as much for the second.
    expect(bonusOf(result, "pack")?.stats?.ca).toBe(3000);
  });

  it("a stacking group aura with your own adds only the pool's remainder", () => {
    const result = run(
      { [SELF_SLOT]: "pack-self", [GROUP_SLOT]: "pack-group" },
      {},
      twoOthers,
    );
    // Three contributors pool 3500; your first share is your item, leaving 1500.
    expect(bonusOf(result, "pack")?.stats?.ca).toBe(1500);
    // The bonus anchors to the group item's slot; the mount row carries only its own stats.
    expect(selfRow(result).stats.ca).toBeCloseTo(1000 * 2.25, 9);
    expect(rowOf(result, GROUP_SLOT).stats.ca).toBeCloseTo(1500, 9);
  });

  it("your own stacking aura alone is just the item, no bonus at all", () => {
    const result = run({ [SELF_SLOT]: "pack-self" });
    expect(isActive(result, "pack")).toBe(false);
    expect(selfRow(result).stats.ca).toBeCloseTo(1000 * 2.25, 9);
  });
});
