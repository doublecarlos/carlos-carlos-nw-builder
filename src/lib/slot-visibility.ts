// Whether a slot's row renders, for the two places that lay slots out: BuildEditor's section
// lists and QuickOptions' strip. Shared so the two can never disagree about whether a param
// exists -- a `quick` param hidden in one and shown in the other would be worse than either.
//
// Display only. See `BuildParameterSlot.visibleWhen` for why the engine deliberately knows
// nothing about this: a hidden param still resolves to its stored value (or its `default`),
// so conditions reading it are unaffected by what is on screen.

import { evaluate } from "../engine/conditions";
import type { EvalContext, Slot } from "../types";

/** True unless `slot` is a `build_parameter` whose `visibleWhen` fails against `ctx`.
 * A missing `ctx` (the engine threw, so there is nothing to evaluate against) shows the row:
 * an unresolvable build should not also make its own options disappear. */
export function slotVisible(slot: Slot, ctx: EvalContext | null): boolean {
  if (slot.type !== "build_parameter" || !slot.visibleWhen) return true;
  return ctx ? evaluate(slot.visibleWhen, ctx) : true;
}
