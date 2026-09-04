// `Item.hideFromPicker` (an item withheld from lists that offer a new pick) and
// `Item.replacedBy` (a lookup that forwards to whatever superseded it), plus the build
// rewrite that persists the second one.
//
// Mostly built from purpose-made items rather than the shipped catalogue: nothing shipped was
// retired when these were written, and pinning them on entries that exist today would make the
// tests hostage to a data edit. The export round trip at the end is the exception, since what
// it guards is how a *real* download is composed back.
import { describe, it, expect } from "vitest";
import * as db from "../../src/data/db";
import * as catalog from "../../src/data/catalog";
import * as storage from "../../src/storage/storage";
import * as engine from "../../src/engine/engine";
import {
  migrateItemIds,
  migrateSlotItem,
  replacements,
} from "../../src/storage/migrate-item-ids";
import { optionsFromItems } from "../../src/lib/param-options";
import { NW_SCHEMA } from "../../src/data/data";
import type { Build, Item, SlotsData } from "../../src/types";

const slotsData: SlotsData = {
  sections: [
    { id: "gear", label: "Gear" },
    { id: "boons", label: "Boons" },
  ],
  slots: [
    {
      id: "ring1",
      label: "Ring 1",
      section: "gear",
      type: "item_picker",
      filter: "test_ring",
    },
    {
      id: "ring2",
      label: "Ring 2",
      section: "gear",
      type: "item_picker",
      filter: "test_ring",
    },
    {
      id: "boons.tier1",
      label: "Boons",
      section: "boons",
      type: "point_assignment",
      filter: "test_boon",
    },
    {
      id: "options.flavour",
      label: "Flavour",
      section: "gear",
      type: "build_parameter",
      paramType: "list",
      path: "flavour",
      optionsFrom: { filter: "test_flavour" },
    },
  ],
};

const live: Item = { id: "live", name: "Live Ring", filter: "test_ring" };
const hidden: Item = {
  id: "hidden",
  name: "Hidden Ring",
  filter: "test_ring",
  hideFromPicker: true,
};
const oldRing: Item = {
  id: "old-ring",
  name: "Old Ring",
  filter: "test_ring",
  hideFromPicker: true,
  replacedBy: "new-ring",
};
const newRing: Item = { id: "new-ring", name: "New Ring", filter: "test_ring" };
const hiddenBoon: Item = {
  id: "hidden-boon",
  name: "Hidden Boon",
  filter: "test_boon",
  hideFromPicker: true,
  inlineRepetition: { min: 0, max: 5, default: 0 },
};
const liveBoon: Item = {
  id: "live-boon",
  name: "Live Boon",
  filter: "test_boon",
  inlineRepetition: { min: 0, max: 5, default: 0 },
};

const items = [live, hidden, oldRing, newRing, hiddenBoon, liveBoon];
const testDb = db.build(items, [], NW_SCHEMA, slotsData);

function buildWith(overrides: Partial<Build> = {}): Build {
  return {
    id: "b",
    name: "b",
    choices: {},
    values: {},
    assignments: {},
    occurrenceInputs: {},
    listRows: {},
    context: { class: "" },
    compare: { id: "", highlight: false, onlyDiff: false, statLines: false },
    ...overrides,
  } as unknown as Build;
}

