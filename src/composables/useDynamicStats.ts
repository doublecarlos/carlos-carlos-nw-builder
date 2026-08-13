// One slot's dynamic-stat rows: the picked item's own `dynamicStats`, plus any active grant's
// or chosen variant's, for whichever bonus resolved to this slot as its first contributing
// source (bonus.ts's `resolve` -- `EvaluatedBonus.slotId`). Mirrors
// useItemBonusOccurrences.ts's shape (a row per config, `value`/`min`/`max`/`defaultValue`),
// just reading `resolved.bonuses` too, since which grant/variant is active can only be known
// post-resolution.
import { computed, type ComputedRef, type Ref } from "vue";
import * as builds from "../stores/builds";
import { resolved } from "../stores/resolved";
import { dynamicValueKey, readDynamicValue } from "../lib/dynamic-stats";
import { label as statLabel } from "../lib/format";
import type { Item } from "../types";

export interface DynamicStatRow {
  /** This value's storage key within `Build.values[slotId]` -- see `dynamicValueKey`. */
  key: string;
  stat: string;
  label: string;
  value: number;
  min: number;
  max: number;
  defaultValue: number;
}

/** Every dynamic-stat row for `slotId`'s current pick -- item-level first, then grant-level
 *  (in bonus-list order), so the item's own inputs always lead. */
export function dynamicStatRowsForSlot(
  slotId: string,
  item: Item | null | undefined,
): DynamicStatRow[] {
  const b = builds.build.value;
  if (!b || !item) return [];

  const rows: DynamicStatRow[] = [];

  for (const config of item.dynamicStats ?? []) {
    rows.push({
      key: dynamicValueKey(config.stat),
      stat: config.stat,
      label: config.label ?? statLabel(config.stat),
      value: readDynamicValue(b, slotId, config),
      min: config.min,
      max: config.max,
      defaultValue: config.default,
    });
  }

  if (resolved.value.ok) {
    for (const entry of resolved.value.result.bonuses) {
      if (entry.slotId !== slotId) continue;
      for (const grant of entry.grants) {
        if (!grant.active) continue;
        const configs = grant.chose?.startsWith("variant:")
          ? (grant.raw.variants?.[Number(grant.chose.slice("variant:".length))]
              ?.dynamicStats ?? [])
          : (grant.raw.dynamicStats ?? []);
        for (const config of configs) {
          rows.push({
            key: dynamicValueKey(config.stat, entry.bonusId),
            stat: config.stat,
            label: config.label ?? statLabel(config.stat),
            value: readDynamicValue(b, slotId, config, entry.bonusId),
            min: config.min,
            max: config.max,
            defaultValue: config.default,
          });
        }
      }
    }
  }

  return rows;
}

/** `dynamicStatRowsForSlot`, wrapped as a computed tracking a reactive item -- for a component
 *  showing exactly one slot's rows (ItemPickerRow.vue). */
export function useSlotDynamicStats(
  slotId: string,
  item: Ref<Item | null | undefined> | ComputedRef<Item | null | undefined>,
) {
  return computed<DynamicStatRow[]>(() =>
    dynamicStatRowsForSlot(slotId, item.value),
  );
}
