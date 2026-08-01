// catalog.ts's `validateSlots`: a duplicate path, or one shadowing a BuildContext field, would
// otherwise silently corrupt engine state (setPath clobbering `context.forte`/`context.toggles`
// wholesale, or two slots fighting over one value).
import { describe, it, expect } from "vitest";
import * as catalog from "../../src/catalog";
import { NW_SLOTS } from "../../src/data";
import type {
  BonusSet,
  ConditionWhen,
  Item,
  Slot,
  CatalogOverlay,
  Db,
  Build,
} from "../../src/types";

const paramSlot = (id: string, path: string): Slot => ({
  id,
  label: id,
  section: "options",
  type: "build_parameter",
  paramType: "boolean",
  path,
});

describe("catalog.validateSlots", () => {
  it("the shipped slots.json has no duplicate or shadowing paths", () => {
    expect(catalog.validateSlots(NW_SLOTS.slots)).toEqual([]);
  });

  it("reports two slots sharing one path", () => {
    const slots = [paramSlot("a", "bolster"), paramSlot("b", "bolster")];
    const findings = catalog.validateSlots(slots);
    expect(findings).toHaveLength(1);
    expect(findings[0].level).toBe("error");
    expect(findings[0].message).toMatch(/duplicates/);
  });

  it("reports an empty path", () => {
    const findings = catalog.validateSlots([paramSlot("a", "")]);
    expect(findings.some((f) => /no path/.test(f.message))).toBe(true);
  });

  it("reports a custom parameter shadowing a bare compound BuildContext field", () => {
    const findings = catalog.validateSlots([paramSlot("a", "toggles")]);
    expect(
      findings.some((f) => /shadows a BuildContext field/.test(f.message)),
    ).toBe(true);
  });

  it("reports a custom parameter nesting under a scalar BuildContext field", () => {
    const findings = catalog.validateSlots([paramSlot("a", "class.tier")]);
    expect(
      findings.some((f) => /shadows a BuildContext field/.test(f.message)),
    ).toBe(true);
  });

  it("does not flag legitimate nesting into a compound field", () => {
    const findings = catalog.validateSlots([
      paramSlot("a", "toggles.myFeature"),
    ]);
    expect(findings).toEqual([]);
  });

  it("item_picker slots are ignored entirely (no path to check)", () => {
    const findings = catalog.validateSlots([
      {
        id: "gear.head",
        label: "Head",
        section: "gear",
        type: "item_picker",
        filter: "gear_head",
      },
    ]);
    expect(findings).toEqual([]);
  });
});

describe("catalog.validate (class lookup after path trim)", () => {
  it("still finds allowedClass values through the class slot", () => {
    const findings = catalog.validate(
      [
        {
          id: "test-item",
          name: "Test Item",
          filter: "gear_head",
          allowedClass: ["not-a-class"],
        },
      ],
      [],
    );
    expect(
      findings.some(
        (f) => f.name === "test-item" && /allowedClass/.test(f.message),
      ),
    ).toBe(true);
  });
});

describe("catalog.validate: item id lint", () => {
  it("reports a missing id, naming the item by its display name", () => {
    const findings = catalog.validate(
      [{ name: "No Id", filter: "gear_head" }] as unknown as Item[],
      [],
    );
    expect(
      findings.some((f) => f.name === "No Id" && /no id/.test(f.message)),
    ).toBe(true);
  });

  it("reports a duplicate id, but not a duplicate name", () => {
    const items = [
      { id: "dup", name: "Item A", filter: "gear_head" },
      { id: "dup", name: "Item B", filter: "gear_head" },
    ];
    const findings = catalog.validate(items, []);
    expect(findings.some((f) => /duplicate item id/.test(f.message))).toBe(
      true,
    );
    expect(findings.some((f) => /duplicate.*name/i.test(f.message))).toBe(
      false,
    );
  });

  it("two items sharing a display name are both clean otherwise", () => {
    const items = [
      { id: "ring-a", name: "Ring", filter: "gear_ring" },
      { id: "ring-b", name: "Ring", filter: "gear_ring" },
    ];
    expect(catalog.validate(items, [])).toEqual([]);
  });
});

