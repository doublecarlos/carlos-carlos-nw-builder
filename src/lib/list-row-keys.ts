// Identities for an `item_picker_list`'s rows that follow a row's content, not its position.
// Row ids are positional, so moving or removing a row hands its pick to another id; these keys
// let the editor's row motion tell which rows moved where. Held in memory only: a count that
// changed some other way (an undo, an import) falls back to plain positions.

/** The keys of a list with `count` rows: `stored` while it still matches, positions otherwise. */
export function rowKeys(
  stored: readonly string[] | undefined,
  count: number,
): readonly string[] {
  if (stored?.length === count) return stored;
  return Array.from({ length: count }, (_, i) => String(i + 1));
}

/** `keys` with the 1-based row `from` moved to `to`. */
export function moveKey(
  keys: readonly string[],
  from: number,
  to: number,
): string[] {
  const next = [...keys];
  const [moved] = next.splice(from - 1, 1);
  next.splice(to - 1, 0, moved);
  return next;
}

/** `keys` without the 1-based row `index`. */
export function removeKey(keys: readonly string[], index: number): string[] {
  return keys.filter((_, i) => i !== index - 1);
}
