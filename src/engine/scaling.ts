// Item stat scaling: mount and companion bolster.
//
// The game multiplies a mount's or companion's whole stat line (item level, combined rating
// and every rating/percent on it) by `1 + bolster`, a collection-wide value the character
// carries rather than anything the equipped item knows about. A `build_parameter` slot's
// `scaler` block declares which items its value scales and how the value becomes a
// multiplier; bonus.ts's `collect()` resolves every such slot into `EvalContext.scalers`, and
// this module is the only place that turns those resolved scalers into an item's factor.
//
// It exists as its own module because three independent readers of an item's stats have to
// agree: the pipeline (engine.ts's `rowVectors`), the stat-source popover (stat-sources.ts's
// `itemSources`, which re-attributes sources rather than reading a ready-made vector) and the
// UI's item cards and picker previews. A factor computed in only one of them would put a
// visibly different number in the panel than in the popover that explains it.
//
// Scope is the item's *own* vector. Stats a bonus contributes are attributed to a slot, not to
// the item that granted them (bonus.ts's `anchor.slotId`), so a bonus reaching the same row is
// left alone.
import type { EvalContext, Item, ResolvedScaler, StatKey } from "../types";

/** Whether `item` is in a scaler's declared category. `filter` and `tags` are OR-matched, the
 *  same way an `item_picker` slot selects its candidates. A scaler with no `applies` claims
 *  no item at all. */
function matches(scaler: ResolvedScaler, item: Item): boolean {
  const { filter, tags } = scaler.applies ?? {};
  if (filter?.length && item.filter && filter.includes(item.filter))
    return true;
  if (tags?.length) return (item.tags ?? []).some((tag) => tags.includes(tag));
  return false;
}

/**
 * Every resolved scaler claiming `item`.
 *
 * Read from `EvalContext.scalers` rather than straight off `build.context` so a missing value
 * resolves to its slot's declared `default` exactly once, in bonus.ts's `collect()`, which is
 * the same number the parameter's own control shows.
 *
 * Returned as a list rather than folded straight to a number so the UI can note what scaled
 * each stat ("1,750 x 225.00% Mount bolster") instead of showing silently different figures.
 */
export function activeScalersFor(
  context: EvalContext,
  item: Item | null | undefined,
): ResolvedScaler[] {
  if (!item) return [];
  const out: ResolvedScaler[] = [];
  for (const scaler of context.scalers.values())
    if (matches(scaler, item)) out.push(scaler);
  return out;
}

/**
 * The one multiplier a set of scalers amounts to, or 1 for none.
 *
 * Scalers compose multiplicatively when several claim one item. Nothing shipped overlaps today
 * (an item is a mount or a companion, never both), but the alternative (first match wins)
 * would make the outcome depend on slot order, which is a worse thing to leave lying around
 * for the quality-tier scaler this is shaped to accept next.
 */
export function composeFactor(
  scalers: Pick<ResolvedScaler, "multiplier">[],
): number {
  let factor = 1;
  for (const { multiplier } of scalers) factor *= multiplier;
  return factor;
}

/** The multiplier for one item, or 1 when no scaler claims it. */
export function scaleFactorFor(
  context: EvalContext,
  item: Item | null | undefined,
): number {
  return composeFactor(activeScalersFor(context, item));
}

/**
 * One of an item's stat values, scaled. `0`/absent stays `0` so a scaled item never gains a
 * stat it did not have.
 */
export function scaledStat(item: Item, key: StatKey, factor: number): number {
  const raw = (item[key] as number | undefined) ?? 0;
  if (!raw) return 0;

  // Bolster floors the IL calculation but keeps other stats at full precision
  const computed = raw * factor;
  return key === "il" ? Math.floor(computed) : computed;
}
