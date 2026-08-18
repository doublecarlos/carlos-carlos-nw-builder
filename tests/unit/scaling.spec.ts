// Item stat scaling (mount/companion bolster) -- issue #286.
//
// A synthetic catalogue rather than the shipped one, so each claim is isolated from whatever
// the real mount data happens to be today. The shipped wiring gets its own check at the bottom.

import { describe, it, expect } from "vitest";
import * as db from "../../src/data/db";
import * as engine from "../../src/engine/engine";
import { NW_SCHEMA } from "../../src/data/data";
import { fromData } from "../../src/data/db";
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
  abilityContributions: [],
  forteSplit: {},
  roles: { dps: { label: "dps", hpBonus: 1, damageBonus: 1 } },
  statScalers: [
    {
      id: "mount_bolster",
      label: "Mount bolster",
      param: "mountBolster",
      applies: { filter: ["test_mount"] },
    },
    {
      id: "companion_bolster",
      label: "Companion bolster",
      param: "companionBolster",
      applies: { tags: ["bolstered_companion"] },
    },
  ],
};

const mount: Item = {
  id: "test-mount",
  name: "Test Mount",
  filter: "test_mount",
  il: 1000,
  power: 200,
  // The mount's aura: granted, not carried. Attributed to this slot but not the item's to
  // scale -- issue #287.
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
const bolsterParam = (
  id: string,
  path: string,
  fallback: number,
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
});

