// Moves settings out of the flat per-slot layout, where `values[slotId]` held an item's stats by
// stat key and a bonus's by `bonusId:stat`. Item stats nest under `values[slotId].stat`; bonus
// stats move to `bonusValues[bonusId].stat`. Idempotent: the nested layout passes through.
import { NW_SLOTS } from "../data/data";
import { parseRowSlotId } from "../lib/item-picker-list";
import type { BonusValues, SectionPreset, SlotValues } from "../types";

export interface StoredSettings {
  values: Record<string, SlotValues>;
  bonusValues: Record<string, BonusValues>;
}

const isPlain = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const finite = (value: unknown): number | undefined => {
  const parsed = Number(value);
  return value !== "" &&
    value != null &&
    typeof value !== "boolean" &&
    Number.isFinite(parsed)
    ? parsed
    : undefined;
};

function numbers(source: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!isPlain(source)) return out;
  for (const [key, value] of Object.entries(source)) {
    const parsed = finite(value);
    if (parsed !== undefined) out[key] = parsed;
  }
  return out;
}

function inputs(source: unknown): Record<string, number | boolean> {
  const out: Record<string, number | boolean> = { ...numbers(source) };
  if (!isPlain(source)) return out;
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === "boolean") out[key] = value;
  }
  return out;
}

function bonusValuesOf(source: unknown): Record<string, BonusValues> {
  const out: Record<string, BonusValues> = {};
  if (!isPlain(source)) return out;
  for (const [bonusId, raw] of Object.entries(source)) {
    if (!isPlain(raw)) continue;
    const entry: BonusValues = {};
    const stat = numbers(raw.stat);
    const input = inputs(raw.input);
    if (Object.keys(stat).length) entry.stat = stat;
    if (Object.keys(input).length) entry.input = input;
    if (Object.keys(entry).length) out[bonusId] = entry;
  }
  return out;
}

const SLOT_RANK = new Map(
  NW_SLOTS.slots.map((slot, index) => [slot.id, index]),
);

/** A slot's position in the shipped slot order, a list row right after its container. Slots
 * the shipped order does not know sort last. */
function slotRank(slotId: string): number {
  const row = parseRowSlotId(slotId);
  const base = SLOT_RANK.get(row?.listId ?? slotId);
  if (base === undefined) return Infinity;
  return row ? base + row.index / (row.index + 1) : base;
}

/** Coerces stored settings, migrating flat per-slot keys. When several slots hold a value for
 * one bonus stat, the first in slot order wins, and a value already in `bonusValues` wins over
 * both. */
export function migrateSettings(
  rawValues: unknown,
  rawBonusValues: unknown,
): StoredSettings {
  const values: Record<string, SlotValues> = {};
  const legacy: {
    slotId: string;
    bonusId: string;
    stat: string;
    value: number;
  }[] = [];

  for (const [slotId, raw] of Object.entries(
    isPlain(rawValues) ? rawValues : {},
  )) {
    if (!isPlain(raw)) continue;
    const stat = numbers(raw.stat);
    for (const [key, value] of Object.entries(raw)) {
      const parsed = finite(value);
      if (key === "stat" || parsed === undefined) continue;
      const at = key.indexOf(":");
      if (at < 0) stat[key] ??= parsed;
      else
        legacy.push({
          slotId,
          bonusId: key.slice(0, at),
          stat: key.slice(at + 1),
          value: parsed,
        });
    }
    if (Object.keys(stat).length) values[slotId] = { stat };
  }

  const bonusValues = bonusValuesOf(rawBonusValues);
  legacy.sort((a, b) => slotRank(a.slotId) - slotRank(b.slotId));
  for (const { bonusId, stat, value } of legacy) {
    const entry = (bonusValues[bonusId] ??= {});
    entry.stat ??= {};
    entry.stat[stat] ??= value;
  }

  return { values, bonusValues };
}

/** `preset` with its settings migrated the way a build's are. */
export function migratePresetSettings(preset: SectionPreset): SectionPreset {
  if (preset.values === undefined && preset.bonusValues === undefined)
    return preset;
  const { values, bonusValues } = migrateSettings(
    preset.values,
    preset.bonusValues,
  );
  const { values: _values, bonusValues: _bonusValues, ...rest } = preset;
  return {
    ...rest,
    ...(Object.keys(values).length ? { values } : {}),
    ...(Object.keys(bonusValues).length ? { bonusValues } : {}),
  };
}
