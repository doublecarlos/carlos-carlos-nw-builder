// Conditional slots: a slot whose `availableWhen` fails is hidden and holds nothing. These pin
// the prune that enforces it, the engine's safety net, and the load-time checks on authoring.
import { afterEach, describe, expect, it, vi } from "vitest";
import * as db from "../../src/data/db";
import * as engine from "../../src/engine/engine";
import * as catalog from "../../src/data/catalog";
import { checkSlotAvailability } from "../../src/data/catalog";
import { rowSlot } from "../../src/lib/item-picker-list";
import {
  clearSlotContents,
  pruneUnavailableSlots,
  slotShown,
  slotsWithCompare,
} from "../../src/lib/slot-availability";
import type {
  Bonus,
  Build,
  Item,
  ItemPickerListSlot,
  ItemPickerSlot,
  Schema,
  Slot,
} from "../../src/types";

const schema: Schema = {
  stats: [{ key: "power", label: "Power", kind: "int" }],
  statByKey: { power: { key: "power", label: "Power", kind: "int" } },
  statKeys: ["power"],
  multiplicativeStats: [],
  ratingStats: [],
  abilityStats: [],
  ratingConversion: [],
  statContributions: [],
  forteSplit: {},
  roles: { dps: { label: "DPS", hpBonus: 1, damageBonus: 1.2 } },
};

const items: Item[] = [
  { id: "relic", name: "Relic", filter: "weapons", tags: ["artifact"] },
  { id: "stick", name: "Stick", filter: "weapons" },
  {
    id: "mod",
    name: "Mod",
    filter: "mods",
    tags: ["modded"],
    power: 50,
    bonuses: ["mod-bonus"],
    dynamicStats: [{ stat: "power", min: 0, max: 100, default: 10 }],
  },
  { id: "gem", name: "Gem", filter: "gems", power: 7 },
  { id: "charm", name: "Charm", filter: "charms", power: 3 },
  { id: "mirror", name: "Mirror", filter: "mirrors", tags: ["shiny"] },
];

const bonuses: Bonus[] = [
  {
    id: "mod-bonus",
    name: "Mod bonus",
    inputs: { stacks: { type: "number", min: 0, max: 3, default: 1 } },
    grants: [{ stats: { power: 100 } }],
  },
];

const weaponSlot: ItemPickerSlot = {
  id: "gear.weapon",
  label: "Weapon",
  section: "gear",
  type: "item_picker",
  filter: "weapons",
};
const modSlot: ItemPickerSlot = {
  id: "gear.mod",
  label: "Weapon mod",
  section: "gear",
  type: "item_picker",
  filter: "mods",
  toggleable: true,
  availableWhen: { equipped: { tag: "artifact" } },
};
/** Gated on the mod, so emptying the mod slot hides this one too. */
const socketSlot: ItemPickerSlot = {
  id: "gear.socket",
  label: "Mod socket",
  section: "gear",
  type: "item_picker",
  filter: "gems",
  availableWhen: { equipped: { tag: "modded" } },
};
const charmList: ItemPickerListSlot = {
  id: "gear.charms",
  label: "Charm",
  section: "gear",
  type: "item_picker_list",
  filter: "charms",
  availableWhen: { equipped: { tag: "artifact" } },
};
/** Reads its own pick: available only while it already holds the mirror. */
const mirrorSlot: ItemPickerSlot = {
  id: "gear.mirror",
  label: "Mirror",
  section: "gear",
  type: "item_picker",
  filter: "mirrors",
  availableWhen: { equipped: { tag: "shiny" } },
};

const slots: Slot[] = [weaponSlot, modSlot, socketSlot, charmList, mirrorSlot];

const testDb = db.build(items, bonuses, schema, {
  sections: [{ id: "gear", label: "Gear", slotIds: [] }],
  slots,
  presets: [],
});

/** An artifact build with every conditional slot filled. */
function filledBuild(overrides: Partial<Build> = {}): Build {
  return {
    id: "b",
    name: "b",
    choices: {
      "gear.weapon": "relic",
      "gear.mod": "mod",
      "gear.socket": "gem",
      "gear.charms#1": "charm",
      "gear.charms#2": "charm",
    },
    values: { "gear.mod": { stat: { power: 40 } } },
    bonusValues: { "mod-bonus": { input: { stacks: 3 } } },
    assignments: {},
    listRows: { "gear.charms": 2 },
    disabledSlots: {},
    context: { role: "dps" } as Build["context"],
    compare: { id: "", highlight: false, onlyDiff: false, statLines: false },
    ...overrides,
  };
}

