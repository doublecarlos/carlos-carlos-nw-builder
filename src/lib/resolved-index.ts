// Per-slot lookups over one resolution, so a build-editor row reads its own bucket instead of
// scanning every bonus, error and row of the build. Each index is built once per resolution.
import type { InputEntry } from "../engine/inputs";
import type {
  EngineError,
  EngineRow,
  EvaluatedBonus,
  ResolvedBuild,
} from "../types";

export interface ResolvedIndex {
  /** Every resolved bonus by its evaluated id. */
  bonusById: Map<string, EvaluatedBonus>;
  /** Each slot's own bonuses, keyed by the bonus definition id. */
  slotBonuses: Map<string, Map<string, EvaluatedBonus>>;
  errors: Map<string, EngineError[]>;
  /** The first resolved row of each slot. */
  rows: Map<string, EngineRow>;
}

/** A bonus input shown as a note on a row its bonus also comes from. */
export interface InputCopy {
  entry: InputEntry;
  /** The item on the noted row that carries the bonus. */
  itemId?: string;
}

const indexes = new WeakMap<ResolvedBuild, ResolvedIndex>();

/** Groups entries by their `slotId`, keeping their order. */
export function groupBySlot<T extends { slotId: string }>(
  entries: readonly T[],
): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const entry of entries) {
    const bucket = map.get(entry.slotId);
    if (bucket) bucket.push(entry);
    else map.set(entry.slotId, [entry]);
  }
  return map;
}

export function emptyIndex(): ResolvedIndex {
  return {
    bonusById: new Map(),
    slotBonuses: new Map(),
    errors: new Map(),
    rows: new Map(),
  };
}

/** The lookups for `result`. Cached per result, so callers holding the same resolution share
 *  one index. */
export function indexResolved(result: ResolvedBuild): ResolvedIndex {
  const cached = indexes.get(result);
  if (cached) return cached;
  const index = emptyIndex();
  for (const bonus of result.bonuses) {
    index.bonusById.set(bonus.id, bonus);
    const own = index.slotBonuses.get(bonus.slotId);
    if (own) own.set(bonus.bonusId, bonus);
    else index.slotBonuses.set(bonus.slotId, new Map([[bonus.bonusId, bonus]]));
  }
  index.errors = groupBySlot(result.errors);
  for (const row of result.rows)
    if (!index.rows.has(row.slotId)) index.rows.set(row.slotId, row);
  indexes.set(result, index);
  return index;
}

/** Each bonus input under every other slot its bonus also comes from, keyed by that slot. */
export function inputCopiesBySlot(
  inputs: readonly InputEntry[],
  bonusById: ReadonlyMap<string, EvaluatedBonus>,
): Map<string, InputCopy[]> {
  const map = new Map<string, InputCopy[]>();
  for (const entry of inputs) {
    if (entry.kind !== "bonusInput" || entry.address.store !== "bonusValues")
      continue;
    const seen = new Set([entry.slotId]);
    for (const source of bonusById.get(entry.address.bonusId)?.sources ?? []) {
      if (seen.has(source.slotId)) continue;
      seen.add(source.slotId);
      const copy = { entry, itemId: source.itemId };
      const bucket = map.get(source.slotId);
      if (bucket) bucket.push(copy);
      else map.set(source.slotId, [copy]);
    }
  }
  return map;
}
