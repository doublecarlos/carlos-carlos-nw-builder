// What a picker candidate would do if picked, for the picker's preview lines and item card.
// Vue-free so it is unit-testable.
import * as engine from "../engine/engine";
import type {
  Build,
  Db,
  EvaluatedBonus,
  Item,
  ResolvedBonuses,
} from "../types";

/** Resolves `build` as if `itemId` were picked in `slotId`; every other choice is left alone. */
export function resolveWithCandidate(
  db: Db,
  build: Build,
  slotId: string,
  itemId: string,
): ResolvedBonuses {
  return engine.resolveBonuses(db, {
    ...build,
    choices: { ...build.choices, [slotId]: itemId },
  });
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