/** The same build after swapping the artifact for a plain weapon, nothing else touched. */
const staleBuild = (overrides: Partial<Build> = {}) => {
  const build = filledBuild(overrides);
  build.choices["gear.weapon"] = "stick";
  return build;
};

describe("pruneUnavailableSlots", () => {
  it("clears nothing while every condition holds", () => {
    const build = filledBuild();
    const result = pruneUnavailableSlots(testDb, build);
    expect(result.build).toBe(build);
    expect(result.cleared).toEqual([]);
    expect([...result.hidden]).toEqual(["gear.mirror"]);
  });

  it("empties a hidden slot's pick, values and off state", () => {
    const { build, cleared } = pruneUnavailableSlots(
      testDb,
      staleBuild({ disabledSlots: { "gear.mod": true } }),
    );
    expect(cleared).toContain("gear.mod");
    expect(build.choices["gear.mod"]).toBeUndefined();
    expect(build.values["gear.mod"]).toBeUndefined();
    expect(build.disabledSlots["gear.mod"]).toBeUndefined();
    expect(build.choices["gear.weapon"]).toBe("stick");
  });

  it("keeps the bonus settings, as a cleared slot always does", () => {
    const { build } = pruneUnavailableSlots(testDb, staleBuild());
    expect(build.bonusValues["mod-bonus"]).toEqual({ input: { stacks: 3 } });
  });

  it("follows a chain: emptying one slot hides the one gated on it", () => {
    const { build, cleared, hidden } = pruneUnavailableSlots(
      testDb,
      staleBuild(),
    );
    // The socket still had its gate met on the first pass, by the mod being cleared.
    expect(cleared).toEqual(["gear.mod", "gear.charms", "gear.socket"]);
    expect(build.choices["gear.socket"]).toBeUndefined();
    expect([...hidden].sort()).toEqual([
      "gear.charms",
      "gear.mirror",
      "gear.mod",
      "gear.socket",
    ]);
  });

  it("drops a list's rows and its row count", () => {
    const { build } = pruneUnavailableSlots(testDb, staleBuild());
    expect(build.choices["gear.charms#1"]).toBeUndefined();
    expect(build.choices["gear.charms#2"]).toBeUndefined();
    expect(build.listRows["gear.charms"]).toBeUndefined();
  });

  it("leaves the build it was handed untouched", () => {
    const stale = staleBuild();
    const before = JSON.stringify(stale);
    pruneUnavailableSlots(testDb, stale);
    expect(JSON.stringify(stale)).toBe(before);
  });

  it("is idempotent", () => {
    const once = pruneUnavailableSlots(testDb, staleBuild());
    const twice = pruneUnavailableSlots(testDb, once.build);
    expect(twice.build).toBe(once.build);
    expect(twice.cleared).toEqual([]);
    expect([...twice.hidden]).toEqual([...once.hidden]);
  });

  it("keeps a slot that reads its own pick hidden once it is empty", () => {
    // Holding the mirror meets its own gate, so it stays; nothing can ever put it back.
    const holding = filledBuild();
    holding.choices["gear.mirror"] = "mirror";
    expect(
      pruneUnavailableSlots(testDb, holding).hidden.has("gear.mirror"),
    ).toBe(false);
    expect(
      pruneUnavailableSlots(testDb, filledBuild()).hidden.has("gear.mirror"),
    ).toBe(true);
  });

  it("does not report an empty hidden slot as cleared", () => {
    const build = filledBuild({
      choices: { "gear.weapon": "stick" },
      values: {},
      listRows: {},
      disabledSlots: {},
    });
    const result = pruneUnavailableSlots(testDb, build);
    expect(result.cleared).toEqual([]);
    expect(result.build).toBe(build);
  });
});

