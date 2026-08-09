// Presentation helpers.
//
// The engine stores percentages as decimals (0.09 === 9%) and never rounds anything. All
// rounding happens here, at the edge, exactly once.

import { NW_SCHEMA } from "../data/data";
import type { Item, StatKey } from "../types";

const GROUPED = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const statByKey = () => NW_SCHEMA.statByKey;

/** Whole number with thousands separators. `—` for anything non-numeric. */
export const int = (value: unknown) =>
  finite(value) ? GROUPED.format(Math.round(value)) : "—";

/** A decimal fraction as a percentage: 0.09 -> "9.00%". */
export const pct = (value: unknown, digits = 2) =>
  finite(value) ? `${(value * 100).toFixed(digits)}%` : "—";

/** Percent-flavoured stats are the ones stored as fractions. */
export const isPercentKind = (kind: string) =>
  kind === "percent" || kind === "mult";

export const kindOf = (key: StatKey) => statByKey()[key]?.kind ?? "flat";

export const label = (key: StatKey) => statByKey()[key]?.label ?? key;

/** Short form for tight spaces (the inline gear-row summary); falls back to the full label
 *  for every stat that has no abbreviation defined. */
export const abbr = (key: StatKey) => statByKey()[key]?.abbr ?? label(key);

/** Format a stat value the way its kind demands. */
export const stat = (key: StatKey, value: unknown) =>
  isPercentKind(kindOf(key)) ? pct(value) : int(value);

/** As `stat`, with an explicit `+` on positive values -- for deltas and item previews. */
export const signedStat = (key: StatKey, value: unknown) => {
  if (!finite(value)) return "—";
  return (value > 0 ? "+" : "") + stat(key, value);
};

/**
 * Formats a sparse stat-value lookup into "STAT +N" parts, schema order, capped to `limit`.
 * Shared by `itemPreview` (an item's own flat fields) and `bonusStatPreview` (a summed bonus
 * total) so the picker's two preview lines always agree on ordering/formatting.
 */
const statParts = (get: (key: StatKey) => unknown, limit: number) => {
  const parts: string[] = [];
  for (const key of NW_SCHEMA.statKeys) {
    if (key === "il") continue; // shown separately, as a badge
    const value = get(key);
    if (!value) continue;
    parts.push(`${abbr(key)} ${signedStat(key, value as number)}`);
  }
  return {
    parts: parts.slice(0, limit),
    more: Math.max(parts.length - limit, 0),
  };
};

/**
 * The one-line stat summary shown under an item in the picker.
 * Returns the pieces rather than a string so the caller can style the overflow hint.
 */
export const itemPreview = (item: Item | null | undefined, limit = 4) =>
  item ? statParts((key) => item[key], limit) : { parts: [], more: 0 };

/**
 * The bonus-derived stats a candidate item would add if it were slotted in -- same shape as
 * `itemPreview`, summed from active bonuses instead of the item's own fields. `null`/empty
 * for a candidate with nothing new to show (no live build to resolve against, or no bonus
 * attributed to that slot).
 */
export const bonusStatPreview = (
  stats: Record<string, number> | null | undefined,
  limit = 3,
) => (stats ? statParts((key) => stats[key], limit) : { parts: [], more: 0 });

/** True when the item carries conditional effects worth flagging in the picker. */
export const hasBonuses = (item: Item | null | undefined) =>
  Boolean(item && (item.bonuses?.length ?? 0) > 0);

/** `warlock` -> `Warlock`, `artifactCall` -> `Artifact Call`. */
export const titleCase = (value: unknown) =>
  String(value ?? "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

export interface StatOption {
  value: StatKey;
  label: string;
}

/** The percent half of every rating/percent pair (`NW_SCHEMA.ratingConversion` is the schema's
 *  own authored mapping) -- these are exactly the stats that share a label with a rating
 *  counterpart (e.g. "Accuracy" for both `acc` and `acc_p`). */
const percentPairKeys = new Set(
  NW_SCHEMA.ratingConversion.map((rule) => rule.percent),
);

/**
 * The full stat list (`NW_SCHEMA.stats`) as `{value, label}` options, for any dropdown that
 * lets a user pick one stat out of the whole schema. A rating/percent pair shares a plain
 * label in the schema -- the raw key used to be appended in parentheses to tell them apart
 * (`Accuracy (acc_p)`), which only means anything to someone who already knows the `_p`
 * suffix convention. The percent half gets a "%" suffix instead (`Accuracy %`), the rating
 * half keeps its plain label.
 */
export const statPickerOptions: StatOption[] = NW_SCHEMA.stats.map((s) => ({
  value: s.key,
  label: percentPairKeys.has(s.key) ? `${s.label} %` : s.label,
}));

export { finite };
