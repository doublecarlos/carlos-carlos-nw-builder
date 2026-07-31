// Presentation helpers.
//
// The engine stores percentages as decimals (0.09 === 9%) and never rounds anything. All
// rounding happens here, at the edge, exactly once.

import { NW_SCHEMA } from "./data";
import type { Item, StatKey } from "./types";

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
 * The one-line stat summary shown under an item in the picker.
 * Returns the pieces rather than a string so the caller can style the overflow hint.
 */
export const itemPreview = (item: Item | null | undefined, limit = 4) => {
  if (!item) return { parts: [], more: 0 };
  const parts: string[] = [];
  for (const key of NW_SCHEMA.statKeys) {
    if (key === "il") continue; // shown separately, as a badge
    const value = item[key];
    if (!value) continue;
    parts.push(`${abbr(key)} ${signedStat(key, value as number)}`);
  }
  return {
    parts: parts.slice(0, limit),
    more: Math.max(parts.length - limit, 0),
  };
};

/** True when the item carries conditional effects worth flagging in the picker. */
export const hasBonuses = (item: Item | null | undefined) =>
  Boolean(item && (item.bonuses?.length ?? 0) > 0);

/** `warlock` -> `Warlock`, `artifactCall` -> `Artifact Call`. */
export const titleCase = (value: unknown) =>
  String(value ?? "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

export { finite };
