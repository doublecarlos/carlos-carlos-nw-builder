// The active build's item stat scaling (mount/companion bolster), for the UI side.
//
// engine/scaling.ts is pure and takes an `EvalContext`; these wrappers supply the one the
// active build resolved to, so a component asking "what would this item actually contribute"
// gets the same answer the stat panel shows. Falls back to unscaled whenever there is no
// resolved build to read -- a picker preview must still render while the build is broken.
import { NW_SCHEMA } from "../data/data";
import { activeScalersFor, scaleFactorFor } from "../engine/scaling";
import { resolved } from "../stores/resolved";
import { pct } from "../lib/format";
import type { Item } from "../types";

/** The multiplier the active build applies to `item`'s own stat line, or 1 for an item nothing
 *  scales. Cheap enough to call per candidate row -- a walk of at most a handful of scalers. */
export function itemScaleFactor(item: Item | null | undefined): number {
  const state = resolved.value;
  if (!state.ok) return 1;
  return scaleFactorFor(NW_SCHEMA, state.result.context, item);
}

/** One human-readable line per scaler currently acting on `item` -- "Mount bolster 125.00%
 *  applied" -- so a card showing scaled numbers says why they differ from the catalogue. */
export function itemScaleNotes(item: Item | null | undefined): string[] {
  const state = resolved.value;
  if (!state.ok) return [];
  return activeScalersFor(NW_SCHEMA, state.result.context, item).map(
    ({ scaler, value }) => `${scaler.label} ${pct(value)} applied`,
  );
}
