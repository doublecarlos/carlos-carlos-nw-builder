// The layer editor's item list filter rule: which rows each filter keeps.
import { describe, expect, it } from "vitest";
import {
  defaultItemListFilter,
  isItemListFilterActive,
  keepsItem,
} from "../../src/lib/item-list-filter";
import type { Item } from "../../src/types";

const ITEM: Item = { id: "a", name: "A", filter: "gear_head", quality: "rare" };

describe("keepsItem", () => {
  it("hides retired items by default and keeps them once allowed", () => {
    const filter = defaultItemListFilter();
    expect(keepsItem(filter, ITEM, true)).toBe(false);
    expect(keepsItem(filter, ITEM, false)).toBe(true);
    expect(keepsItem({ ...filter, hideRetired: false }, ITEM, true)).toBe(true);
  });

  it("matches quality and category exactly", () => {
    const filter = defaultItemListFilter();
    expect(keepsItem({ ...filter, quality: "rare" }, ITEM, false)).toBe(true);
    expect(keepsItem({ ...filter, quality: "epic" }, ITEM, false)).toBe(false);
    expect(keepsItem({ ...filter, category: "gear_head" }, ITEM, false)).toBe(
      true,
    );
    expect(keepsItem({ ...filter, category: "gear_ring" }, ITEM, false)).toBe(
      false,
    );
  });

  // A removed item has no fields left to match, so only the field filters hide it.
  it("keeps a removed item unless quality or category is set", () => {
    const filter = defaultItemListFilter();
    expect(keepsItem(filter, null, false)).toBe(true);
    expect(keepsItem({ ...filter, quality: "rare" }, null, false)).toBe(false);
    expect(keepsItem({ ...filter, category: "gear_head" }, null, false)).toBe(
      false,
    );
  });
});

describe("isItemListFilterActive", () => {
  // Drives the Clear filters button: the default must read as inactive.
  it("is false for the default and true for any change from it", () => {
    const filter = defaultItemListFilter();
    expect(isItemListFilterActive(filter)).toBe(false);
    expect(isItemListFilterActive({ ...filter, quality: "rare" })).toBe(true);
    expect(isItemListFilterActive({ ...filter, category: "x" })).toBe(true);
    expect(isItemListFilterActive({ ...filter, hideRetired: false })).toBe(
      true,
    );
  });
});
