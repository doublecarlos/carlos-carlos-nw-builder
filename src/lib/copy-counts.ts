// How many copies of each item a build holds, for `Item.maxCopies`.

import { expandSlots } from "./item-picker-list";
import { assignedRows, inlineRepetitionCount } from "./inline-repetition";
import type { Build, Db } from "../types";

/**
 * Build-wide number of copies for each item.
 */
export function copyCounts(db: Db, build: Build): Map<string, number> {
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
    if (slot.type !== "item_picker") continue;
    const item = db.get(build.choices?.[slot.id]);
    if (item) bump(item.id, inlineRepetitionCount(build, slot.id, item));
  }
  return counts;
}

/**
 * The build-wide tally as one slot sees it, minus that slot's own pick, so an `item_picker`
 * never counts what it already holds against itself.
 */
export function copyCountsExcluding(
  db: Db,
  build: Build,
  slotId: string,
  counts: Map<string, number>,
): Map<string, number> {
  if (db.slotFor(slotId)?.type !== "item_picker") return counts;
  const item = db.get(build.choices?.[slotId]);
  if (!item) return counts;
  const own = inlineRepetitionCount(build, slotId, item);
  if (!own) return counts;
  const next = new Map(counts);
  const remaining = (next.get(item.id) ?? 0) - own;
  if (remaining > 0) next.set(item.id, remaining);
  else next.delete(item.id);
  return next;
}