describe("hideFromPicker on an item", () => {
  it("drops the item from a picker offering a new choice", () => {
    const ids = db
      .forSlotAndBuild(testDb, "ring1", buildWith())
      .map((item) => item.id);
    expect(ids).toContain("live");
    expect(ids).not.toContain("hidden");
  });

  it("keeps it in the list of the slot holding it, so the pick can be restored", () => {
    const ids = db
      .forSlotAndBuild(
        testDb,
        "ring1",
        buildWith({ choices: { ring1: "hidden" } }),
      )
      .map((item) => item.id);
    expect(ids).toContain("hidden");
  });

  it("still hides it from every other slot while one slot holds it", () => {
    const ids = db
      .forSlotAndBuild(
        testDb,
        "ring2",
        buildWith({ choices: { ring1: "hidden" } }),
      )
      .map((item) => item.id);
    expect(ids).not.toContain("hidden");
  });

  it("leaves the engine's own candidate list alone, so an equipped one still calculates", () => {
    expect(testDb.forSlot("ring1").map((item) => item.id)).toContain("hidden");
  });

  it("drops it from an optionsFrom parameter's option set", () => {
    const offered = optionsFromItems({ filter: "test_ring" }, items).map(
      (item) => item.id,
    );
    expect(offered).toContain("live");
    expect(offered).not.toContain("hidden");
  });
});

describe("hideFromPicker on a point_assignment row", () => {
  // These rows all render at once, so "in use" is a nonzero count rather than a current pick:
  // dropping an assigned row would strand points the engine still counts.
  const rowsFor = (values: Record<string, number>) =>
    testDb
      .forSlot("boons.tier1")
      .filter((item) => db.stillOffered(item, (values[item.id] ?? 0) > 0))
      .map((item) => item.id);

  it("drops a hidden row holding no points", () => {
    expect(rowsFor({})).toEqual(["live-boon"]);
  });

  it("keeps a hidden row that still holds points", () => {
    expect(rowsFor({ "hidden-boon": 2 })).toContain("hidden-boon");
  });
});

describe("replacedBy is an offer, not a redirect", () => {
  it("leaves a lookup on the item the id actually names", () => {
    expect(testDb.get("old-ring")?.id).toBe("old-ring");
  });

  it("reports what that id would migrate to, separately", () => {
    expect(testDb.replacementFor("old-ring")?.id).toBe("new-ring");
  });

  it("answers null for an item nothing supersedes", () => {
    expect(testDb.replacementFor("new-ring")).toBeNull();
  });

  it("follows a chain to its end", () => {
    const chained = db.build(
      [
        { id: "a", name: "A", filter: "test_ring", replacedBy: "b" },
        { id: "b", name: "B", filter: "test_ring", replacedBy: "c" },
        { id: "c", name: "C", filter: "test_ring" },
      ],
      [],
      NW_SCHEMA,
      slotsData,
    );
    expect(chained.replacementFor("a")?.id).toBe("c");
    expect(chained.get("a")?.id).toBe("a");
  });

  it("offers nothing when the chain dangles", () => {
    const dangling = db.build(
      [{ id: "a", name: "A", filter: "test_ring", replacedBy: "gone" }],
      [],
      NW_SCHEMA,
      slotsData,
    );
    expect(dangling.replacementFor("a")).toBeNull();
    expect(dangling.get("a")?.id).toBe("a");
  });

  it("does not hang on a cycle, and offers no self-swap", () => {
    const cyclic = db.build(
      [
        { id: "a", name: "A", filter: "test_ring", replacedBy: "b" },
        { id: "b", name: "B", filter: "test_ring", replacedBy: "a" },
      ],
      [],
      NW_SCHEMA,
      slotsData,
    );
    // The walk stops rather than looping; whatever it lands on, it is never `a` itself, which
    // would offer to migrate the item onto itself.
    expect(cyclic.replacementFor("a")?.id).not.toBe("a");
  });

  it("counts a retired id and its replacement separately against maxCopies", () => {
    // They are distinct catalogue entries until the player migrates, so a cap on one says
    // nothing about the other -- the same way any two items with the same cap are independent.
    const capped = db.build(
      [
        { id: "old", name: "Old", filter: "test_ring", replacedBy: "new" },
        { id: "new", name: "New", filter: "test_ring", maxCopies: 1 },
      ],
      [],
      NW_SCHEMA,
      slotsData,
    );
    const ids = db
      .forSlotAndBuild(
        capped,
        "ring2",
        buildWith({ choices: { ring1: "old" } }),
      )
      .map((item) => item.id);
    expect(ids).toContain("new");
  });
});