describe("catalog.nextId", () => {
  it("slugifies a name with no existing collision", () => {
    expect(catalog.nextId("Brutality (Pref)", [])).toBe("brutality-pref");
  });

  it("disambiguates against existing ids by appending -2, -3, ...", () => {
    expect(catalog.nextId("Brutality", ["brutality"])).toBe("brutality-2");
    expect(catalog.nextId("Brutality", ["brutality", "brutality-2"])).toBe(
      "brutality-3",
    );
  });

  it("falls back to the given default when the name slugifies to nothing", () => {
    expect(catalog.nextId("!!!", [], "bonus-set")).toBe("bonus-set");
  });
});

describe("catalog.compose: layer overlay (two layers, same item id)", () => {
  it("the later overlay wins when both define the same item id", () => {
    const early: CatalogOverlay = {
      items: {
        "shared-item": {
          id: "shared-item",
          name: "Original",
          filter: "gear_head",
        },
      },
      bonusSets: {},
    };
    const later: CatalogOverlay = {
      items: {
        "shared-item": {
          id: "shared-item",
          name: "Override",
          filter: "gear_head",
        },
      },
      bonusSets: {},
    };
    const composed = catalog.compose([early, later]);
    const item = composed.items.find((i) => i.id === "shared-item");
    expect(item?.name).toBe("Override");
  });

  it("disabling the later overlay makes the earlier one show through", () => {
    const early: CatalogOverlay = {
      items: {
        "shared-item": {
          id: "shared-item",
          name: "Original",
          filter: "gear_head",
        },
      },
      bonusSets: {},
    };
    // Disabling the later layer means not passing it to compose
    const composed = catalog.compose([early]);
    const item = composed.items.find((i) => i.id === "shared-item");
    expect(item?.name).toBe("Original");
  });

  it("a tombstone (null) in the later overlay hides the base item", () => {
    const early: CatalogOverlay = {
      items: {
        "shared-item": {
          id: "shared-item",
          name: "Original",
          filter: "gear_head",
        },
      },
      bonusSets: {},
    };
    const later: CatalogOverlay = {
      items: { "shared-item": null },
      bonusSets: {},
    };
    const composed = catalog.compose([early, later]);
    expect(composed.items.find((i) => i.id === "shared-item")).toBeUndefined();
  });
});

