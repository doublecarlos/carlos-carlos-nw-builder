// db.ts's `itemByGameId`: the game `Hitem` -> claiming catalogue item ids index the game
// importer will resolve against. Exercised through catalog.makeDb so "base"/"overlay" mean what the ticket
// means by those words -- db.build() itself has no concept of either, it just indexes
// whatever composed item list it's handed.
import { describe, it, expect } from "vitest";
import * as catalog from "../../src/data/catalog";
import * as db from "../../src/data/db";
import { NW_SCHEMA, NW_SLOTS } from "../../src/data/data";
import type { Build, Item, SlotsData } from "../../src/types";

describe("Db.itemByGameId", () => {
  it("indexes a plain item's gameIds -- the base case, no overlay involved", () => {
    const built = db.build(
      [{ id: "a", name: "A", filter: "gear_ring", gameIds: ["Base_Gid"] }],
      [],
      NW_SCHEMA,
      NW_SLOTS,
    );
    expect(built.itemByGameId.get("Base_Gid")).toEqual(["a"]);
  });

  it("is empty when nothing in the composed catalogue carries gameIds", () => {
    // Spelled out as an explicit item list rather than `catalog.makeDb([])`: the shipped
    // catalogue authors gameIds of its own now, so base is no longer an example of "nothing".
    const built = db.build(
      [{ id: "a", name: "A", filter: "gear_ring" }],
      [],
      NW_SCHEMA,
      NW_SLOTS,
    );
    expect(built.itemByGameId.size).toBe(0);
  });

  it("resolves an overlay-only item with no base counterpart", () => {
    const overlay = catalog.upsert(
      catalog.emptyOverlay(),
      "items",
      "new-item",
      {
        id: "new-item",
        name: "New Item",
        filter: "gear_ring",
        gameIds: ["Test_Overlay_Only_Gid"],
      } as Item,
    );
    const built = catalog.makeDb([overlay]);
    expect(built.itemByGameId.get("Test_Overlay_Only_Gid")).toEqual([
      "new-item",
    ]);
  });

  it("reflects an overlay's edit to a base item's gameIds", () => {
    const baseItem = catalog.base().items[0];
    const overlay = catalog.upsert(
      catalog.emptyOverlay(),
      "items",
      baseItem.id,
      { ...baseItem, gameIds: ["Test_Overlay_Override_Gid"] },
    );
    const built = catalog.makeDb([overlay]);
    expect(built.itemByGameId.get("Test_Overlay_Override_Gid")).toEqual([
      baseItem.id,
    ]);
  });

  it("one item can claim several game ids", () => {
    const overlay = catalog.upsert(catalog.emptyOverlay(), "items", "multi", {
      id: "multi",
      name: "Multi",
      filter: "gear_ring",
      gameIds: ["Gid_One", "Gid_Two"],
    } as Item);
    const built = catalog.makeDb([overlay]);
    expect(built.itemByGameId.get("Gid_One")).toEqual(["multi"]);
    expect(built.itemByGameId.get("Gid_Two")).toEqual(["multi"]);
  });

  it("keeps every item claiming one game id, in catalogue order", () => {
    // One in-game enchantment is modelled here as its offense and defense forms; both carry
    // the `Hitem` the game records, and demo-slots.ts picks between them by slot.
    const overlay = catalog.upsert(
      catalog.upsert(catalog.emptyOverlay(), "items", "a", {
        id: "a",
        name: "A",
        filter: "enchantment_offense",
        gameIds: ["Shared_Gid"],
      } as Item),
      "items",
      "b",
      {
        id: "b",
        name: "B",
        filter: "enchantment_defense",
        gameIds: ["Shared_Gid"],
      },
    );
    const built = catalog.makeDb([overlay]);
    expect(built.itemByGameId.get("Shared_Gid")).toEqual(["a", "b"]);
  });

  it("keeps both claimants even when they share a filter -- validate's job, not the index's", () => {
    // catalog.validate flags same-filter claimants as ambiguous (an error); the index itself
    // still degrades gracefully rather than dropping one silently.
    const overlay = catalog.upsert(
      catalog.upsert(catalog.emptyOverlay(), "items", "a", {
        id: "a",
        name: "A",
        filter: "gear_ring",
        gameIds: ["Ambiguous_Gid"],
      } as Item),
      "items",
      "b",
      { id: "b", name: "B", filter: "gear_ring", gameIds: ["Ambiguous_Gid"] },
    );
    const built = catalog.makeDb([overlay]);
    expect(built.itemByGameId.get("Ambiguous_Gid")).toEqual(["a", "b"]);
  });
});

