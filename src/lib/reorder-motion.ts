// Pure parts of the list slide (useReorderMotion): what kind of change a list went through,
// which row the user moved, and how far each row has to travel back to where it was drawn.

/**
 * How a list's keys changed, for what its rows should do about it:
 * - `reorder`: the same keys in another order (a drop, an undo, a move up/down);
 * - `insert`: keys only added, the rest kept in order (add, insert, duplicate);
 * - `change`: anything else that keeps at least one key (a delete, a save that re-keys a row);
 * - `null`: the first read, nothing changed, or no key survived (another list entirely).
 */
export function listChange(
  previous: readonly string[] | undefined,
  next: readonly string[],
): "reorder" | "insert" | "change" | null {
  if (!previous) return null;
  if (isReorder(previous, next)) return "reorder";
  if (
    previous.length === next.length &&
    previous.every((key, i) => key === next[i])
  )
    return null;
  const kept = new Set(next);
  if (!previous.some((key) => kept.has(key))) return null;
  const old = new Set(previous);
  const survivors = next.filter((key) => old.has(key));
  const onlyAdded =
    survivors.length === previous.length &&
    survivors.every((key, i) => key === previous[i]);
  return onlyAdded ? "insert" : "change";
}

/** True when `next` holds exactly the keys of `previous`, in a different order: a drop, an
 *  undo or a move up/down. A row added, removed, filtered out or folded away is not one. */
export function isReorder(
  previous: readonly string[] | undefined,
  next: readonly string[],
): boolean {
  if (!previous || previous.length !== next.length) return false;
  if (previous.every((key, i) => key === next[i])) return false;
  const remaining = new Map<string, number>();
  for (const key of previous) remaining.set(key, (remaining.get(key) ?? 0) + 1);
  for (const key of next) {
    const left = remaining.get(key);
    if (!left) return false;
    remaining.set(key, left - 1);
  }
  return true;
}

/**
 * The rows the user moved, as opposed to the ones they displaced, in `next` order. A swap of
 * neighbours reads the same either way, so a `hint` (the row dropped or holding focus) is
 * taken first when moving it, with the rows `nested` inside it, explains the new order.
 * Otherwise the moved rows are the ones outside the longest run that kept its order.
 */
export function movedKeys(
  previous: readonly string[],
  next: readonly string[],
  hints: readonly (string | null)[],
  nested: (key: string) => readonly string[] = () => [],
): string[] {
  for (const hint of hints) {
    if (!hint || !next.includes(hint)) continue;
    const carried = new Set([hint, ...nested(hint)]);
    const without = (keys: readonly string[]) =>
      keys.filter((k) => !carried.has(k));
    const a = without(previous);
    const b = without(next);
    if (a.every((key, i) => key === b[i])) return [hint];
  }

  const kept = new Set(longestOrderedRun(previous, next));
  return next.filter((key) => !kept.has(key));
}

/** The longest subsequence of `next` that appears in the same order in `previous`. */
function longestOrderedRun(
  previous: readonly string[],
  next: readonly string[],
): string[] {
  const position = new Map(previous.map((key, i) => [key, i]));
  const ranks = next.map((key) => position.get(key) ?? -1);
  // Patience sorting: `tails[l]` is the index in `next` ending the best run of length l + 1.
  const tails: number[] = [];
  const back: number[] = new Array(next.length).fill(-1);
  ranks.forEach((rank, i) => {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (ranks[tails[mid]] < rank) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) back[i] = tails[lo - 1];
    tails[lo] = i;
  });
  const run: string[] = [];
  for (let i = tails.at(-1) ?? -1; i >= 0; i = back[i]) run.push(next[i]);
  return run.reverse();
}

export interface Box {
  top: number;
  bottom: number;
}

/**
 * How far to scroll so `row` shows inside `view`, like `block: "nearest"`, except that a row
 * taller than the view lines up its top, where its header is. Zero when it already shows.
 */
export function revealDelta(row: Box, view: Box): number {
  if (row.top < view.top) return row.top - view.top;
  if (row.bottom > view.bottom)
    return Math.min(row.bottom - view.bottom, row.top - view.top);
  return 0;
}

export interface Point {
  x: number;
  y: number;
}

/**
 * The offset that draws each row back at its old position. A row inside another keyed row
 * already travels with it, so its own offset is relative to that ancestor's. Rows that did not
 * move, or are new, are left out.
 */
export function slideOffsets(
  before: ReadonlyMap<string, Point>,
  after: ReadonlyMap<string, Point>,
  parentOf: (key: string) => string | null,
): Map<string, Point> {
  const offset = (key: string): Point | null => {
    const from = before.get(key);
    const to = after.get(key);
    if (!from || !to) return null;
    return { x: from.x - to.x, y: from.y - to.y };
  };

  const result = new Map<string, Point>();
  for (const key of after.keys()) {
    const own = offset(key);
    if (!own) continue;
    const parent = parentOf(key);
    const carried = (parent && offset(parent)) || { x: 0, y: 0 };
    const x = own.x - carried.x;
    const y = own.y - carried.y;
    if (Math.abs(x) >= 0.5 || Math.abs(y) >= 0.5) result.set(key, { x, y });
  }
  return result;
}
