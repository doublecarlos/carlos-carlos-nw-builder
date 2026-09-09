// The `toggleable` slot property and the per-build off state behind it, shared by the engine,
// the editor and the stores.
import type { Build, Slot } from "../types";

/** Whether `slot` offers the checkbox. A list hands the property down to its rows. */
export function isToggleable(slot: Slot | null | undefined): boolean {
  return (
    (slot?.type === "item_picker" || slot?.type === "item_picker_list") &&
    slot.toggleable === true
  );
}

/** Whether this slot's pick is currently out of the calculation. Gated on the slot still being
 *  `toggleable`, so an entry outliving an authoring change cannot exclude a pick from a row
 *  with no checkbox left to turn it back on. */
export function isDisabled(
  build: Build | null | undefined,
  slot: Slot | null | undefined,
): boolean {
  return isToggleable(slot) && build?.disabledSlots?.[slot!.id] === true;
}