describe("retiredChoices", () => {
  it("reports a pick whose item has been superseded", () => {
    const found = db.retiredChoices(
      testDb,
      buildWith({ choices: { ring1: "old-ring" } }),
    );
    expect(found).toEqual([{ slotId: "ring1", from: "old-ring", to: newRing }]);
  });

  it("says nothing about a pick that is merely hidden", () => {
    expect(
      db.retiredChoices(testDb, buildWith({ choices: { ring1: "hidden" } })),
    ).toEqual([]);
  });
});

describe("migrateItemIds", () => {
  it("returns the same object when nothing is retired", () => {
    const build = buildWith({ choices: { ring1: "live" } });
    expect(migrateItemIds(testDb, build)).toBe(build);
  });

  it("rewrites choices, assignments and occurrence inputs together", () => {
    const retiredBoon = db.build(
      [
        ...items,
        {
          id: "old-boon",
          name: "Old Boon",
          filter: "test_boon",
          replacedBy: "live-boon",
          inlineRepetition: { min: 0, max: 5, default: 0 },
        },
      ],
      [],
      NW_SCHEMA,
      slotsData,
    );
    const migrated = migrateItemIds(
      retiredBoon,
      buildWith({
        choices: { ring1: "old-ring", ring2: "live" },
        assignments: { "boons.tier1": { "old-boon": 3 } },
        occurrenceInputs: { "old-ring": { someBonus: 2 } },
      }),
    );
    expect(migrated.choices).toEqual({ ring1: "new-ring", ring2: "live" });
    expect(migrated.assignments["boons.tier1"]).toEqual({ "live-boon": 3 });
    expect(migrated.occurrenceInputs).toEqual({ "new-ring": { someBonus: 2 } });
  });

  it("leaves Build.values untouched, since it is keyed by slot rather than by item", () => {
    const values = { ring1: { power: 500 } };
    const migrated = migrateItemIds(
      testDb,
      buildWith({ choices: { ring1: "old-ring" }, values }),
    );
    expect(migrated.values).toEqual(values);
  });

  it("moves an optionsFrom parameter's stored value, which is itself an item id", () => {
    const flavoured = db.build(
      [
        {
          id: "old-flavour",
          name: "Old",
          filter: "test_flavour",
          replacedBy: "new-flavour",
        },
        { id: "new-flavour", name: "New", filter: "test_flavour" },
      ],
      [],
      NW_SCHEMA,
      slotsData,
    );
    const migrated = migrateItemIds(
      flavoured,
      buildWith({ context: { class: "", flavour: "old-flavour" } as never }),
    );
    expect(
      (migrated.context as unknown as Record<string, unknown>).flavour,
    ).toBe("new-flavour");
  });

  it("is idempotent, so a second pass finds nothing left to move", () => {
    const once = migrateItemIds(
      testDb,
      buildWith({ choices: { ring1: "old-ring" } }),
    );
    expect(replacements(testDb, once).size).toBe(0);
    expect(migrateItemIds(testDb, once)).toBe(once);
  });

  // Both key orders, since a plain merge would silently let whichever key came last win.
  it.each([
    ["retired first", { "old-ring": { b: 1 }, "new-ring": { b: 4 } }],
    ["replacement first", { "new-ring": { b: 4 }, "old-ring": { b: 1 } }],
  ])(
    "keeps the count already stored under the replacement (%s)",
    (_label, occurrenceInputs) => {
      const migrated = migrateItemIds(testDb, buildWith({ occurrenceInputs }));
      expect(migrated.occurrenceInputs["new-ring"].b).toBe(4);
    },
  );

  it("carries a retired item's other bonus counts across the merge", () => {
    const migrated = migrateItemIds(
      testDb,
      buildWith({
        occurrenceInputs: { "old-ring": { b: 1, c: 7 }, "new-ring": { b: 4 } },
      }),
    );
    expect(migrated.occurrenceInputs["new-ring"]).toEqual({ b: 4, c: 7 });
  });
});

