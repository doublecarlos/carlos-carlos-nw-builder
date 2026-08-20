// Which slots could supply a given bonus.
//
// This is the question the Bonuses tab's "1 away" badge raises and could not answer: it tells
// you a bonus is one occurrence short, but not where that occurrence could come from.
//
// Deliberately a *candidate* question, not a resolved one -- "which rows can hold something
// that contributes to this bonus", answered off the catalogue alone. That is what makes it
// affordable: BuildEditor's `slotGrantsStat` explains why the stat filter refuses to consider
// not-yet-chosen items (it would mean re-running the engine per candidate per slot), and this
// never asks what a candidate *would* do -- only whether the bonus lists it as a member.

import type { Db } from "../types";

const EMPTY: ReadonlySet<string> = new Set();

/** Per-`Db` memo. Neither the catalogue nor a bonus's membership changes while a `Db` is
 *  alive, and a rebuilt one (a layer edit) simply gets a fresh index. */
const cache = new WeakMap<Db, Map<string, Set<string>>>();

/**
 * bonus id -> the ids of every slot whose candidate list contains a contributing item.
 *
 * Built for every bonus in one pass rather than per bonus on demand: the inspector asks this
 * of each of its ~40 rows to decide which ones can offer the filter at all, and answering
 * them one at a time would walk the whole slot list once per row.
 *
 * Candidates come from `db.forSlot`, not `forSlotAndBuild`: a slot the current class or a
 * `maxCopies` cap rules out is still where that bonus would come from, and hiding it would
 * answer a different question than the one asked.
 */
function index(db: Db): Map<string, Set<string>> {
  const memoized = cache.get(db);
  if (memoized) return memoized;

  const bySlot = new Map<string, Set<string>>();
  for (const slot of db.slots) {
    if (slot.type !== "item_picker" && slot.type !== "point_assignment") {
      continue;
    }
    for (const item of db.forSlot(slot.id)) {
      for (const candidate of db.bonusesFor(item)) {
        const slots = bySlot.get(candidate.bonusId);
        if (slots) slots.add(slot.id);
        else bySlot.set(candidate.bonusId, new Set([slot.id]));
      }
    }
  }

  cache.set(db, bySlot);
  return bySlot;
}

/** The slots that could supply `bonusId`. Empty when nothing in the catalogue offers it. */
export function slotsSupplying(db: Db, bonusId: string): ReadonlySet<string> {
  return index(db).get(bonusId) ?? EMPTY;
}

/** Whether offering "show me where this comes from" would lead anywhere. */
export function hasSuppliers(db: Db, bonusId: string): boolean {
  return slotsSupplying(db, bonusId).size > 0;
}
