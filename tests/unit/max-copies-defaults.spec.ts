// Per-filter `maxCopies` defaults: what an item inherits from its category, how it opts back
// out, and the lint that catches a member left uncapped.
import { describe, it, expect } from "vitest";
import * as db from "../../src/data/db";
import * as engine from "../../src/engine/engine";
import * as catalog from "../../src/data/catalog";
import { NW_ITEMS } from "../../src/data/data";
import type {
  Build,
  FilterDefaultsMap,
  Item,
  Schema,
  Slot,
  SlotsData,
} from "../../src/types";

const schema: Schema = {
  stats: [{ key: "il", label: "Item Level", kind: "flat" }],
  statByKey: { il: { key: "il", label: "Item Level", kind: "flat" } },
  statKeys: ["il"],
  multiplicativeStats: [],
  ratingStats: [],
  abilityStats: [],
  ratingConversion: [],
  abilityContributions: [],
  forteSplit: {},
  roles: { dps: { label: "DPS", hpBonus: 1, damageBonus: 1 } },
  statScalers: [],
};

const picker = (id: string, filter: string): Slot => ({
  id,
  label: id,
  section: "gear",
  type: "item_picker",
  filter,
});

// Two ring slots, so a ring can repeat; one charm slot, so a charm cannot.
const slots: SlotsData = {
  sections: [{ id: "gear", label: "Gear" }],
  slots: [
    picker("gear.ring1", "test_ring"),
    picker("gear.ring2", "test_ring"),
    picker("gear.charm", "test_charm"),
  ],
};

const defaults: FilterDefaultsMap = { test_ring: { maxCopies: 1 } };

/** The same slots, with the category default rings inherit. */
const capped: SlotsData = { ...slots, filterDefaults: defaults };

const item = (
  id: string,
  filter: string,
  fields: Partial<Item> = {},
): Item => ({
  id,
  name: id,
  filter,
  ...fields,
});

function testBuild(choices: Record<string, string>): Build {
  return {
    id: "b",
    name: "b",
    choices,
    values: {},
    assignments: {},
    occurrenceInputs: {},
    listRows: {},
    context: {
      class: "",
      role: "",
      damageType: "",
      duration: 0,
      enemies: 0,
      magnitude: 0,
      m32Forte: false,
      mountBolster: 1,
      companionBolster: 1,
      forte: {},
      toggles: {},
    },
    compare: { id: "", highlight: false, onlyDiff: false, statLines: false },
  };
}

describe("Db.maxCopies with per-filter defaults", () => {
  const plain = item("plain-ring", "test_ring");
  const ownCap = item("two-ring", "test_ring", { maxCopies: 2 });
  const optedOut = item("free-ring", "test_ring", { maxCopies: 0 });
  const charm = item("charm", "test_charm");
  const testDb = db.build([plain, ownCap, optedOut, charm], [], schema, capped);

  it("falls back to the filter's default when the item declares no cap", () => {
    expect(testDb.maxCopies(plain)).toBe(1);
  });

  it("prefers the item's own cap over its filter's default", () => {
    expect(testDb.maxCopies(ownCap)).toBe(2);
  });

  it("reads an explicit 0 as unlimited despite the category default", () => {
    expect(testDb.maxCopies(optedOut)).toBe(0);
  });

  it("leaves an item whose filter declares no default uncapped", () => {
    expect(testDb.maxCopies(charm)).toBe(0);
  });

  it("caps nothing when the db was built without defaults at all", () => {
    expect(db.build([plain], [], schema, slots).maxCopies(plain)).toBe(0);
  });
});

describe("a cap inherited from the filter", () => {
  it("is enforced by the engine exactly like an item's own", () => {
    const plain = item("plain-ring", "test_ring");
    const testDb = db.build([plain], [], schema, capped);
    const twice = engine.resolveBuild(
      testDb,
      testBuild({ "gear.ring1": "plain-ring", "gear.ring2": "plain-ring" }),
    );
    expect(twice.errors.some((e) => e.kind === "maxCopies")).toBe(true);
  });

  it("is lifted by an explicit 0 on the item", () => {
    const optedOut = item("free-ring", "test_ring", { maxCopies: 0 });
    const testDb = db.build([optedOut], [], schema, capped);
    const twice = engine.resolveBuild(
      testDb,
      testBuild({ "gear.ring1": "free-ring", "gear.ring2": "free-ring" }),
    );
    expect(twice.errors).toEqual([]);
  });
});

describe("validateMaxCopies", () => {
  const lint = (items: Item[], filterDefaults: FilterDefaultsMap = {}) =>
    catalog.validateMaxCopies(items, slots.slots, filterDefaults);

  it("warns about the one member of a capped filter carrying no cap", () => {
    const findings = lint([
      item("a", "test_ring", { maxCopies: 1 }),
      item("b", "test_ring", { maxCopies: 1 }),
      item("c", "test_ring"),
    ]);
    expect(findings.map((f) => f.name)).toEqual(["c"]);
    expect(findings[0].level).toBe("warn");
  });

  it("says nothing when the whole filter agrees it is uncapped", () => {
    expect(lint([item("a", "test_ring"), item("b", "test_ring")])).toEqual([]);
  });

  it("counts an explicit 0 as an answer rather than an omission", () => {
    expect(
      lint([
        item("a", "test_ring", { maxCopies: 1 }),
        item("b", "test_ring", { maxCopies: 0 }),
      ]),
    ).toEqual([]);
  });

  it("stays quiet for a filter no more than one row can ever hold", () => {
    expect(
      lint([
        item("a", "test_charm", { maxCopies: 1 }),
        item("b", "test_charm"),
      ]),
    ).toEqual([]);
  });

  it("stays quiet once the filter declares a default of its own", () => {
    expect(
      lint(
        [item("a", "test_ring", { maxCopies: 1 }), item("b", "test_ring")],
        defaults,
      ),
    ).toEqual([]);
  });

  it("treats an item_picker_list's rows as repeatable", () => {
    const listSlots: Slot[] = [
      {
        id: "gear.buffs",
        label: "Buffs",
        section: "gear",
        type: "item_picker_list",
        filter: "test_buff",
      },
    ];
    const findings = catalog.validateMaxCopies(
      [item("a", "test_buff", { maxCopies: 1 }), item("b", "test_buff")],
      listSlots,
      {},
    );
    expect(findings.map((f) => f.name)).toEqual(["b"]);
  });

  it("the shipped catalogue has no filter left half-capped", () => {
    expect(catalog.validateMaxCopies(NW_ITEMS)).toEqual([]);
  });
});
