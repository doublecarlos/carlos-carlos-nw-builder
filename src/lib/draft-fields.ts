// The idiom the four editor-form draft modules (item-draft.ts, preset-draft.ts, slot-draft.ts,
// bonus-draft.ts) genuinely share: converting a slot/item-keyed record to and from a row array,
// dropping an empty field on serialize, widening a cleared numeric input, and walking a draft's
// JSON for the first field that changed. None of it knows what an Item or a Slot is; each draft
// module still owns its own shape and its own field list, this just gives the four repeats of
// each idiom one implementation.
//
// The four modules stay separate on purpose: a generic mapper over them does not survive their
// shapes. An item's stat keys are flat properties on the entity itself; a slot must carry
// fields it does not recognise through verbatim, where every other draft drops them; a preset's
// occurrences are keyed by item rather than by slot; a bonus nests condition trees under
// grants. Each needs its own escape hatch, leaving the same four functions wearing a config
// object.

/** `Record<K, V>` -> a row array, the read side of every slot/item-keyed field
 *  (`Item.publishes`, `Item.defaultParams`, `SectionPreset.params`, ...). */
export function entriesToRows<V, R>(
  record: Record<string, V> | undefined,
  toRow: (key: string, value: V) => R,
): R[] {
  return Object.entries(record ?? {}).map(([key, value]) => toRow(key, value));
}

/** The write side of `entriesToRows`: rows missing a key, or whose value maps to `undefined`,
 *  are dropped rather than written back as an entry. */
export function rowsToEntries<R, V>(
  rows: R[] | undefined,
  keyOf: (row: R) => string,
  toValue: (row: R) => V | undefined,
): Record<string, V> {
  const out: Record<string, V> = {};
  for (const row of rows ?? []) {
    const key = keyOf(row);
    if (!key) continue;
    const value = toValue(row);
    if (value === undefined) continue;
    out[key] = value;
  }
  return out;
}

/** Sets `out[key] = value` unless `value` is empty: "", null/undefined, or an empty array or
 *  object. Folds the "drop empty on serialize" idiom (plain `if (x.length) out.x = x` or a
 *  conditional spread) repeated across every draft's entity conversion. */
export function putIfSet<T, K extends keyof T>(
  out: T,
  key: K,
  value: T[K] | undefined | null | "",
): void {
  if (value === undefined || value === null || value === "") return;
  if (Array.isArray(value) && value.length === 0) return;
  if (
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value as object).length === 0
  )
    return;
  out[key] = value as T[K];
}

/** A numeric draft field is widened to `number | string | null` so a cleared input reads as
 *  empty rather than `0` (see `bonus-draft.ts`'s `DynamicStatDraft` doc comment); this is
 *  "does the field hold a real value" for that shape. */
export function hasValue(v: number | string | null): boolean {
  return v != null && v !== "";
}

/** `Number(v)` when the field holds a real value, else `undefined` so `putIfSet` drops it. */
export function numberOrUnset(v: number | string | null): number | undefined {
  if (!hasValue(v)) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** One check in a `diffLabel` walk: returns the label if it recognizes the change between the
 *  old and new entity JSON, or `null` to let the next check look. Order is significant: the
 *  first check to return non-null wins, same as the `if`-chain this replaces. */
export type DiffCheck<T> = (old: T, nw: T) => string | null;

/** Parses both sides of a draft's JSON round-trip and walks `checks` in order, returning the
 *  first label produced, or `fallback` if nothing recognized the change. Every existing
 *  `diffLabel` opened with the same `JSON.parse` + `try/catch` boilerplate; this is the one
 *  implementation of that walk, typed against the entity shape `T` so a check's field access is
 *  checked at compile time instead of `any`. */
export function fieldDiffLabel<T>(
  checks: DiffCheck<T>[],
  oldJson: string,
  newJson: string,
  fallback: string,
): string {
  try {
    const old = JSON.parse(oldJson) as T;
    const nw = JSON.parse(newJson) as T;
    for (const check of checks) {
      const label = check(old, nw);
      if (label) return label;
    }
  } catch {
    // JSON parse error, shouldn't happen but be safe.
  }
  return fallback;
}

/** Labels a set-like array field's change as add/remove/edit with a count, e.g. `"add tag
 *  (2)"`. Folds the array-diff idiom `ItemForm`'s `diffArrayLabel` and `BonusForm`'s inline
 *  `excludes` check both hand-wrote the same way. */
export function arrayDiffLabel(
  noun: string,
  oldArr: unknown[],
  newArr: unknown[],
): string {
  const oldSet = new Set(oldArr.map(String));
  const newSet = new Set(newArr.map(String));
  const added = newArr.filter((v) => !oldSet.has(String(v))).length;
  const removed = oldArr.filter((v) => !newSet.has(String(v))).length;
  if (added && removed) return `edit ${noun}s (+${added} / −${removed})`;
  if (added) return `add ${noun}${added > 1 ? "s" : ""} (${added})`;
  if (removed) return `remove ${noun}${removed > 1 ? "s" : ""} (${removed})`;
  return `edit ${noun}s`;
}

/** Labels a `{ key, value }[]` stat-row change with the specific key(s) that changed, over
 *  `bonus-draft.ts`'s `StatRow` shape (or anything structurally identical to it): shared since
 *  Item's flat stats and a grant's `stats` payload are both that shape. */
export function statDiffLabel(
  oldStats: { key: string; value: number | string }[],
  newStats: { key: string; value: number | string }[],
): string {
  const oldMap = new Map(oldStats.map((s) => [s.key, s.value]));
  const newMap = new Map(newStats.map((s) => [s.key, s.value]));
  const changed: string[] = [];
  for (const [key, val] of newMap) {
    if (!oldMap.has(key)) changed.push(`+${key}`);
    else if (oldMap.get(key) !== val) changed.push(key);
  }
  for (const key of oldMap.keys()) {
    if (!newMap.has(key)) changed.push(`−${key}`);
  }
  if (changed.length === 1) return `edit stat: ${changed[0]}`;
  if (changed.length <= 3) return `edit stats: ${changed.join(", ")}`;
  return `edit stats (${changed.length} changed)`;
}

/** Labels a `{ stat, ... }[]` dynamic-stat-row change, over `bonus-draft.ts`'s
 *  `DynamicStatDraft` shape: which stat(s) were added/removed via `arrayDiffLabel`, or a plain
 *  range-edit label when the same stats are still present. */
export function dynamicStatsDiffLabel(
  oldRows: { stat: string }[],
  newRows: { stat: string }[],
): string {
  const oldStats = oldRows.map((r) => r.stat).filter(Boolean);
  const newStats = newRows.map((r) => r.stat).filter(Boolean);
  if (JSON.stringify(oldStats) !== JSON.stringify(newStats))
    return arrayDiffLabel("dynamic stat", oldStats, newStats);
  return "edit dynamic stat range";
}
