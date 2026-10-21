// Nested slots. An `item_picker` naming a `parent` renders right after that slot, indented
// under it, and is unavailable while the parent is unavailable or empty.
import type { Slot } from "../types";

/** The id a slot names as its `parent`, or undefined for a top-level one. */
export function parentOf(slot: Slot): string | undefined {
  return slot.type === "item_picker" ? slot.parent : undefined;
}

/**
 * Whether `slot` nests under `parent`: a top-level `item_picker` of the same section. A slot
 * whose parent fails this stays where it is authored, and lint reports it.
 */
export function nestsUnder(slot: Slot, parent: Slot | undefined): boolean {
  return (
    !!parent &&
    parent.id !== slot.id &&
    parent.type === "item_picker" &&
    !parent.parent &&
    parent.section === slot.section
  );
}

/** The id of the parent `slot` actually nests under, looked up in `byId`. */
export function nestedParentId(
  slot: Slot,
  byId: ReadonlyMap<string, Slot>,
): string | undefined {
  const parentId = parentOf(slot);
  return parentId && nestsUnder(slot, byId.get(parentId))
    ? parentId
    : undefined;
}

/**
 * One section's `ordered` slots with every nested slot moved right after its parent, children
 * keeping their relative order.
 */
export function groupUnderParents<T extends Slot>(ordered: T[]): T[] {
  const byId = new Map<string, Slot>(ordered.map((slot) => [slot.id, slot]));
  const children = new Map<string, T[]>();
  for (const slot of ordered) {
    const parentId = nestedParentId(slot, byId);
    if (!parentId) continue;
    const list = children.get(parentId);
    if (list) list.push(slot);
    else children.set(parentId, [slot]);
  }
  if (!children.size) return ordered;

  const out: T[] = [];
  for (const slot of ordered) {
    if (nestedParentId(slot, byId)) continue;
    out.push(slot, ...(children.get(slot.id) ?? []));
  }
  return out;
}

/**
 * Where a one-step move of `slotId` among its section's `members` (in render order) lands, as
 * an index counted without the slot, or null at the end of its range. A parent steps over its
 * own nested slots, and a nested slot stays among its siblings.
 */
export function stepIndex(
  members: Slot[],
  slotId: string,
  delta: 1 | -1,
): number | null {
  const index = members.findIndex((slot) => slot.id === slotId);
  if (index === -1) return null;
  const byId = new Map(members.map((slot) => [slot.id, slot]));
  const parentId = nestedParentId(members[index], byId);
  let low = 0;
  let high = members.length - 1;
  if (parentId) {
    low = members.findIndex((slot) => slot.id === parentId) + 1;
    high = low;
    while (
      high + 1 < members.length &&
      nestedParentId(members[high + 1], byId) === parentId
    )
      high += 1;
  }
  const children = members.filter(
    (slot) => nestedParentId(slot, byId) === slotId,
  ).length;
  const to = index + (delta > 0 ? delta + children : delta);
  return to < low || to > high ? null : to;
}

/** Where a nested row sits among its rendered siblings. */
export interface NestPosition {
  /** Right below its parent. */
  first: boolean;
  /** No nested sibling below it. */
  last: boolean;
}
