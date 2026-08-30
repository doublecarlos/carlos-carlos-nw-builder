// Whether a slot's row renders, shared by the two places that lay slots out (BuildEditor's
// section lists and QuickOptions' strip) so the two can never disagree.

import { evaluate } from "../engine/conditions";
import type { EvalContext, Slot } from "../types";

/** True unless `slot`'s `visibleWhen` fails against `ctx`. Every slot type carries the field
 * (`SlotVisibility`), so this needs to know nothing about which one it was handed. A missing
 * `ctx` -- the engine threw -- shows the row: an unresolvable build should not also make its
 * own options disappear. */
export function slotVisible(slot: Slot, ctx: EvalContext | null): boolean {
  if (!slot.visibleWhen) return true;
  return ctx ? evaluate(slot.visibleWhen, ctx) : true;
}
