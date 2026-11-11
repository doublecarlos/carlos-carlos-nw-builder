// The layer editor's entry list filters taken together: status, search text and, on the Items
// tab, the item filters. `unhide` works out which of them hide a row, for a jump that has to
// show it.
import type { EntryStatus } from "../data/catalog";
import type { Item } from "../types";
import { matchesQuery } from "./text-filter";
import { keepsItem, type ItemListFilter } from "./item-list-filter";

export interface EntryListFilters {
  status: string;
  query: string;
  items: ItemListFilter;
}

/** What the filters read off a row. `item` is set on the Items tab only, null for a removed
 *  item. */
export interface FilterableRow {
  name: string;
  filter?: string;
  status: EntryStatus;
  item?: Item | null;
  retired?: boolean;
}

export function passesStatus(filter: string, status: EntryStatus): boolean {
  if (filter === "changed") return status !== "base";
  if (filter === "added" || filter === "edited" || filter === "removed")
    return status === filter;
  return true;
}

const passesQuery = (query: string, row: FilterableRow) =>
  matchesQuery([row.name, row.filter ?? ""], query);

const passesItems = (items: ItemListFilter, row: FilterableRow) =>
  row.item === undefined || keepsItem(items, row.item, row.retired ?? false);

export function keepsRow(filters: EntryListFilters, row: FilterableRow) {
  return (
    passesStatus(filters.status, row.status) &&
    passesItems(filters.items, row) &&
    passesQuery(filters.query, row)
  );
}

/** The filters with whatever hides `row` reset, and the names of what was reset. Filters the
 *  row already passes stay as they are. */
export function unhide(
  filters: EntryListFilters,
  row: FilterableRow,
): { filters: EntryListFilters; cleared: string[] } {
  const cleared: string[] = [];
  const next: EntryListFilters = { ...filters, items: { ...filters.items } };
  if (!passesStatus(filters.status, row.status)) {
    next.status = "all";
    cleared.push("status filter");
  }
  if (!passesQuery(filters.query, row)) {
    next.query = "";
    cleared.push("search");
  }
  if (row.item !== undefined) {
    const item = row.item;
    const { quality, category } = filters.items;
    if (quality && (!item || item.quality !== quality)) {
      next.items.quality = "";
      cleared.push("quality filter");
    }
    if (category && (!item || item.filter !== category)) {
      next.items.category = "";
      cleared.push("category filter");
    }
    if (filters.items.hideRetired && item && row.retired) {
      next.items.hideRetired = false;
      cleared.push("hidden retired items");
    }
  }
  return { filters: next, cleared };
}
