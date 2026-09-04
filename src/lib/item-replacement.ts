// An `Item.replacedBy` entry is either a bare item id or an `ItemReplacement` carrying seed
// values. Every reader goes through these helpers so the two shapes stay interchangeable, the
// same convention bonus-attachment.ts keeps for `Item.bonuses`.
import type { ItemReplacement, StatValues } from "../types";

export const replacementIdOf = (entry: string | ItemReplacement): string =>
  typeof entry === "string" ? entry : entry.item;

/** Values this replacement carries forward; a bare id carries none. */
export const replacementValuesOf = (
  entry: string | ItemReplacement,
): StatValues => (typeof entry === "string" ? {} : (entry.values ?? {}));
