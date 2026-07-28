// Presentation helpers (plan §4.2, UI layer).
//
// The engine stores percentages as decimals (0.09 === 9%) and never rounds anything. All
// rounding happens here, at the edge, exactly once -- see the handoff §4 "Percentages".
//
// Classic script, no modules: this file must work from file:// like everything else.

window.NW = window.NW ?? {};
window.NW.format = (() => {
  'use strict';

  const GROUPED = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
  const finite = (value) => typeof value === 'number' && Number.isFinite(value);

  const statByKey = () => window.NW_SCHEMA.statByKey;

  /** Whole number with thousands separators. `—` for anything non-numeric. */
  const int = (value) => (finite(value) ? GROUPED.format(Math.round(value)) : '—');

  /** A decimal fraction as a percentage: 0.09 -> "9.00%". */
  const pct = (value, digits = 2) => (finite(value) ? `${(value * 100).toFixed(digits)}%` : '—');

  /** Percent-flavoured stats are the ones stored as fractions. */
  const isPercentKind = (kind) => kind === 'percent' || kind === 'mult';

  const kindOf = (key) => statByKey()[key]?.kind ?? 'flat';

  const label = (key) => statByKey()[key]?.label ?? key;

  /** Short form for tight spaces (the inline gear-row summary); falls back to the full label
   *  for every stat that has no abbreviation defined. */
  const abbr = (key) => statByKey()[key]?.abbr ?? label(key);

  /** Format a stat value the way its kind demands. */
  const stat = (key, value) => (isPercentKind(kindOf(key)) ? pct(value) : int(value));

  /** As `stat`, with an explicit `+` on positive values -- for deltas and item previews. */
  const signedStat = (key, value) => {
    if (!finite(value)) return '—';
    return (value > 0 ? '+' : '') + stat(key, value);
  };

  /**
   * The one-line stat summary shown under an item in the picker.
   * Returns the pieces rather than a string so the caller can style the overflow hint.
   */
  const itemPreview = (item, limit = 4) => {
    if (!item) return { parts: [], more: 0 };
    const parts = [];
    for (const key of window.NW_SCHEMA.statKeys) {
      if (key === 'il') continue;              // shown separately, as a badge
      const value = item[key];
      if (!value) continue;
      parts.push(`${abbr(key)} ${signedStat(key, value)}`);
    }
    return { parts: parts.slice(0, limit), more: Math.max(parts.length - limit, 0) };
  };

  /** True when the item carries conditional effects worth flagging in the picker. */
  const hasBonuses = (item) => Boolean(item && (item.bonuses?.length ?? 0) > 0);

  /** `warlock` -> `Warlock`, `artifactCall` -> `Artifact Call`. */
  const titleCase = (value) => String(value ?? '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

  return { int, pct, stat, signedStat, label, abbr, kindOf, isPercentKind, itemPreview, hasBonuses,
    titleCase, finite };
})();