// The case the whole `values` half of `replacedBy` exists for: several fixed-value items
// collapsing onto one whose magnitude the player types.
describe("migrating onto a dynamic stat", () => {
  const seeded = db.build(
    [
      {
        id: "fixed-2",
        name: "Fixed 2%",
        filter: "test_ring",
        overall_damage: 0.02,
        hideFromPicker: true,
        replacedBy: {
          item: "dynamic",
          values: { overall_damage: 0.02 },
        },
      },
      {
        id: "dynamic",
        name: "Dynamic",
        filter: "test_ring",
        dynamicStats: [
          { stat: "overall_damage", min: 0, max: 0.08, default: 0.04 },
        ],
      },
    ],
    [],
    NW_SCHEMA,
    slotsData,
  );

  it("offers the replacement, same as the bare-id form", () => {
    expect(seeded.replacementFor("fixed-2")?.id).toBe("dynamic");
    expect(seeded.get("fixed-2")?.id).toBe("fixed-2");
  });

  it("carries the retired item's own value onto the slot instead of the new default", () => {
    const migrated = migrateItemIds(
      seeded,
      buildWith({ choices: { ring1: "fixed-2" } }),
    );
    expect(migrated.values.ring1).toEqual({ overall_damage: 0.02 });
  });

  it("never overwrites a magnitude the player already typed", () => {
    const migrated = migrateItemIds(
      seeded,
      buildWith({
        choices: { ring1: "fixed-2" },
        values: { ring1: { overall_damage: 0.07 } },
      }),
    );
    expect(migrated.values.ring1.overall_damage).toBe(0.07);
  });

  it("writes nothing for a bare-id replacement, which carries no values", () => {
    const migrated = migrateItemIds(
      testDb,
      buildWith({ choices: { ring1: "old-ring" } }),
    );
    expect(migrated.values.ring1).toBeUndefined();
  });

  it("reports a seed the final item declares no dynamicStats entry for", () => {
    const messages = catalog
      .validateReplacements([
        {
          id: "a",
          name: "A",
          filter: "f",
          replacedBy: { item: "b", values: { power: 500 } },
        },
        { id: "b", name: "B", filter: "f" },
      ])
      .map((finding) => finding.message);
    expect(messages).toEqual([
      'replacedBy seeds power, but "b" declares no dynamicStats entry for it - ' +
        "the value would be dropped on migration",
    ]);
  });

  it("reports a seed naming a stat the schema does not have", () => {
    const messages = catalog
      .validateReplacements([
        {
          id: "a",
          name: "A",
          filter: "f",
          replacedBy: { item: "b", values: { not_a_stat: 1 } },
        },
        { id: "b", name: "B", filter: "f" },
      ])
      .map((finding) => finding.message);
    expect(messages).toEqual([
      'replacedBy seeds "not_a_stat", which is not a stat in the schema',
    ]);
  });
});

/**
 * A download embeds the catalogue entries its build depends on (`referencedOverlay`), and an
 * overlay entry is keyed by the id it is stored under while db.ts re-indexes it by the entry's
 * own `id`. Emitting a *resolved* item therefore files the replacement under the retired id, so
 * on import the retired id indexes under the replacement's name and disappears -- taking the
 * build's choice with it, and leaving a build that can be neither resolved nor migrated.
 */
