// A resolve walks the build's slots once: the prune's final pass collects the same build the
// resolve would, so the resolve reuses it rather than collecting again.
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as db from "../../src/data/db";
import * as bonus from "../../src/engine/bonus";
import * as engine from "../../src/engine/engine";
import type {
  Build,
  Item,
  ItemPickerSlot,
  Schema,
  Slot,
} from "../../src/types";

vi.mock("../../src/engine/bonus", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/engine/bonus")>();
  return {
    ...actual,
    collect: vi.fn(actual.collect),
    resolve: vi.fn(actual.resolve),
  };
});

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
  { id: "mod", name: "Mod", filter: "mods", power: 50 },
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
  availableWhen: { equipped: { tag: "artifact" } },
};

const dbWith = (slots: Slot[]) =>
  db.build(items, [], schema, {
    sections: [{ id: "gear", label: "Gear", slotIds: [] }],
    slots,
    presets: [],
  });
const gatedDb = dbWith([weaponSlot, modSlot]);
const plainDb = dbWith([weaponSlot, { ...modSlot, availableWhen: undefined }]);

const build = (weapon: string): Build => ({
  id: "b",
  name: "b",
  choices: { "gear.weapon": weapon, "gear.mod": "mod" },
  values: {},
  bonusValues: {},
  assignments: {},
  listRows: {},
  disabledSlots: {},
  context: { role: "dps" } as Build["context"],
  compare: { id: "", highlight: false, onlyDiff: false, statLines: false },
});

const collect = vi.mocked(bonus.collect);
const resolve = vi.mocked(bonus.resolve);

/** How often `collect` ran, or null when a resolve was not handed its collect. Such a resolve
 *  collects through its own module binding, which the spy cannot see. */
function collectCalls(): number | null {
  const handed = resolve.mock.calls.every((call) => call[2] !== undefined);
  return resolve.mock.calls.length && handed ? collect.mock.calls.length : null;
}

describe("collect calls per resolve", () => {
  beforeEach(() => {
    collect.mockClear();
    resolve.mockClear();
  });

  it("collects once when a gated slot prunes nothing", () => {
    const result = engine.resolveBuild(gatedDb, build("relic"));
    expect(collectCalls()).toBe(1);
    expect(result.rows.find((row) => row.slotId === "gear.mod")?.item?.id).toBe(
      "mod",
    );
  });

  it("collects once for a bonuses-only resolve", () => {
    engine.resolveBonuses(gatedDb, build("relic"));
    expect(collectCalls()).toBe(1);
  });

  it("collects once when no slot carries a condition", () => {
    engine.resolveBuild(plainDb, build("stick"));
    expect(collectCalls()).toBe(1);
  });

  it("reuses the final prune pass after clearing a slot", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = engine.resolveBuild(gatedDb, build("stick"));
    warn.mockRestore();
    // One pass clears the mod, the next confirms nothing else fails.
    expect(collectCalls()).toBe(2);
    expect(result.rows.find((row) => row.slotId === "gear.mod")?.item).toBe(
      null,
    );
    expect(result.hiddenSlots.has("gear.mod")).toBe(true);
  });
});