// The `param` leaf lint. Exercised through `validate()` (not a standalone function) since the
// checks live inside `checkConditions`, keyed on the real slots.json paths -- `class` (list),
// `duration` (number), `toggles.combat` (a toggle slot, boolean).
describe("catalog.validate: param condition lint", () => {
  const setWith = (when: ConditionWhen): BonusSet[] => [
    { id: "test-set", grants: [{ when, stats: {} }] },
  ];
  const errorsFor = (when: ConditionWhen) =>
    catalog.validate([], setWith(when)).filter((f) => f.level === "error");
  const warningsFor = (when: ConditionWhen) =>
    catalog.validate([], setWith(when)).filter((f) => f.level === "warn");

  it("an unresolvable key is an error -- the condition can never be active", () => {
    const errors = errorsFor({ param: { key: "does-not-exist", is: true } });
    expect(
      errors.some((f) => /not a build_parameter's path/.test(f.message)),
    ).toBe(true);
  });

  it('an empty "key" is an error', () => {
    const errors = errorsFor({ param: { key: "" } });
    expect(errors.some((f) => /no "key"/.test(f.message))).toBe(true);
  });

  it('a number slot rejects "equals"/"is" and requires atLeast/below', () => {
    const errors = errorsFor({ param: { key: "duration", equals: "30" } });
    expect(errors.some((f) => /is a number/.test(f.message))).toBe(true);
  });

  it('a boolean slot rejects atLeast/below and requires "is"', () => {
    const errors = errorsFor({ param: { key: "m32Forte", atLeast: 1 } });
    expect(errors.some((f) => /is a boolean/.test(f.message))).toBe(true);
  });

  it('a list slot requires "equals"', () => {
    const errors = errorsFor({ param: { key: "class", atLeast: 1 } });
    expect(errors.some((f) => /is a list/.test(f.message))).toBe(true);
  });

  it('a list slot\'s "equals" must be one of its declared options', () => {
    const errors = errorsFor({
      param: { key: "class", equals: "not-a-class" },
    });
    expect(
      errors.some((f) => /not one of its declared options/.test(f.message)),
    ).toBe(true);
  });

  it("a well-formed param condition against a real slot is clean", () => {
    expect(errorsFor({ param: { key: "duration", atLeast: 10 } })).toEqual([]);
  });

  it("warns (not errors) when a param duplicates a dedicated leaf", () => {
    const when = { param: { key: "class", equals: "warlock" } };
    expect(errorsFor(when)).toEqual([]);
    expect(
      warningsFor(when).some((f) =>
        /dedicated "class" condition/.test(f.message),
      ),
    ).toBe(true);
  });

  it('warns for a toggle path, pointing at the dedicated "toggle" leaf', () => {
    const warnings = warningsFor({
      param: { key: "toggles.combat", is: true },
    });
    expect(
      warnings.some((f) => /dedicated "toggle" condition/.test(f.message)),
    ).toBe(true);
  });

  it("does not warn for a param with no dedicated leaf (the actual escape-hatch case)", () => {
    // `magnitude` is a real build_parameter slot with no dedicated condition leaf of its own --
    // exactly what `param` exists for.
    const warnings = warningsFor({ param: { key: "magnitude", atLeast: 10 } });
    expect(warnings).toEqual([]);
  });
});

// --- referencedOverlay -------------------------------------------------------------------

/** Build a minimal Db for testing. Only `get` and `bonusSetById` are exercised. */
function testDb(items: Item[], bonusSets: BonusSet[]): Db {
  const byId = new Map(items.map((i) => [i.id, i]));
  const bySetId = new Map(bonusSets.map((s) => [s.id, s]));
  return {
    get: (id: string | null | undefined) => byId.get(id ?? "") ?? null,
    bonusSetById: bySetId,
  } as unknown as Db;
}

// A real item that exists in the shipped base catalogue — referencedOverlay should not emit it.
const BASE_ITEM_ID = "1-amethyst-awareness";

const baseItem: Item = {
  id: "1-amethyst-awareness",
  name: "1) Amethyst (Awareness)",
  filter: "enchantment_defense",
  il: 1800,
  combined_rating: 1620,
  awareness: 2700,
  tags: ["gem:amethyst"],
};

const layerItem: Item = {
  id: "layer-item",
  name: "Layer Item",
  filter: "gear_ring",
  bonuses: ["layer-set"],
};

const layerSet: BonusSet = {
  id: "layer-set",
  grants: [{ stats: { power: 100 } }],
};

const excludedSet: BonusSet = {
  id: "excluded-set",
  grants: [{ stats: { power: 50 } }],
};

const chainedSet: BonusSet = {
  id: "chained-set",
  grants: [{ stats: { power: 25 } }],
  excludes: ["excluded-set"],
};

describe("catalog.referencedOverlay", () => {
  it("is empty for a build of only shipped items", () => {
    const db = testDb([baseItem], []);
    const build: Build = {
      id: "b1",
      name: "Test",
      choices: { gear_head: BASE_ITEM_ID },
      values: {},
      context: {} as Build["context"],
      compare: { id: "", highlight: false, onlyDiff: false },
    };
    const overlay = catalog.referencedOverlay(db, build);
    // baseItem matches a real shipped item, so nothing should be emitted
    expect(catalog.isEmpty(overlay)).toBe(true);
  });

  it("picks up a layer-defined item and its bonus sets", () => {
    const db = testDb([baseItem, layerItem], [layerSet]);
    const build: Build = {
      id: "b1",
      name: "Test",
      choices: { gear_head: BASE_ITEM_ID, gear_ring: "layer-item" },
      values: {},
      context: {} as Build["context"],
      compare: { id: "", highlight: false, onlyDiff: false },
    };
    // baseItem (BASE_ITEM_ID) is in base, so it should not appear in the overlay.
    // layer-item is NOT in base, so it should appear along with its bonus set.
    const overlay = catalog.referencedOverlay(db, build);
    expect(overlay.items["layer-item"]).toBeDefined();
    expect(overlay.items["layer-item"]?.name).toBe("Layer Item");
    expect(overlay.bonusSets["layer-set"]).toBeDefined();
    // baseItem is in base, so it should NOT be in the overlay
    expect(overlay.items[BASE_ITEM_ID]).toBeUndefined();
  });

  it("includes sets reachable through excludes", () => {
    const db = testDb(
      [
        baseItem,
        { ...layerItem, bonuses: ["chained-set"], excludes: ["excluded-set"] },
      ],
      [layerSet, chainedSet, excludedSet],
    );
    const build: Build = {
      id: "b1",
      name: "Test",
      choices: { gear_ring: "layer-item" },
      values: {},
      context: {} as Build["context"],
      compare: { id: "", highlight: false, onlyDiff: false },
    };
    // The item has bonuses: ["chained-set"] and excludes: ["excluded-set"]
    // chained-set also excludes excluded-set (transitive)
    const overlay = catalog.referencedOverlay(db, build);
    expect(overlay.items["layer-item"]).toBeDefined();
    expect(overlay.bonusSets["chained-set"]).toBeDefined();
    expect(overlay.bonusSets["excluded-set"]).toBeDefined();
  });

  it("excludes layer entries the build does not reference", () => {
    const db = testDb([baseItem, layerItem], [layerSet]);
    const build: Build = {
      id: "b1",
      name: "Test",
      choices: { gear_head: BASE_ITEM_ID },
      values: {},
      context: {} as Build["context"],
      compare: { id: "", highlight: false, onlyDiff: false },
    };
    // build only references baseItem, not layerItem
    const overlay = catalog.referencedOverlay(db, build);
    expect(catalog.isEmpty(overlay)).toBe(true);
  });

  it("picks up a base item whose bonus set a layer edited", () => {
    // Use a real base item that references a real base bonus set.
    const BASE_SET_ITEM_ID = "1st-pack-tactics-group";
    const baseItemWithSet: Item = {
      id: "1st-pack-tactics-group",
      name: "1st Pack Tactics (Group)",
      filter: "group_buff",
      maxCopies: 1,
      bonuses: ["1st-pack-tactics-group"],
    };
    // Layer edits the bonus set with different stats.
    const editedSet: BonusSet = {
      id: "1st-pack-tactics-group",
      name: "1st Pack Tactics (Group)",
      grants: [{ stats: { power: 999 } }], // different from base
    };
    const db = testDb([baseItemWithSet], [editedSet]);
    const build: Build = {
      id: "b1",
      name: "Test",
      choices: { group_buff: BASE_SET_ITEM_ID },
      values: {},
      context: {} as Build["context"],
      compare: { id: "", highlight: false, onlyDiff: false },
    };
    const overlay = catalog.referencedOverlay(db, build);
    // The item is unchanged from base, so it should NOT be emitted.
    expect(overlay.items[BASE_SET_ITEM_ID]).toBeUndefined();
    // The bonus set IS different from base, so it SHOULD be emitted.
    expect(overlay.bonusSets["1st-pack-tactics-group"]).toBeDefined();
    expect(
      overlay.bonusSets["1st-pack-tactics-group"]?.grants?.[0]?.stats?.power,
    ).toBe(999);
  });

  it("does not emit a base item or its set when both match base", () => {
    // Use the actual base item without any bonuses — it should emit nothing.
    const db = testDb([baseItem], []);
    const build: Build = {
      id: "b1",
      name: "Test",
      choices: { gear_head: BASE_ITEM_ID },
      values: {},
      context: {} as Build["context"],
      compare: { id: "", highlight: false, onlyDiff: false },
    };
    const overlay = catalog.referencedOverlay(db, build);
    expect(catalog.isEmpty(overlay)).toBe(true);
  });
});
