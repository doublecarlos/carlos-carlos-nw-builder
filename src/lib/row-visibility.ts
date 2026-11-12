// Text and separator rows have nothing of their own to show: they follow the fields around them
// by position, whatever hid those fields. The rows between two separators form a group.
import type { Slot } from "../types";

/** A text or separator row, which only lays out the fields around it. */
export function isLayoutRow<T extends Pick<Slot, "type">>(
  slot: T,
): slot is Extract<T, { type: "text" | "separator" }> {
  return slot.type === "text" || slot.type === "separator";
}

/**
 * The rows of one section's list to show, in order, given which of its fields show. A text row
 * shows while any field in its group shows. A separator shows only with a shown field both above
 * and below it, and two shown groups get one separator between them: the one opening the lower
 * group.
 */
export function visibleRows<T extends Pick<Slot, "type">>(
  rows: readonly T[],
  fieldShown: (row: T) => boolean,
): T[] {
  const out: T[] = [];
  let opening: T | undefined;
  let group: T[] = [];
  let groupShown = false;
  const close = () => {
    if (groupShown) {
      if (opening && out.length) out.push(opening);
      out.push(...group);
    }
    group = [];
    groupShown = false;
  };
  for (const row of rows) {
    if (row.type === "separator") {
      close();
      opening = row;
    } else if (row.type === "text") {
      group.push(row);
    } else if (fieldShown(row)) {
      group.push(row);
      groupShown = true;
    }
  }
  close();
  return out;
}
