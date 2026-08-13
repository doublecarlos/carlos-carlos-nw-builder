// Shared read access for `Item.dynamicStats` / `Grant.dynamicStats` / `GrantVariant.dynamicStats`
// values -- `Build.values[slotId]` storage, keyed and defaulted the same way regardless of
// which of the three declares the config. Used by engine.ts (item-level), bonus.ts
// (grant/variant-level, resolved against the bonus's first contributing slot -- see
// bonus.ts's `resolve`), and the build-editor UI that renders/edits these values.
import type { Build, DynamicStatConfig, StatKey } from "../types";

/** Storage key for one dynamic stat's typed value within `Build.values[slotId]`. An item's
 *  own entry keys by its stat alone (an item can't sensibly declare two configs for the same
 *  stat); a grant/variant's entry is qualified by its bonus id so it can't collide with an
 *  item's own entry, or another bonus's, targeting the same stat on the same slot. */
export function dynamicValueKey(stat: StatKey, bonusId?: string): string {
  return bonusId ? `${bonusId}:${stat}` : stat;
}

/** The value to use for one `DynamicStatConfig` at one slot -- the player's typed override if
 *  present, otherwise the config's own `default`. */
export function readDynamicValue(
  build: Build,
  slotId: string,
  config: DynamicStatConfig,
  bonusId?: string,
): number {
  const typed = build.values?.[slotId]?.[dynamicValueKey(config.stat, bonusId)];
  return typed != null && Number.isFinite(Number(typed))
    ? Number(typed)
    : config.default;
}