describe("pruneUnavailableSlots: nested slots", () => {
  /** Nested under the conditional mod slot, with no condition of its own. */
  const plainChild: ItemPickerSlot = {
    id: "gear.gem",
    label: "Gem",
    section: "gear",
    type: "item_picker",
    filter: "gems",
    parent: "gear.mod",
  };
  /** Nested too, with a condition that holds for a plain weapon. */
  const gatedChild: ItemPickerSlot = {
    id: "gear.charm",
    label: "Charm",
    section: "gear",
    type: "item_picker",
    filter: "charms",
    parent: "gear.mod",
    availableWhen: { equipped: { item: "stick" } },
  };
  const nestedDb = db.build(items, bonuses, schema, {
    sections: [{ id: "gear", label: "Gear", slotIds: [] }],
    slots: [weaponSlot, modSlot, plainChild, gatedChild],
    presets: [],
  });
  const nestedBuild = (weapon: string) =>
    filledBuild({
      choices: {
        "gear.weapon": weapon,
        "gear.mod": "mod",
        "gear.gem": "gem",
        "gear.charm": "charm",
      },
    });

  it("hides and empties every child while the parent is unavailable", () => {
    const { build, cleared, hidden } = pruneUnavailableSlots(
      nestedDb,
      nestedBuild("stick"),
    );
    expect([...hidden].sort()).toEqual(["gear.charm", "gear.gem", "gear.mod"]);
    expect(cleared.sort()).toEqual(["gear.charm", "gear.gem", "gear.mod"]);
    expect(build.choices["gear.gem"]).toBeUndefined();
    expect(build.choices["gear.charm"]).toBeUndefined();
  });

  it("still applies a child's own condition while the parent is available", () => {
    const { build, hidden } = pruneUnavailableSlots(
      nestedDb,
      nestedBuild("relic"),
    );
    expect([...hidden]).toEqual(["gear.charm"]);
    expect(build.choices["gear.gem"]).toBe("gem");
  });
});

describe("clearSlotContents", () => {
  it("empties every row of a list in place", () => {
    const build = filledBuild();
    clearSlotContents(build, charmList);
    expect(build.choices["gear.charms#1"]).toBeUndefined();
    expect(build.listRows["gear.charms"]).toBeUndefined();
    expect(build.choices["gear.mod"]).toBe("mod");
  });
});

describe("slotShown", () => {
  it("hides a list's rows along with the list", () => {
    const hidden = new Set(["gear.charms"]);
    expect(slotShown(charmList, hidden)).toBe(false);
    expect(slotShown(rowSlot(charmList, 1), hidden)).toBe(false);
    expect(slotShown(weaponSlot, hidden)).toBe(true);
  });
});

describe("the engine's prune", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resolves a stale hidden value exactly as the pruned build", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const stale = engine.resolveBuild(testDb, staleBuild());
    const pruned = engine.resolveBuild(
      testDb,
      pruneUnavailableSlots(testDb, staleBuild()).build,
    );
    expect(stale.stages.totals).toEqual(pruned.stages.totals);
    expect(stale.bonuses.map((entry) => entry.id)).toEqual(
      pruned.bonuses.map((entry) => entry.id),
    );
    expect(stale.stages.totals.power).toBe(0);
    expect([...stale.hiddenSlots]).toEqual([...pruned.hiddenSlots]);
  });

  it("warns when it had to clear something a store saved", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    engine.resolveBuild(testDb, staleBuild());
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("gear.mod"));
    warn.mockClear();
    engine.resolveBuild(testDb, filledBuild());
    expect(warn).not.toHaveBeenCalled();
  });

  it("prunes the bonus-only resolution too", () => {
    const { bonuses: resolved } = engine.resolveBonuses(testDb, staleBuild());
    expect(resolved.some((entry) => entry.id === "mod-bonus")).toBe(false);
  });
});

