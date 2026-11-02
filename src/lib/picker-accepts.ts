// Whether a picker slot admits an item, by its `filter` or `tags`. `Db.forSlot` lists by the
// same rule, so a pick this rejects is one the slot would never have offered.
import type { Item, ItemPickerListSlot, ItemPickerSlot } from "../types";

export const pickerAccepts = (
  slot: ItemPickerSlot | ItemPickerListSlot,
  item: Item,
): boolean =>
  slot.tags?.length
    ? slot.tags.some((tag) => item.tags?.includes(tag))
    : item.filter === slot.filter;