// forSlotAndBuild's maxCopies filtering (issue #198): an item_picker candidate already at its
// cap elsewhere in the build should never appear in that picker's dropdown, the same "hide
// rather than pick-then-flag" outcome #196's hideFromPicker gives problem grants -- but via a
// dedicated cheap tally of build.choices/build.assignments, not a per-candidate engine resolve.
describe("forSlotAndBuild maxCopies filtering", () => {
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
        id: "ring3",
        label: "Ring 3",
        section: "gear",
        type: "item_picker",
        filter: "test_ring",
      },
      {
        id: "sharedPicker",
        label: "Shared",
        section: "gear",
        type: "item_picker",
        filter: "test_shared",
      },
      {
        id: "boons.tier1",
        label: "Boons",
        section: "boons",
        type: "point_assignment",
        filter: "test_shared",
      },
    ],
  };

  const unlimited: Item = {
    id: "unlimited",
    name: "Unlimited Ring",
    filter: "test_ring",
  };
  const capped1: Item = {
    id: "capped1",
    name: "Single Ring",
    filter: "test_ring",
    maxCopies: 1,
  };
  const capped2: Item = {
    id: "capped2",
    name: "Double Ring",
    filter: "test_ring",
    maxCopies: 2,
  };
  const sharedItem: Item = {
    id: "shared-item",
    name: "Shared Item",
    filter: "test_shared",
    maxCopies: 1,
    inlineRepetition: { min: 0, max: 3, default: 0 },
  };

  const testDb = db.build(
    [unlimited, capped1, capped2, sharedItem],
    [],
    NW_SCHEMA,
    slotsData,
  );

  function buildWith(
    choices: Record<string, string>,
    assignments: Record<string, Record<string, number>> = {},
  ): Build {
    return {
      id: "b",
      name: "b",
      choices,
      values: {},
      assignments,
      procs: {},
      context: { class: "" },
      compare: { id: "", highlight: false, onlyDiff: false, statLines: false },
    } as unknown as Build;
  }

  it("excludes a candidate already at its maxCopies cap elsewhere in the build", () => {
    const candidates = db
      .forSlotAndBuild(testDb, "ring2", buildWith({ ring1: "capped1" }))
      .map((i) => i.id);
    expect(candidates).not.toContain("capped1");
    expect(candidates).toContain("unlimited");
  });

  it("does not count a slot's own current choice against itself", () => {
    const candidates = db
      .forSlotAndBuild(testDb, "ring1", buildWith({ ring1: "capped1" }))
      .map((i) => i.id);
    expect(candidates).toContain("capped1");
  });

  it("stays selectable below its cap and drops once the cap is reached", () => {
    const oneUsed = db
      .forSlotAndBuild(testDb, "ring2", buildWith({ ring1: "capped2" }))
      .map((i) => i.id);
    expect(oneUsed).toContain("capped2");

    const bothUsed = db
      .forSlotAndBuild(
        testDb,
        "ring3",
        buildWith({ ring1: "capped2", ring2: "capped2" }),
      )
      .map((i) => i.id);
    expect(bothUsed).not.toContain("capped2");
  });

  it("never filters an item with no maxCopies set (0/unset = unlimited)", () => {
    const candidates = db
      .forSlotAndBuild(
        testDb,
        "ring3",
        buildWith({ ring1: "unlimited", ring2: "unlimited" }),
      )
      .map((i) => i.id);
    expect(candidates).toContain("unlimited");
  });

  it("counts a point_assignment slot's assigned points toward the same item_picker cap", () => {
    const build = buildWith({}, { "boons.tier1": { "shared-item": 1 } });
    const candidates = db
      .forSlotAndBuild(testDb, "sharedPicker", build)
      .map((i) => i.id);
    expect(candidates).not.toContain("shared-item");
  });

  it("leaves a point_assignment slot's own rows unfiltered -- the cap only gates item_picker dropdowns", () => {
    const build = buildWith({}, { "boons.tier1": { "shared-item": 1 } });
    const candidates = db
      .forSlotAndBuild(testDb, "boons.tier1", build)
      .map((i) => i.id);
    expect(candidates).toContain("shared-item");
  });
});