describe("exporting a build that still holds a retired id", () => {
  const RETIRED = "old-export-item";
  const REPLACEMENT = "new-export-item";
  // Ids absent from the shipped base, so both ends genuinely have to travel in the overlay.
  const layer = catalog.upsert(
    catalog.upsert(catalog.emptyOverlay(), "items", RETIRED, {
      id: RETIRED,
      name: "Old Export Item",
      filter: "gear_ring",
      hideFromPicker: true,
      replacedBy: { item: REPLACEMENT, values: { overall_damage: 0.02 } },
    } as Item),
    "items",
    REPLACEMENT,
    {
      id: REPLACEMENT,
      name: "New Export Item",
      filter: "gear_ring",
      dynamicStats: [
        { stat: "overall_damage", min: 0, max: 0.08, default: 0.04 },
      ],
    } as Item,
  );

  const exported = () => {
    const source = catalog.makeDb([layer]);
    const build = storage.normalise({
      ...storage.defaultBuild("mine"),
      choices: { "gear.ring1": RETIRED },
    });
    const json = storage.toBuildJson(build, source);
    const imported = storage.normalise(JSON.parse(json).data);
    return { imported, db: catalog.makeDb([imported.catalog ?? null]) };
  };

  it("carries the retired entry under its own id, not the replacement's", () => {
    const { db: importedDb } = exported();
    expect(importedDb.get(RETIRED)?.id).toBe(RETIRED);
    expect(importedDb.get(RETIRED)?.replacedBy).toEqual({
      item: REPLACEMENT,
      values: { overall_damage: 0.02 },
    });
  });

  it("carries the replacement too, so the offer points at something real", () => {
    const { db: importedDb } = exported();
    expect(importedDb.replacementFor(RETIRED)?.id).toBe(REPLACEMENT);
  });

  it("leaves the imported build migratable, notice and all", () => {
    const { imported, db: importedDb } = exported();
    expect([...replacements(importedDb, imported)]).toEqual([
      [RETIRED, REPLACEMENT],
    ]);
    const migrated = migrateItemIds(importedDb, imported);
    expect(migrated.choices["gear.ring1"]).toBe(REPLACEMENT);
    expect(migrated.values["gear.ring1"]).toEqual({ overall_damage: 0.02 });
    // The notice is driven by this being empty -- a rewrite that leaves anything behind is a
    // button that visibly does nothing.
    expect(replacements(importedDb, migrated).size).toBe(0);
  });
});

/**
 * The invariant the offer rests on: accepting it swaps which item the build holds without
 * moving its numbers. Before the click the build calculates as the retired item's own fixed
 * stat; after it, as the replacement's dynamic stat seeded to the value carried across. The
 * two have to agree, or "update" would silently reprice the build.
 *
 * Pinned on the shipped Celestial Lion entries across all three percentages, because the 4%
 * one alone would pass even if the carried value were ignored -- its number happens to equal
 * the replacement's default.
 */
describe("accepting the offer does not move the numbers", () => {
  const SLOT = "companions.universal1";
  const damage = (build: Build) =>
    engine.resolveBuild(catalog.makeDb([]), build).stages.dynamicStatMods
      .overall_damage;

  it.each([
    ["celestial-lion-s-presence-2-stalwart-golden-lion-damage-utility", 0.02],
    ["celestial-lion-s-presence-3-stalwart-golden-lion-damage-utility", 0.03],
    ["celestial-lion-s-presence-4-stalwart-golden-lion-damage-utility", 0.04],
  ])("holds %s at its own value either side of the rewrite", (id, want) => {
    const catalogue = catalog.makeDb([]);
    const build = storage.normalise({
      ...storage.defaultBuild("imported"),
      choices: { [SLOT]: id },
    });
    // Before: the build still holds the retired item, whose own flat stat this is. It is not
    // a dynamic stat at all yet, so it lands in `sums` rather than `dynamicStatMods`.
    expect(
      engine.resolveBuild(catalogue, build).stages.sums.overall_damage,
    ).toBeCloseTo(want, 10);
    expect(damage(build)).toBe(0);

    // After: the replacement's dynamic stat, seeded to the same number.
    const migrated = migrateItemIds(catalogue, build);
    expect(damage(migrated)).toBeCloseTo(want, 10);
    expect(
      engine.resolveBuild(catalogue, migrated).stages.sums.overall_damage,
    ).toBe(0);
  });
});

