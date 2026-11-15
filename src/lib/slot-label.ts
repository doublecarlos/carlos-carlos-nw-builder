// A slot's row reads shorter than its references, which travel without the section's context.
import type { Slot } from "../types";

/** The name `slot` reads as on its own row; `override` wins where something else names the row. */
export function rowLabelOf(slot: Slot, override?: string): string {
  return (
    override || ("rowLabel" in slot && slot.rowLabel) || slot.label || slot.id
  );
}

/** Every name `slot` answers to, for matching a typed query. */
export function slotNames(slot: Slot): string[] {
  const label = slot.label || slot.id;
  const rowLabel = rowLabelOf(slot);
  return rowLabel === label ? [label] : [label, rowLabel];
}