// forSlot's tag-based resolution (#246): an item_picker slot with `tags` instead of `filter`
// selects every item carrying at least one of those tags, OR-matched via itemsByTag, letting one
// item serve several slots at once (e.g. a companion power that's both offense and utility).
describe("forSlot tag-based item_picker resolution", () => {
  const slotsData: SlotsData = {
    sections: [{ id: "companions", label: "Companions" }],
    slots: [
      {
        id: "companions.offense",
        label: "Offense",
        section: "companions",
        type: "item_picker",
        tags: ["companion_power:offense"],
      },
      {
        id: "companions.universal",
        label: "Universal",
        section: "companions",
        type: "item_picker",
        tags: [
          "companion_power:offense",
          "companion_power:defense",
          "companion_power:utility",
        ],
      },
      {
        id: "companions.equip1",
        label: "Equip 1",
        section: "companions",
        type: "item_picker",
        filter: "companion_equip",
      },
    ],
  };

  const offensePower: Item = {
    id: "offense-power",
    name: "Offense Power",
    filter: "companion_power",
    tags: ["companion_power:offense"],
  };
  const dualRolePower: Item = {
    id: "dual-role-power",
    name: "Dual Role Power",
    filter: "companion_power",
    tags: ["companion_power:offense", "companion_power:utility"],
  };
  const defensePower: Item = {
    id: "defense-power",
    name: "Defense Power",
    filter: "companion_power",
    tags: ["companion_power:defense"],
  };
  const untaggedEquip: Item = {
    id: "untagged-equip",
    name: "Untagged Equip",
    filter: "companion_equip",
  };

  const testDb = db.build(
    [offensePower, dualRolePower, defensePower, untaggedEquip],
    [],
    NW_SCHEMA,
    slotsData,
  );

  it("resolves a single-tag slot to only items carrying that tag", () => {
    const ids = testDb.forSlot("companions.offense").map((i) => i.id);
    expect(ids.sort()).toEqual(["dual-role-power", "offense-power"]);
  });

  it("OR-matches a multi-tag slot, de-duplicating an item that matches more than one tag", () => {
    const ids = testDb.forSlot("companions.universal").map((i) => i.id);
    expect(ids.sort()).toEqual([
      "defense-power",
      "dual-role-power",
      "offense-power",
    ]);
    // Each item appears exactly once even though dual-role-power matches two of the slot's tags.
    expect(ids).toHaveLength(3);
  });

  it("orders tag-resolved candidates the same way a filter-resolved slot does", () => {
    // None of these fixtures carry an `il`, so they all tie there and fall through to the name
    // tiebreak -- which is the common case in this catalogue, not an edge one.
    const names = testDb.forSlot("companions.universal").map((i) => i.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it("leaves a filter-only slot resolving exactly as before", () => {
    const ids = testDb.forSlot("companions.equip1").map((i) => i.id);
    expect(ids).toEqual(["untagged-equip"]);
  });

  it("forSlotAndBuild still applies maxCopies/allowedClass on top of tag-resolved candidates", () => {
    const cappedOffensePower: Item = {
      ...offensePower,
      id: "capped-offense-power",
      maxCopies: 1,
    };
    const capDb = db.build(
      [cappedOffensePower, dualRolePower],
      [],
      NW_SCHEMA,
      slotsData,
    );
    const build = {
      id: "b",
      name: "b",
      choices: { "companions.universal": "capped-offense-power" },
      values: {},
      assignments: {},
      procs: {},
      context: { class: "" },
      compare: { id: "", highlight: false, onlyDiff: false, statLines: false },
    } as unknown as Build;

    const ids = db
      .forSlotAndBuild(capDb, "companions.offense", build)
      .map((i) => i.id);
    expect(ids).not.toContain("capped-offense-power");
  });
});

// Picker candidate order: item level descending, name ascending as tiebreak. iL leads because
// it is what the picker already renders per row; the name tiebreak matters more than it looks,
// since large parts of this catalogue carry no `il` at all or share one value across a whole
// category, leaving name to do the entire sort there.
describe("forSlot candidate ordering", () => {
  const slotsData: SlotsData = {
    sections: [{ id: "gear", label: "Gear" }],
    slots: [
      {
        id: "gear.ring1",
        label: "Ring 1",
        section: "gear",
        type: "item_picker",
        filter: "gear_ring",
      },
    ],
  };
  const ring = (id: string, name: string, il?: number): Item => ({
    id,
    name,
    filter: "gear_ring",
    ...(il === undefined ? {} : { il }),
  });

  it("puts the highest item level first regardless of authored order", () => {
    const built = db.build(
      [ring("low", "Alpha", 900), ring("high", "Zulu", 1200)],
      [],
      NW_SCHEMA,
      slotsData,
    );
    expect(built.forSlot("gear.ring1").map((i) => i.id)).toEqual([
      "high",
      "low",
    ]);
  });

  it("falls back to name order within one item level", () => {
    const built = db.build(
      [
        ring("c", "Charlie", 1000),
        ring("a", "Alpha", 1000),
        ring("b", "Bravo", 1000),
      ],
      [],
      NW_SCHEMA,
      slotsData,
    );
    expect(built.forSlot("gear.ring1").map((i) => i.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("sorts an il-less category purely by name rather than leaving it unordered", () => {
    const built = db.build(
      [ring("z", "Zulu"), ring("m", "Mike"), ring("a", "Alpha")],
      [],
      NW_SCHEMA,
      slotsData,
    );
    expect(built.forSlot("gear.ring1").map((i) => i.id)).toEqual([
      "a",
      "m",
      "z",
    ]);
  });

  it("ranks an item with no il below one that has it", () => {
    const built = db.build(
      [ring("none", "Alpha"), ring("some", "Zulu", 800)],
      [],
      NW_SCHEMA,
      slotsData,
    );
    expect(built.forSlot("gear.ring1").map((i) => i.id)).toEqual([
      "some",
      "none",
    ]);
  });
});

// An Item.bonuses entry can now be a bare id or a BonusOccurrenceConfig (#217) -- every join
// point that reads item.bonuses (bonusesFor, bonusMembers) has to resolve either shape to the
// same bonus id.
describe("Db.bonusesFor / bonusMembers with mixed bonus attachments", () => {
  const bonusA = { id: "bonus-a", grants: [{ stats: { power_p: 0.01 } }] };
  const bonusB = { id: "bonus-b", grants: [{ stats: { power_p: 0.02 } }] };
  const item: Item = {
    id: "mixed-item",
    name: "Mixed Item",
    filter: "gear_ring",
    bonuses: ["bonus-a", { bonus: "bonus-b", min: 0, max: 5, default: 1 }],
  };
  const built = db.build([item], [bonusA, bonusB], NW_SCHEMA, NW_SLOTS);

  it("bonusesFor resolves both a bare id and a BonusOccurrenceConfig to their bonus", () => {
    const candidates = built.bonusesFor(item);
    expect(candidates.map((c) => c.bonusId).sort()).toEqual([
      "bonus-a",
      "bonus-b",
    ]);
  });

  it("bonusMembers indexes the item under both bonus ids", () => {
    expect(built.bonusMembers.get("bonus-a")).toEqual(["mixed-item"]);
    expect(built.bonusMembers.get("bonus-b")).toEqual(["mixed-item"]);
  });
});
