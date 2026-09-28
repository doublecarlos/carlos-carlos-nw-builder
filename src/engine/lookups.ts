// Build counts read by both the condition leaves and formula functions, so
// `occurrences() >= 2` and `bonusOccurrences: { atLeast: 2 }` can never disagree.

import type { EvalContext } from "../types";

const countOf = (
  map: Map<string, number> | undefined,
  key: string | null | undefined,
): number => {
  if (!map || key == null) return 0;
  return map.get(key) ?? 0;
};

/** Occurrences of `bonusId` across the build, or of the bonus being evaluated when omitted. */
export const occurrenceCount = (ctx: EvalContext, bonusId?: string): number =>
  countOf(ctx.bonusOccurrences, bonusId ?? ctx.self);

/** How many times the item is in the build. */
export const equippedCount = (ctx: EvalContext, itemId: string): number =>
  countOf(ctx.equipped, itemId);

/** How many items in the build carry the tag. */
export const taggedCount = (ctx: EvalContext, tag: string): number =>
  countOf(ctx.tags, tag);
