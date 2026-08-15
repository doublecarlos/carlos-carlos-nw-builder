// Per-item occurrence rows for BonusOccurrenceConfig attachments (#217): which of an item's
// `bonuses` entries carry a typed count, and what that count currently is. No dedup needed --
// build.occurrenceInputs is keyed by item id *and* bonus id, so two items each carrying their
// own config for the same bonus (e.g. a boolean, proc-shaped one, see #222) already get two
// independent counts with no aliasing to guard against.
import { computed, type ComputedRef, type Ref } from "vue";
import * as builds from "../stores/builds";
import { db } from "../stores/resolved";
import type { Item } from "../types";

export interface OccurrenceRow {
  bonusId: string;
  label: string;
  value: number;
  min: number;
  max: number;
  defaultValue: number;
  /** Derived from the config's own range, no separate authored tag -- see
   *  `BonusOccurrenceConfig`'s own doc comment: a 0-1 range reads as a checkbox (a per-item
   *  on/off toggle, e.g. a proc). A `min === max` config never reaches here at all (see below),
   *  so this is always one of these two once a row exists. */
  kind: "checkbox" | "stepper";
}

/**
 * One row per BonusOccurrenceConfig attachment on `item` -- a fixed (`min === max`) config is
 * left out entirely, since it takes no player input and the item already always contributes
 * its own `min` regardless (bonus.ts's `collect()`).
 */
export function occurrenceRowsForItem(
  item: Item | null | undefined,
): OccurrenceRow[] {
  const b = builds.build.value;
  if (!item || !b) return [];
  return occurrenceRows(item, b.occurrenceInputs[item.id]);
}

/**
 * `occurrenceRowsForItem` read against an explicit counts record (one item's slice of a
 * `Build.occurrenceInputs`) rather than the active build's -- for an editor authoring counts
 * that belong to something other than the current build, e.g. a `SectionPreset`'s own
 * (PresetForm.vue).
 */
export function occurrenceRows(
  item: Item | null | undefined,
  itemInputs: Record<string, number> | undefined,
): OccurrenceRow[] {
  if (!item) return [];

  const rows: OccurrenceRow[] = [];

  for (const attachment of item.bonuses ?? []) {
    if (typeof attachment === "string") continue;
    if (attachment.min === attachment.max) continue;

    rows.push({
      bonusId: attachment.bonus,
      label:
        attachment.label ??
        db.value.bonusById.get(attachment.bonus)?.name ??
        attachment.bonus,
      value: itemInputs?.[attachment.bonus] ?? attachment.default,
      min: attachment.min,
      max: attachment.max,
      defaultValue: attachment.default,
      kind:
        attachment.min === 0 && attachment.max === 1 ? "checkbox" : "stepper",
    });
  }

  return rows;
}

/** `occurrenceRowsForItem`, wrapped as a computed tracking a single reactive item -- for a
 *  component showing exactly one item's row (ItemPickerRow.vue). */
export function useItemBonusOccurrences(
  item: Ref<Item | null | undefined> | ComputedRef<Item | null | undefined>,
) {
  return computed<OccurrenceRow[]>(() => occurrenceRowsForItem(item.value));
}
