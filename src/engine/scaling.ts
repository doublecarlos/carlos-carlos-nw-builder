// Item stat scaling: mount and companion bolster.
//
// The game multiplies a mount's or companion's whole stat line -- item level, combined rating
// and every rating/percent on it -- by `1 + bolster`, a collection-wide value the character
// carries rather than anything the equipped item knows about. `Schema.statScalers` says which
// items a given parameter scales; this module is the only place that turns that declaration
// into a number.
//
// It exists as its own module because three independent readers of an item's stats have to
// agree: the pipeline (engine.ts's `rowVectors`), the stat-source popover (stat-sources.ts's
// `itemSources`, which re-attributes sources rather than reading a ready-made vector) and the
// UI's item cards and picker previews. A factor computed in only one of them would put a
// visibly different number in the panel than in the popover that explains it.
//
// Scope is the item's *own* vector. Stats a bonus contributes are attributed to a slot, not to
// the item that granted them (bonus.ts's `anchor.slotId`), so a bonus reaching the same row is
// left alone -- see issue #287 for what scaling those properly would take.
import type { EvalContext, Item, Schema, StatKey, StatScaler } from "../types";

/** Whether `item` is in a scaler's declared category. `filter` and `tags` are OR-matched, the
 *  same way an `item_picker` slot selects its candidates. */
function matches(scaler: StatScaler, item: Item): boolean {
  const { filter, tags } = scaler.applies;
  if (filter?.length && item.filter && filter.includes(item.filter))
    return true;
  if (tags?.length) return (item.tags ?? []).some((tag) => tags.includes(tag));
  return false;
}

/**
 * Every scaler claiming `item`, paired with the parameter value it resolved to.
 *
 * Read from `EvalContext.params` rather than straight off `build.context` so a missing value
 * resolves to its slot's declared `default` exactly once, in bonus.ts's `collect()` -- the same
 * number the parameter's own control shows. A non-finite value (a hand-edited build, a bad
 * import) is dropped rather than carried: an unreadable bolster should leave the item at its
 * base stats, not poison every downstream stage with `NaN`.
 *
 * Returned as a list rather than folded straight to a number so the UI can name what scaled an
 * item ("Mount bolster 60% applied") instead of showing silently different figures.
 */
export function activeScalersFor(
  schema: Schema,
  context: EvalContext,
  item: Item | null | undefined,
): { scaler: StatScaler; value: number }[] {
  if (!item) return [];
  const out: { scaler: StatScaler; value: number }[] = [];
  for (const scaler of schema.statScalers ?? []) {
    if (!matches(scaler, item)) continue;
    const value = Number(context.params.get(scaler.param));
    if (Number.isFinite(value)) out.push({ scaler, value });
  }
  return out;
}

/**
 * The multiplier for one item, or 1 when no scaler claims it.
 *
 * Scalers compose multiplicatively when several claim one item. Nothing shipped overlaps today
 * -- an item is a mount or a companion, never both -- but the alternative (first match wins)
 * would make the outcome depend on schema order, which is a worse thing to leave lying around
 * for the quality-tier scaler this is shaped to accept next.
 */
export function scaleFactorFor(
  schema: Schema,
  context: EvalContext,
  item: Item | null | undefined,
): number {
  let factor = 1;
  for (const { value } of activeScalersFor(schema, context, item))
    factor *= 1 + value;
  return factor;
}

/**
 * One of an item's stat values, scaled. `0`/absent stays `0` so a scaled item never gains a
 * stat it did not have.
 *
 * Multiplicative stats are returned untouched: they combine as `(1 + a) * (1 + b)` products
 * (engine.ts's stage 1), so scaling the stored value would compound rather than scale the
 * effect it stands for. Nothing scalable carries one today, and `validateScalers` reports it
 * if that ever changes.
 */
export function scaledStat(
  schema: Schema,
  item: Item,
  key: StatKey,
  factor: number,
): number {
  const raw = (item[key] as number | undefined) ?? 0;
  if (!raw) return 0;
  if (schema.statByKey[key]?.kind === "mult") return raw;
  return raw * factor;
}
