// A jump to an entry clears only the filters hiding it: a filter the entry still passes is the
// user's narrowing and stays.
import { describe, expect, it } from "vitest";
import {
  keepsRow,
  passesStatus,
  unhide,
  type EntryListFilters,
} from "../../src/lib/entry-list-filter";
import { defaultItemListFilter } from "../../src/lib/item-list-filter";
import type { Item } from "../../src/types";

const ITEM: Item = {
  id: "a",
  name: "Alpha",
  filter: "gear_head",
  quality: "rare",
};
const row = {
  name: "Alpha",
  filter: "gear_head",
  status: "base" as const,
  item: ITEM,
};

const filters = (patch: Partial<EntryListFilters> = {}): EntryListFilters => ({
  status: "all",
  query: "",
  items: defaultItemListFilter(),
  ...patch,
});

describe("passesStatus", () => {
  it("keeps changed rows for 'changed' and one status for its own filter", () => {
    expect(passesStatus("changed", "base")).toBe(false);
    expect(passesStatus("changed", "edited")).toBe(true);
    expect(passesStatus("added", "edited")).toBe(false);
    expect(passesStatus("all", "base")).toBe(true);
  });
});

describe("unhide", () => {
  it("clears the search and status that hide the row, and nothing else", () => {
    const narrowed = filters({
      status: "edited",
      query: "beta",
      items: { ...defaultItemListFilter(), category: "gear_head" },
    });
    expect(keepsRow(narrowed, row)).toBe(false);

    const { filters: next, cleared } = unhide(narrowed, row);
    expect(cleared).toEqual(["status filter", "search"]);
    expect(next.items.category).toBe("gear_head");
    expect(keepsRow(next, row)).toBe(true);
  });

  it("clears an item filter the item fails, and shows a retired item", () => {
    const narrowed = filters({
      items: { quality: "epic", category: "", hideRetired: true },
    });
    const retired = { ...row, retired: true };
    const { filters: next, cleared } = unhide(narrowed, retired);
    expect(cleared).toEqual(["quality filter", "hidden retired items"]);
    expect(keepsRow(next, retired)).toBe(true);
  });

  it("leaves the filters alone when the row already shows", () => {
    const { cleared } = unhide(filters({ query: "alp" }), row);
    expect(cleared).toEqual([]);
  });

  it("ignores the item filters outside the Items tab", () => {
    const bonus = { name: "Alpha", status: "base" as const };
    const narrowed = filters({
      items: { quality: "epic", category: "x", hideRetired: true },
    });
    expect(keepsRow(narrowed, bonus)).toBe(true);
    expect(unhide(narrowed, bonus).cleared).toEqual([]);
  });
});
