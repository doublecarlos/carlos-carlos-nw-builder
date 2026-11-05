// A value rebuilt on every pass keeps its previous identity while its contents are unchanged,
// so a prop Vue compares by identity only changes when what it holds does.
import { deepEqual } from "./deep-equal";

/** `previous` when it holds the same elements, by identity and in order, otherwise `next`. */
export function keepArray<T>(previous: T[] | undefined, next: T[]): T[] {
  if (!previous || previous.length !== next.length) return next;
  return next.every((value, i) => value === previous[i]) ? previous : next;
}

/** `previous` when it holds the same entries, values by identity, otherwise `next`. */
export function keepMap<K, V>(
  previous: ReadonlyMap<K, V> | undefined,
  next: ReadonlyMap<K, V>,
): ReadonlyMap<K, V> {
  if (!previous || previous.size !== next.size) return next;
  for (const [key, value] of next) {
    if (previous.get(key) !== value || !previous.has(key)) return next;
  }
  return previous;
}

/** `previous` when it holds the same members, otherwise `next`. */
export function keepSet<T>(
  previous: ReadonlySet<T> | undefined,
  next: ReadonlySet<T>,
): ReadonlySet<T> {
  if (!previous || previous.size !== next.size) return next;
  for (const value of next) if (!previous.has(value)) return next;
  return previous;
}

/** `previous` when it is deeply equal to `next`, otherwise `next`. For small plain values that
 *  are rebuilt as new objects on every pass. */
export function keepEqual<T>(previous: T | undefined, next: T): T {
  return previous !== undefined && deepEqual(previous, next) ? previous : next;
}
