// Resolving a `list` build_parameter's `optionsFrom` selector into a concrete option list.
//
// Pure, and deliberately not a method on `Db`: db.ts calls it while *building* the slot list,
// and catalog.ts's `allowedClass` lint calls it with a bare item array and no `Db` in reach.
// One implementation so the two can never disagree about what the option set is.

import type { BuildParameterSlot, Item } from "../types";

export type ParamOption = { value: string; label: string };

/** The label of the empty row, matching what every inline-authored list param already uses. */
export const EMPTY_OPTION: ParamOption = { value: "", label: "- none -" };

/**
 * The items an `optionsFrom` selector picks out, ordered by name.
 *
 * Name and not `Db.forSlot`'s item-level-first order: an option set is a vocabulary to pick a
 * known value out of, not a ranking of which is best. `hideFromPicker` items are excluded for
 * the same reason a picker excludes them -- they exist to be reached some other way.
 */
export function optionsFromItems(
  selector: { filter?: string; tags?: string[] },
  items: Item[],
): Item[] {
  const tags = selector.tags?.length ? new Set(selector.tags) : null;
  return items
    .filter((item) => {
      if (item.hideFromPicker) return false;
      return tags
        ? (item.tags ?? []).some((tag) => tags.has(tag))
        : item.filter === selector.filter;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * A param's effective options: its own `options` when authored inline, or one option per
 * matching item when it declares `optionsFrom`, taking its `value` from the item id and its
 * `label` from the item name.
 *
 * The option names an item but does not equip one -- a parameter equips nothing.
 * A derived option set is a vocabulary borrowed from the catalogue, which is what makes it
 * useful for the engine-coupled scalars (role, damage type) that stay parameters; anything
 * that should also *bring* the item is an `item_picker` with `Item.publishes`.
 */
export function resolvedOptions(
  slot: BuildParameterSlot,
  items: Item[],
): ParamOption[] | undefined {
  if (!slot.optionsFrom) return slot.options;
  const derived = optionsFromItems(slot.optionsFrom, items).map((item) => ({
    value: item.id,
    label: item.name,
  }));
  return slot.allowEmpty ? [EMPTY_OPTION, ...derived] : derived;
}
