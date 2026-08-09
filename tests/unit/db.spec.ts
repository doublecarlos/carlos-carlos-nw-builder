// db.ts's `itemByGameId`: the game `Hitem` -> catalogue item id index the game importer will
// resolve against. Exercised through catalog.makeDb so "base"/"overlay" mean what the ticket
// means by those words -- db.build() itself has no concept of either, it just indexes
// whatever composed item list it's handed.
import { describe, it, expect } from "vitest";
import * as catalog from "../../src/data/catalog";
import * as db from "../../src/data/db";
import { NW_SCHEMA, NW_SLOTS } from "../../src/data/data";
import type { Item } from "../../src/types";

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