describe("load validation", () => {
  const refs = { items, bonuses, slots };

  it("accepts a well-formed condition", () => {
    expect(checkSlotAvailability(modSlot, refs)).toEqual([]);
  });

  it("rejects a default, which would refill the hidden slot", () => {
    const errors = checkSlotAvailability({ ...modSlot, default: "mod" }, refs);
    expect(errors).toEqual([expect.stringContaining("cannot have a default")]);
  });

  it("rejects leaves that need a bonus's own scope", () => {
    const input = checkSlotAvailability(
      { ...modSlot, availableWhen: { input: { key: "stacks", atLeast: 1 } } },
      refs,
    );
    expect(input.some((e) => e.includes('cannot use "input"'))).toBe(true);
    const formula = checkSlotAvailability(
      {
        ...modSlot,
        availableWhen: { any: [{ formula: { formula: "1", atLeast: 1 } }] },
      },
      refs,
    );
    expect(formula.some((e) => e.includes('cannot use "formula"'))).toBe(true);
    const selfless = checkSlotAvailability(
      { ...modSlot, availableWhen: { bonusOccurrences: { atLeast: 1 } } },
      refs,
    );
    expect(selfless.some((e) => e.includes('needs a "bonus"'))).toBe(true);
  });

  it("rejects references to nothing", () => {
    const tag = checkSlotAvailability(
      { ...modSlot, availableWhen: { equipped: { tag: "nope" } } },
      refs,
    );
    expect(tag).toEqual([expect.stringContaining('tag "nope"')]);
    const item = checkSlotAvailability(
      { ...modSlot, availableWhen: { not: { equipped: { item: "ghost" } } } },
      refs,
    );
    expect(item).toEqual([expect.stringContaining('item "ghost"')]);
    const bonus = checkSlotAvailability(
      { ...modSlot, availableWhen: { bonusOccurrences: { bonus: "ghost" } } },
      refs,
    );
    expect(bonus).toEqual([expect.stringContaining('bonus "ghost"')]);
  });

  it("rejects a condition the slot's own pick can meet", () => {
    expect(checkSlotAvailability(mirrorSlot, refs)).toEqual([
      expect.stringContaining("own pick"),
    ]);
  });

  it("rejects the field on a slot type that cannot carry it", () => {
    const param = {
      id: "options.x",
      label: "X",
      section: "options",
      type: "build_parameter",
      paramType: "number",
      path: "x",
      availableWhen: { equipped: { tag: "artifact" } },
    } as Slot;
    expect(checkSlotAvailability(param, refs)).toEqual([
      expect.stringContaining("only meaningful on an item_picker"),
    ]);
  });

  it("finds nothing wrong with the shipped weapon mod slots", () => {
    const base = catalog.base();
    const findings = catalog.validateSlotAvailability({
      items: base.items,
      bonuses: base.bonuses,
      slots: base.slots,
    });
    expect(findings).toEqual([]);
    const gated = base.slots.filter(
      (slot) => slot.type === "item_picker" && slot.availableWhen,
    );
    expect(gated.map((slot) => slot.id)).toEqual([
      "gear.mainhandMod",
      "gear.offhandMod1",
      "gear.offhandMod2",
    ]);
  });
});

describe("slotsWithCompare", () => {
  const hidden = new Set(["gear.mod", "gear.socket", "gear.charms"]);
  const plain = pruneUnavailableSlots(testDb, staleBuild()).build;
  const ids = (result: ReturnType<typeof slotsWithCompare>) =>
    result.slots.map((slot) => slot.id);

  it("leaves out what the build hides when there is nothing to compare", () => {
    const result = slotsWithCompare(slots, plain, hidden, null);
    expect(ids(result)).toEqual(["gear.weapon", "gear.mirror"]);
    expect(result.compareOnly.size).toBe(0);
  });

  it("puts back, in place, the hidden rows the compare build fills", () => {
    const result = slotsWithCompare(slots, plain, hidden, filledBuild());
    expect(ids(result)).toEqual([
      "gear.weapon",
      "gear.mod",
      "gear.socket",
      "gear.charms#1",
      "gear.charms#2",
      "gear.mirror",
    ]);
    expect([...result.compareOnly]).toEqual([
      "gear.mod",
      "gear.socket",
      "gear.charms#1",
      "gear.charms#2",
    ]);
  });

  it("skips a hidden slot the compare build leaves empty", () => {
    const compare = filledBuild();
    delete compare.choices["gear.socket"];
    delete compare.choices["gear.charms#2"];
    const result = slotsWithCompare(slots, plain, hidden, compare);
    expect([...result.compareOnly]).toEqual(["gear.mod", "gear.charms#1"]);
  });
});
