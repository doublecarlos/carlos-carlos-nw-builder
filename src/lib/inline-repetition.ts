// How many times one item repeats at one slot -- `Item.inlineRepetition`, stored in
// `Build.assignments[slotId][itemId]`. Pure reads off the build and the item, shared so the
// engine, the compare-diff helpers and the row components cannot disagree on the answer.
import type {
  Build,
  Db,
  Item,
  ItemPickerSlot,
  PointAssignmentSlot,
} from "../types";

/** `item`'s repetition count at `slotId`. No config means "in the build exactly once", so this
 * returns 1 and every caller can multiply unconditionally. Otherwise the stored count, falling
 * back to the config's `default` when the build has never touched it -- the same fallback
 * `occurrenceCountFor` and `readDynamicValue` make for their own configs. */
export function inlineRepetitionCount(
  build: Build,
  slotId: string,
  item: Item,
): number {
  const config = item.inlineRepetition;
  if (!config) return 1;
  return build.assignments?.[slotId]?.[item.id] ?? config.default;
}

/** The items whose repetition counts `slot` stores: every candidate of a `point_assignment`
 * slot, or the one item an `item_picker` currently holds if it declares a config. The single
 * place the two slot types differ, so nothing else has to branch on `slot.type`. */
export function repetitionRows(
  db: Db,
  build: Build | null | undefined,
  slot: PointAssignmentSlot | ItemPickerSlot,
): Item[] {
  if (slot.type === "point_assignment") return db.forSlot(slot.id);
  const item = db.get(build?.choices?.[slot.id]);
  return item?.inlineRepetition ? [item] : [];
}
