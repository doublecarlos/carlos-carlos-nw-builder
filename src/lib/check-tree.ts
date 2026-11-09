// Tick state over a tree drawn by tree-rows.ts. A heading stands for every item nested under
// it at any depth: ticking it ticks them all, and it reads as mixed while only some are.
import type { TreeRow } from "./tree-rows";

export type CheckState = "on" | "off" | "mixed";

/** The ids of the items under each heading row, keyed by that row's index. */
export function headingMembers<T>(
  rows: readonly TreeRow<T>[],
  idOf: (item: T) => string,
): Map<number, string[]> {
  const members = new Map<number, string[]>();
  const open: { index: number; depth: number }[] = [];
  rows.forEach((row, index) => {
    // A row at or above a heading's depth has left that heading.
    while (open.length && open[open.length - 1].depth >= row.depth) open.pop();
    if (row.kind === "heading") {
      members.set(index, []);
      open.push({ index, depth: row.depth });
      return;
    }
    const id = idOf(row.item);
    for (const heading of open) members.get(heading.index)!.push(id);
  });
  return members;
}

/** Whether all, none or some of `ids` are ticked. No ids reads as off. */
export function checkState(
  ids: readonly string[],
  ticked: ReadonlySet<string>,
): CheckState {
  const count = ids.filter((id) => ticked.has(id)).length;
  if (count === 0) return "off";
  return count === ids.length ? "on" : "mixed";
}

/** A copy of `ticked` with every one of `ids` ticked, or every one unticked. */
export function setTicked(
  ticked: ReadonlySet<string>,
  ids: readonly string[],
  on: boolean,
): Set<string> {
  const next = new Set(ticked);
  for (const id of ids) {
    if (on) next.add(id);
    else next.delete(id);
  }
  return next;
}
