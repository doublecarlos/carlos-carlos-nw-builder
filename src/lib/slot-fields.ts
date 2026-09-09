// The `Build` fields keyed by slot id, and the operations that treat all of them as one unit.
//
// `occurrenceInputs` (keyed by item id) and `listRows` (a count per list container, not per
// slot) are deliberately not in the family: a slot move or clear must leave both alone.
import type { Build } from "../types";

export const SLOT_FIELDS = [
  "choices",
  "values",
  "assignments",
  "disabledSlots",
] as const;

export type SlotFieldKey = (typeof SLOT_FIELDS)[number];

export type SlotData = Pick<Build, SlotFieldKey>;

/** One field's map. These operations move whole values and never read them, so the value type
 * is opaque here. */
const mapOf = (
  data: SlotData,
  key: SlotFieldKey,
): Record<string, unknown> | undefined =>
  data[key] as Record<string, unknown> | undefined;

/** Only a truthy value is carried: an empty choice and an off state of `false` already mean
 * what absence means, and storing them says it twice. */
const carried = (value: unknown) => Boolean(value);

const cloned = (value: unknown) =>
  value && typeof value === "object" ? { ...value } : value;

/** Everything one slot stores, moved to another slot id, or dropped with no `to`. */
export function moveSlotData(data: SlotData, from: string, to?: string) {
  for (const key of SLOT_FIELDS) {
    const field = mapOf(data, key);
    if (!field) continue;
    const value = field[from];
    delete field[from];
    if (to && carried(value)) field[to] = value;
  }
}

export const clearSlotData = (data: SlotData, slotId: string) =>
  moveSlotData(data, slotId);

/** One slot made to hold what it holds in `source`. A field `source` stores nothing under is
 * cleared, so the slot never ends up a mix of the two builds. */
export function copySlotData(
  target: SlotData,
  source: SlotData,
  slotId: string,
) {
  for (const key of SLOT_FIELDS) {
    const field = mapOf(target, key);
    if (!field) continue;
    const value = mapOf(source, key)?.[slotId];
    if (carried(value)) field[slotId] = cloned(value);
    else delete field[slotId];
  }
}

const replaceField = <K extends SlotFieldKey>(
  target: SlotData,
  source: SlotData,
  key: K,
) => {
  target[key] = source[key];
};

export function replaceSlotData(target: SlotData, source: SlotData) {
  for (const key of SLOT_FIELDS) replaceField(target, source, key);
}

/** Every slot id this build stores anything under, in any field. */
export function storedSlotIds(data: SlotData): string[] {
  const ids = new Set<string>();
  for (const key of SLOT_FIELDS) {
    for (const slotId of Object.keys(mapOf(data, key) ?? {})) ids.add(slotId);
  }
  return [...ids];
}

/** Every slot field re-keyed, dropping any slot `rename` answers null for. */
export function mapSlotIds(
  data: SlotData,
  rename: (slotId: string) => string | null,
): SlotData {
  const out: Record<string, Record<string, unknown>> = {};
  for (const key of SLOT_FIELDS) {
    const field: Record<string, unknown> = {};
    for (const [slotId, value] of Object.entries(mapOf(data, key) ?? {})) {
      const renamed = rename(slotId);
      if (renamed != null) field[renamed] = value;
    }
    out[key] = field;
  }
  return out as SlotData;
}