/** The per-row "update" button: one slot's swap, leaving the rest of the build alone. */
describe("migrateSlotItem", () => {
  it("swaps only the slot named", () => {
    const migrated = migrateSlotItem(
      testDb,
      buildWith({ choices: { ring1: "old-ring", ring2: "old-ring" } }),
      "ring1",
    );
    expect(migrated.choices).toEqual({
      ring1: "new-ring",
      ring2: "old-ring",
    });
  });

  it("seeds that slot's carried value and no other's", () => {
    const seeded = db.build(
      [
        {
          id: "fixed",
          name: "Fixed",
          filter: "test_ring",
          replacedBy: { item: "dyn", values: { overall_damage: 0.02 } },
        },
        {
          id: "dyn",
          name: "Dyn",
          filter: "test_ring",
          dynamicStats: [
            { stat: "overall_damage", min: 0, max: 0.08, default: 0.04 },
          ],
        },
      ],
      [],
      NW_SCHEMA,
      slotsData,
    );
    const migrated = migrateSlotItem(
      seeded,
      buildWith({ choices: { ring1: "fixed", ring2: "fixed" } }),
      "ring1",
    );
    expect(migrated.values.ring1).toEqual({ overall_damage: 0.02 });
    expect(migrated.values.ring2).toBeUndefined();
  });

  it("leaves occurrence counts in place while another slot still holds the retired item", () => {
    // They are keyed by item id with no slot to scope them, so moving them here would take
    // them out from under the slot that has not been migrated yet.
    const migrated = migrateSlotItem(
      testDb,
      buildWith({
        choices: { ring1: "old-ring", ring2: "old-ring" },
        occurrenceInputs: { "old-ring": { b: 3 } },
      }),
      "ring1",
    );
    expect(migrated.occurrenceInputs).toEqual({ "old-ring": { b: 3 } });
  });

  it("moves them once the last slot holding it is migrated", () => {
    const migrated = migrateSlotItem(
      testDb,
      buildWith({
        choices: { ring1: "old-ring" },
        occurrenceInputs: { "old-ring": { b: 3 } },
      }),
      "ring1",
    );
    expect(migrated.occurrenceInputs).toEqual({ "new-ring": { b: 3 } });
  });

  it("does nothing to a slot whose pick is not retired", () => {
    const build = buildWith({ choices: { ring1: "live" } });
    expect(migrateSlotItem(testDb, build, "ring1")).toBe(build);
  });
});

describe("the shipped catalogue", () => {
  // Both retirement fields have to be in `validate`'s known-item-field allowlist, or every
  // entry carrying one is reported as a misspelled stat. Pinned on the real catalogue rather
  // than a fixture, since the allowlist only matters for what actually ships.
  it("lints clean at error level", () => {
    const base = catalog.base();
    const errors = catalog
      .validate(
        base.items,
        base.bonuses,
        undefined,
        base.sectionPresets,
        base.slots,
      )
      .filter((finding) => finding.level === "error");
    expect(errors).toEqual([]);
  });
});

describe("validateReplacements", () => {
  const messages = (entries: Item[]) =>
    catalog.validateReplacements(entries).map((finding) => finding.message);

  it("passes a chain that ends somewhere real", () => {
    expect(messages([oldRing, newRing])).toEqual([]);
  });

  it("reports a self-reference", () => {
    expect(
      messages([{ id: "a", name: "A", filter: "f", replacedBy: "a" }]),
    ).toEqual(["replacedBy points at itself"]);
  });

  it("reports a dangling target", () => {
    expect(
      messages([{ id: "a", name: "A", filter: "f", replacedBy: "gone" }]),
    ).toEqual(['replacedBy "gone" is not an item in the catalogue']);
  });

  it("reports a cycle once per member", () => {
    expect(
      messages([
        { id: "a", name: "A", filter: "f", replacedBy: "b" },
        { id: "b", name: "B", filter: "f", replacedBy: "a" },
      ]),
    ).toHaveLength(2);
  });
});
