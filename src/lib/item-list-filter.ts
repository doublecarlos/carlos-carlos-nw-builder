// The layer editor's item list filters: quality, category and whether retired items show.
// An empty quality or category matches every item.
import type { Item } from "../types";

export interface ItemListFilter {
  quality: string;
  category: string;
  hideRetired: boolean;
}

/** Retired items start hidden: they are kept for old builds, rarely the ones being edited. */
export const defaultItemListFilter = (): ItemListFilter => ({
  quality: "",
  category: "",
  hideRetired: true,
});

/** Whether any filter narrows the list differently from the default. */
export const isItemListFilterActive = (filter: ItemListFilter): boolean =>
  Boolean(filter.quality || filter.category || !filter.hideRetired);

/** Whether a row passes. `item` is null for a removed item, which only the quality and
 *  category filters hide, since neither can be read from it. */
export function keepsItem(
  filter: ItemListFilter,
  item: Item | null,
  retired: boolean,
): boolean {
  if (!item) return !filter.quality && !filter.category;
  if (filter.quality && item.quality !== filter.quality) return false;
  if (filter.category && item.filter !== filter.category) return false;
  return !(filter.hideRetired && retired);
}
