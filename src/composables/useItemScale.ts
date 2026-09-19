// The active build's item stat scaling (mount/companion bolster), for the UI side.
//
// engine/scaling.ts is pure and takes an `EvalContext`; these wrappers supply the one the
// active build resolved to, so a component asking "what would this item actually contribute"
// gets the same answer the stat panel shows. Falls back to unscaled whenever there is no
// resolved build to read -- a picker preview must still render while the build is broken.
import { activeScalersFor, scaleFactorFor } from "../engine/scaling";
import { resolved } from "../stores/resolved";
import type { Item, ResolvedScaler } from "../types";

/** The multiplier the active build applies to `item`'s own stat line, or 1 for an item nothing
 *  scales. Cheap enough to call per candidate row -- a walk of at most a handful of scalers. */
export function itemScaleFactor(item: Item | null | undefined): number {
  const state = resolved.value;
  if (!state.ok) return 1;
  return scaleFactorFor(state.result.context, item);
}

/** Every scaler currently acting on `item`, for a card to scale its stat line by and to note
 *  under each scaled row why the number differs from the catalog. */
export function itemScalers(item: Item | null | undefined): ResolvedScaler[] {
  const state = resolved.value;
  if (!state.ok) return [];
  return activeScalersFor(state.result.context, item);
}
