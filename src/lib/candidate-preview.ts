// What a picker candidate would do if picked, for the picker's preview lines and item card.
// Vue-free so it is unit-testable.
import * as engine from "../engine/engine";
import { withChoice } from "./apply-choice";
import type {
  Build,
  Db,
  EvalContext,
  EvaluatedBonus,
  Item,
  ResolvedBonuses,
} from "../types";

/** The build a picker resolves its candidates against. */
export interface PreviewInputs {
  db: Db;
  build: Build;
  slotId: string;
}

/** Whether two inputs would resolve the same, so a caller passing a fresh object literal per
 *  render can keep the previous one. */
export function samePreviewInputs(
  a: PreviewInputs | undefined,
  b: PreviewInputs | undefined,
): boolean {
  if (!a || !b) return a === b;
  return a.db === b.db && a.build === b.build && a.slotId === b.slotId;
}

/** What picking one candidate would do: the picker's preview sums, and the resolve its card
 *  reads, so the card never resolves the same candidate again. */
export interface CandidatePreview {
  /** Stats of the active bonuses attributed to the slot, as its row would sum them. */
  current: Record<string, number>;
  /** Near-miss stats of the item's own inactive bonuses (`previewStats`). */
  potential: Record<string, number>;
  /** Why the candidate is withheld: an active `hideFromPicker` grant picking it would trigger. */
  conflict: string | null;
  /** The item's resolved bonuses, as `bonusesForItem` lists them. */
  bonuses: EvaluatedBonus[];
  bonusById: Map<string, EvaluatedBonus>;
  /** The resolve's context, so the card's step ladder reads the build with the candidate in. */
  ctx: EvalContext;
}

/**
 * One resolve per candidate, keyed by item id. A candidate whose resolve throws maps to null,
 * so one bad combination leaves its own row empty instead of failing the whole list.
 */
export function candidatePreviews(
  { db, build, slotId }: PreviewInputs,
  items: readonly Item[],
): Map<string, CandidatePreview | null> {
  const map = new Map<string, CandidatePreview | null>();
  for (const item of items) {
    try {
      map.set(item.id, candidatePreview(db, build, slotId, item));
    } catch {
      map.set(item.id, null);
    }
  }
  return map;
}

function candidatePreview(
  db: Db,
  build: Build,
  slotId: string,
  item: Item,
): CandidatePreview {
  const result = resolveWithCandidate(db, build, slotId, item.id);

  const current: Record<string, number> = {};
  for (const bonus of result.bonuses) {
    if (!bonus.active || bonus.slotId !== slotId || !bonus.appliedStats)
      continue;
    for (const [key, value] of Object.entries(bonus.appliedStats)) {
      current[key] = (current[key] ?? 0) + (value ?? 0);
    }
  }

  // Membership rather than `slotId` decides which bonuses are the item's: an inactive bonus
  // has no instancing slot, and a problem grant's `slotId` is whichever source sorted first.
  const bonusById = new Map(result.bonuses.map((bonus) => [bonus.id, bonus]));
  const potential: Record<string, number> = {};
  let conflict: string | null = null;
  for (const candidate of db.bonusesFor(item)) {
    const resolved = bonusById.get(candidate.bonus.id);
    if (!resolved) continue;
    const problem = resolved.active
      ? resolved.problems.find((p) => p.hideFromPicker)
      : undefined;
    if (problem) {
      conflict ??= `conflicts with ${problem.label ?? candidate.bonus.name}`;
    }
    if (resolved.active || resolved.excluded || !resolved.previewStats)
      continue;
    for (const [key, value] of Object.entries(resolved.previewStats)) {
      potential[key] = (potential[key] ?? 0) + (value ?? 0);
    }
  }

  return {
    current,
    potential,
    conflict,
    bonuses: bonusesForItem(db, item, bonusById),
    bonusById,
    ctx: result.ctx,
  };
}

/** Resolves `build` as if `itemId` were picked in `slotId`, side effects of the pick included. */
export function resolveWithCandidate(
  db: Db,
  build: Build,
  slotId: string,
  itemId: string,
): ResolvedBonuses {
  return engine.resolveBonuses(db, withChoice(db, build, slotId, itemId));
}

/**
 * Every resolved bonus `item` takes part in, its own and its sets', once each. Looked up by
 * membership rather than by `slotId`: a set bonus is attributed to the one slot that instanced
 * it, so filtering by slot would show nothing for the set's other items.
 */
export function bonusesForItem(
  db: Db,
  item: Item,
  bonusById: ReadonlyMap<string, EvaluatedBonus>,
): EvaluatedBonus[] {
  const seen = new Set<string>();
  const out: EvaluatedBonus[] = [];
  for (const entry of db.bonusesFor(item)) {
    const resolved = bonusById.get(entry.bonus.id);
    if (resolved && !seen.has(resolved.id)) {
      seen.add(resolved.id);
      out.push(resolved);
    }
  }
  return out;
}
