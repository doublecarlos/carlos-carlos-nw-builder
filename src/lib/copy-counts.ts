// How many copies of each item a build holds, for `Item.maxCopies`.
//
// One function for both readers: the engine reports the cap being exceeded and the picker
// withholds the candidate that would exceed it, so a disagreement reads as a pick that succeeds
// and is then flagged.
import { expandSlots } from "./item-picker-list";
import { assignedRows, inlineRepetitionCount } from "./inline-repetition";
import type { Build, Db } from "../types";

/**
 * A switched-off pick counts like any other: the checkbox takes it out of the calculation, not
 * out of the slot it occupies.
 *
 * `exclude` drops one slot's own pick, so an `item_picker` never counts what it already holds
 * against itself and re-selecting it reads as "would exceed".
 */
export function copyCounts(
  db: Db,
  build: Build,
  exclude?: string,
): Map<string, number> {
  const counts = new Map<string, number>();
  const bump = (id: string, by: number) =>
    counts.set(id, (counts.get(id) ?? 0) + by);

  for (const slot of expandSlots(db.slots, build)) {
    if (slot.type === "point_assignment") {
      for (const { item, count } of assignedRows(db, build, slot)) {
        if (count > 0) bump(item.id, count);
      }
      continue;
    }
    if (slot.type !== "item_picker" || slot.id === exclude) continue;
    const item = db.get(build.choices?.[slot.id]);
    if (item) bump(item.id, inlineRepetitionCount(build, slot.id, item));
  }
  return counts;
}
