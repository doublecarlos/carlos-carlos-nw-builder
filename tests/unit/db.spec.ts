// db.ts's `itemByGameId`: the game `Hitem` -> catalogue item id index the game importer will
// resolve against. Exercised through catalog.makeDb so "base"/"overlay" mean what the ticket
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
    expect(built.itemByGameId.get("Base_Gid")).toBe("a");
  });

  it("is empty when nothing in the composed catalogue carries gameIds", () => {
    const built = catalog.makeDb([]);
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
    expect(built.itemByGameId.get("Test_Overlay_Only_Gid")).toBe("new-item");
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
    expect(built.itemByGameId.get("Test_Overlay_Override_Gid")).toBe(
      baseItem.id,
    );
  });

  it("one item can claim several game ids", () => {
    const overlay = catalog.upsert(catalog.emptyOverlay(), "items", "multi", {
      id: "multi",
      name: "Multi",
      filter: "gear_ring",
      gameIds: ["Gid_One", "Gid_Two"],
    } as Item);
    const built = catalog.makeDb([overlay]);
    expect(built.itemByGameId.get("Gid_One")).toBe("multi");
    expect(built.itemByGameId.get("Gid_Two")).toBe("multi");
  });

  it("two different items claiming the same game id resolve deterministically, not by throwing", () => {
    // catalog.validate flags this data as ambiguous (an error) -- this only proves the index
    // itself degrades gracefully rather than erroring at lookup time.
    const overlay = catalog.upsert(
      catalog.upsert(catalog.emptyOverlay(), "items", "a", {
        id: "a",
        name: "A",
        filter: "gear_ring",
        gameIds: ["Shared_Gid"],
      } as Item),
      "items",
      "b",
      { id: "b", name: "B", filter: "gear_ring", gameIds: ["Shared_Gid"] },
    );
    const built = catalog.makeDb([overlay]);
    expect(["a", "b"]).toContain(built.itemByGameId.get("Shared_Gid"));
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
    pointAssignment: { min: 0, max: 3, default: 0 },
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
      compare: { id: "", highlight: false, onlyDiff: false },
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
