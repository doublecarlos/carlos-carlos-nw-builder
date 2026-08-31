// Expanding an `item_picker_list` container into the rows a build currently holds.
//
// Rows are positional: row N of `misc.misc` is the ordinary `item_picker` slot `misc.misc#N`,
// 1-based so the id and the rendered label agree. Everything downstream of the expansion sees
// plain picks and knows nothing about lists.
import type { Build, ItemPickerListSlot, ItemPickerSlot, Slot } from "../types";

/** Separates a container id from its row number. Not `.`, which already separates a section
 * from its slot. */
export const ROW_SEPARATOR = "#";

export const rowSlotId = (listId: string, index: number) =>
  `${listId}${ROW_SEPARATOR}${index}`;

/** The container id and 1-based row number behind a row slot id, or null for any other id. */
export function parseRowSlotId(
  slotId: string,
): { listId: string; index: number } | null {
  const at = slotId.lastIndexOf(ROW_SEPARATOR);
  if (at <= 0) return null;
  const index = Number(slotId.slice(at + 1));
  if (!Number.isInteger(index) || index < 1) return null;
  return { listId: slotId.slice(0, at), index };
}

/** `slot`'s row count in this build, or its `defaultRows` for a build that never touched it. */
export function listRowCount(
  build: Build | null | undefined,
  slot: ItemPickerListSlot,
): number {
  return build?.listRows?.[slot.id] ?? slot.defaultRows ?? 0;
}

/** One row of `slot`, as the ordinary `item_picker` slot every consumer downstream sees. */
export function rowSlot(
  slot: ItemPickerListSlot,
  index: number,
): ItemPickerSlot {
  return {
    id: rowSlotId(slot.id, index),
    label: `${slot.label} ${index}`,
    section: slot.section,
    type: "item_picker",
    ...(slot.filter ? { filter: slot.filter } : {}),
    ...(slot.tags ? { tags: [...slot.tags] } : {}),
    ...(slot.visibleWhen ? { visibleWhen: slot.visibleWhen } : {}),
    list: slot.id,
  };
}

/**
 * Row counts implied by what a build already stores -- a pick at `misc.misc#5` is a fifth row,
 * whatever the count says. `normalise` grows a payload to these, so a hand-edited or imported
 * build cannot carry a pick that no row shows.
 */
export function storedListRows(
  build: Pick<Build, "choices" | "values" | "assignments">,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const field of [build.choices, build.values, build.assignments]) {
    for (const key of Object.keys(field ?? {})) {
      const row = parseRowSlotId(key);
      if (row)
        counts[row.listId] = Math.max(counts[row.listId] ?? 0, row.index);
    }
  }
  return counts;
}

/**
 * `slots` with every container replaced by its rows, each followed by the container itself --
 * which holds no value, so a walk over build values skips it as it skips a separator.
 *
 * Returns `slots` untouched when there is nothing to expand, keeping its identity for
 * downstream memoising.
 */
export function expandSlots(
  slots: Slot[],
  build: Build | null | undefined,
): Slot[] {
  if (!slots.some((slot) => slot.type === "item_picker_list")) return slots;
  return slots.flatMap((slot) => {
    if (slot.type !== "item_picker_list") return [slot];
    const count = listRowCount(build, slot);
    const rows: Slot[] = [];
    for (let index = 1; index <= count; index += 1)
      rows.push(rowSlot(slot, index));
    rows.push(slot);
    return rows;
  });
}
