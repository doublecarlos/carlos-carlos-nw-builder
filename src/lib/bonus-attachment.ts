// An `Item.bonuses` entry is either a bare bonus id (always exactly 1 occurrence -- the only
// shape that used to exist) or a `BonusOccurrenceConfig` (a typed, per-item occurrence count
// bounded by min/max). Every module that walks `item.bonuses` -- db.ts, bonus.ts, catalog.ts --
// goes through these two helpers instead of re-deriving the id/count itself, so the two shapes
// stay interchangeable everywhere the array is read.
import type { BonusOccurrenceConfig } from "../types";

export const bonusIdOf = (entry: string | BonusOccurrenceConfig): string =>
  typeof entry === "string" ? entry : entry.bonus;

/**
 * How many occurrences one item contributes for this attachment. A bare string is always 1,
 * unchanged from before this type existed. A `BonusOccurrenceConfig` reads the player's typed
 * count for this item+bonus pair (`build.occurrenceInputs[item.id]?.[bonus]`, passed in already
 * narrowed to that item), falling back to the config's own `default` when unset -- e.g. a build
 * that has never touched this item.
 */
export function occurrenceCountFor(
  entry: string | BonusOccurrenceConfig,
  itemInputs: Record<string, number> | undefined,
): number {
  if (typeof entry === "string") return 1;
  return itemInputs?.[entry.bonus] ?? entry.default;
}