const slotsData: SlotsData = {
  sections: [{ id: "gear", label: "Gear" }],
  slots: [
    bolsterParam("gear.mountBolster", "mountBolster", 1.25),
    bolsterParam("gear.companionBolster", "companionBolster", 1.2),
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
    occurrenceInputs: {},
    context: { ...CONTEXT, ...context },
    compare: { id: "", highlight: false, onlyDiff: false },
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

  it("never scales a multiplicative stat", () => {
    const result = engine.resolveBuild(testDb, buildWith(EQUIPPED));
    // Multiplicative stats combine as (1 + v) products, so scaling the stored value would
    // compound rather than scale the effect it stands for.
    expect(
      result.rows.find((r) => r.slotId === "gear.companion")!.stats
        .incoming_damage,
    ).toBe(0.1);
  });

  it("falls back to the parameter's declared default when the build has no value", () => {
    const result = engine.resolveBuild(
      testDb,
      buildWith(EQUIPPED, { mountBolster: undefined as unknown as number }),
    );
    // Missing reads as the slot's own default (1.25), not as zero -- a build predating the
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

describe("shipped bolster wiring", () => {
  const shipped = fromData();

  it("declares a scaler per bolster parameter, and a slot for each", () => {
    const paths = NW_SCHEMA.statScalers.map((s) => s.param);
    expect(paths).toEqual(["mountBolster", "companionBolster"]);
    for (const path of paths) {
      const slot = shipped.slots.find(
        (s) => s.type === "build_parameter" && s.path === path,
      );
      expect(slot, `no build_parameter slot for ${path}`).toBeTruthy();
    }
  });

  it("scales every mount and companion item, and nothing else", () => {
    const scaled = new Set(
      NW_SCHEMA.statScalers.flatMap((s) => s.applies.filter ?? []),
    );
    expect([...scaled].sort()).toEqual([
      "companion",
      "mount_combat",
      "mount_equip",
    ]);
    // Collars and insignia sit in the same sections and are explicitly out of scope.
    expect(scaled.has("insignia")).toBe(false);
    expect(scaled.has("sturdy_collar")).toBe(false);
    expect(scaled.has("companion_equip")).toBe(false);
  });

  it("holds unscaled base values in the catalogue", () => {
    // The db was normalised (#286): a mount equip is 1750 IL, not the 3937 the sheet stored
    // pre-multiplied by max bolster.
    const equips = shipped.forFilter("mount_equip");
    expect(equips.length).toBeGreaterThan(0);
    for (const item of equips) expect(item.il).toBe(1750);
    expect(shipped.get("generic-companion")?.il).toBe(1800);
  });
});

// The mount equip powers whose whole effect used to be a granted aura now carry that payload
// as their own stat line, leaving the bonus to stand for a *party member's* copy alone
// (#287, folded into #286). What makes that work is the gate: the group bonus is suppressed
// while you have the self item, so the two can never double-count -- and because it only ever
// represents someone else's mount, its payload stays at max bolster, which is the most anyone
// can know about a stranger's collection.
describe("aura mount equips carry their own payload", () => {
  const shipped = fromData();

  const SELF_SLOT = "mounts.mountEquip";
  const GROUP_SLOT = "group.group1";

  function run(
    choices: Record<string, string>,
    context: Record<string, unknown> = {},
    occurrenceInputs: Record<string, Record<string, number>> = {},
  ) {
    return engine.resolveBuild(shipped, {
      id: "b",
      name: "b",
      choices,
      values: {},
      assignments: {},
      occurrenceInputs,
      context: {
        class: "",
        role: "dps",
        damageType: "",
        duration: 60,
        enemies: 1,
        magnitude: 100,
        m32Forte: false,
        forte: {},
        toggles: { party: true },
        mountBolster: 1.25,
        companionBolster: 1.2,
        ...context,
      },
      compare: { id: "", highlight: false, onlyDiff: false },
    } as unknown as Build);
  }

  const selfRow = (result: ReturnType<typeof run>) =>
    result.rows.find((r) => r.slotId === SELF_SLOT)!;
  const isActive = (result: ReturnType<typeof run>, id: string) =>
    result.bonuses.some((b) => b.id === id && b.active);

  it("scales your own Mystic Aura with mount bolster", () => {
    const max = run({ [SELF_SLOT]: "mystic-aura-self" });
    expect(selfRow(max).stats.power).toBeCloseTo(1312.5 * 2.25, 9);

    const none = run({ [SELF_SLOT]: "mystic-aura-self" }, { mountBolster: 0 });
    expect(selfRow(none).stats.power).toBe(1312.5);
  });

  it("suppresses the group aura while you have the self item, so it cannot double", () => {
    const both = run({
      [SELF_SLOT]: "mystic-aura-self",
      [GROUP_SLOT]: "mystic-aura-group-celestial",
    });
    expect(isActive(both, "mystic-aura-group-celestial")).toBe(false);
    // Your own copy is still there -- as the item's stats, not the bonus.
    expect(selfRow(both).stats.power).toBeCloseTo(1312.5 * 2.25, 9);
  });

  it("grants the group aura when a party member supplies it instead", () => {
    const theirs = run({ [GROUP_SLOT]: "mystic-aura-group-celestial" });
    expect(isActive(theirs, "mystic-aura-group-celestial")).toBe(true);
    const entry = theirs.bonuses.find(
      (b) => b.id === "mystic-aura-group-celestial",
    )!;
    expect(entry.stats?.power).toBe(2953);
  });

  it("leaves a party member's aura at max bolster, whatever yours is", () => {
    const theirs = run(
      { [GROUP_SLOT]: "mystic-aura-group-celestial" },
      { mountBolster: 0 },
    );
    // You cannot know a stranger's collection, so their copy does not move with your bolster.
    expect(
      theirs.bonuses.find((b) => b.id === "mystic-aura-group-celestial")?.stats
        ?.power,
    ).toBe(2953);
  });

  it("needs the party toggle -- a group buff is not a solo effect", () => {
    const solo = run(
      { [GROUP_SLOT]: "mystic-aura-group-celestial" },
      { toggles: { party: false } },
    );
    expect(isActive(solo, "mystic-aura-group-celestial")).toBe(false);
  });

  it("does the same for Runic Aura", () => {
    const mine = run({ [SELF_SLOT]: "runic-aura" });
    expect(selfRow(mine).stats.defense).toBeCloseTo(1312.5 * 2.25, 9);
    expect(isActive(mine, "runic-aura-group-celestial")).toBe(false);
  });

  it("Pack Tactics: without your own, the ladder is the others' pool alone", () => {
    // Two other players contributing, you not among them.
    const result = run(
      { [GROUP_SLOT]: "pack-tactics-group" },
      {},
      { "pack-tactics-group": { "pack-tactics": 2 } },
    );
    expect(result.bonuses.find((b) => b.id === "pack-tactics")?.stats?.ca).toBe(
      4429,
    );
  });

  it("Pack Tactics: with your own, the others add the pool's remainder", () => {
    const result = run(
      {
        [SELF_SLOT]: "pack-tactics-self",
        [GROUP_SLOT]: "pack-tactics-group",
      },
      {},
      { "pack-tactics-group": { "pack-tactics": 2 } },
    );
    // Three contributors in total: the pool is 5167, of which your 2953-equivalent share is
    // the item's own (scaled) stat line, leaving 2214 for the other two.
    expect(result.bonuses.find((b) => b.id === "pack-tactics")?.stats?.ca).toBe(
      2214,
    );
    // The mount row carries its own stats and nothing else: only the group item attaches the
    // bonus now, so that is the slot it anchors to (bonus.ts's `anchor.slotId`).
    expect(selfRow(result).stats.ca).toBeCloseTo(1312.5 * 2.25, 9);
    expect(
      result.rows.find((r) => r.slotId === GROUP_SLOT)!.stats.ca,
    ).toBeCloseTo(2214, 9);
  });

  it("Pack Tactics: your own alone is just the item, no bonus at all", () => {
    const result = run({ [SELF_SLOT]: "pack-tactics-self" });
    expect(isActive(result, "pack-tactics")).toBe(false);
    expect(selfRow(result).stats.ca).toBeCloseTo(1312.5 * 2.25, 9);
  });
});
