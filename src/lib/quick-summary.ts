// The one-line summary a collapsed quick options band shows in place of its controls.
import type { BuildParameterSlot, ItemPickerSlot, Slot } from "../types";

export type QuickSlot = BuildParameterSlot | ItemPickerSlot;

export const isQuick = (slot: Slot): slot is QuickSlot =>
  (slot.type === "build_parameter" || slot.type === "item_picker") &&
  !!slot.quick;

/** One quick slot's current value: a boolean toggle, or the text a value control shows. */
export interface QuickValue {
  label: string;
  value: boolean | string;
}

/** Each valued slot as "Label value" in order, then the toggles as one "N/M on" count, so a
 *  long run of checkboxes doesn't crowd out the values. */
export function quickSummary(values: QuickValue[]): string {
  const parts = values
    .filter((entry) => typeof entry.value === "string")
    .map((entry) => `${entry.label} ${entry.value}`);
  const toggles = values.filter((entry) => typeof entry.value === "boolean");
  if (toggles.length) {
    const on = toggles.filter((entry) => entry.value).length;
    parts.push(`${on}/${toggles.length} toggles on`);
  }
  return parts.join(" · ");
}
