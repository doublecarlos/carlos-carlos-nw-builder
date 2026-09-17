// Which slots could supply a given need: a bonus, a tag, or an item.
//
// This is the question the Bonuses tab's "1 away" badge raises and could not answer: it tells
// you a bonus is one occurrence short, but not where that occurrence could come from. The
// same question comes up one level down, for an unmet `equipped` condition: which rows can
// hold something carrying that tag, or that exact item.
//
// Deliberately a *candidate* question, not a resolved one: "which rows can hold something
// that contributes to this", answered off the catalog alone. That is what makes it
// affordable: BuildEditor's `slotGrantsStat` explains why the stat filter refuses to consider
// not-yet-chosen items (it would mean re-running the engine per candidate per slot), and this
// never asks what a candidate *would* do, only whether the bonus lists it as a member, or
// whether the item carries the tag.

import type { ConditionLeafResult, Db, SupplyNeed } from "../types";

const EMPTY: ReadonlySet<string> = new Set();

interface SupplyIndex {
  bonus: Map<string, Set<string>>;
  tag: Map<string, Set<string>>;
  item: Map<string, Set<string>>;
}

/** Per-`Db` memo. Neither the catalog nor a bonus's membership changes while a `Db` is
 *  alive, and a rebuilt one (a layer edit) simply gets a fresh index. */
const cache = new WeakMap<Db, SupplyIndex>();

function add(map: Map<string, Set<string>>, key: string, slotId: string) {
  const slots = map.get(key);
  if (slots) slots.add(slotId);
  else map.set(key, new Set([slotId]));
}

/**
 * bonus id / tag / item id -> the ids of every slot whose candidate list contains an item
 * that supplies it.
 *
 * Built for everything in one pass rather than per key on demand: the inspector asks this
 * of each of its ~40 rows to decide which ones can offer the filter at all, and answering
 * them one at a time would walk the whole slot list once per row.
 *
 * An `item_picker_list` is indexed under the container's id, not its rows'. Row count is not
 * a catalog fact, and this index is memoized per `Db`. Callers testing a rendered row against
 * it check the row's `list` alongside its own id.
 *
 * Candidates come from `db.forSlot`, not `forSlotAndBuild`: a slot the current class or a
 * `maxCopies` cap rules out is still where that bonus would come from, and hiding it would
 * answer a different question than the one asked.
 */
function index(db: Db): SupplyIndex {
  const memoized = cache.get(db);
  if (memoized) return memoized;

  const built: SupplyIndex = {
    bonus: new Map(),
    tag: new Map(),
    item: new Map(),
  };
  for (const slot of db.slots) {
    if (
      slot.type !== "item_picker" &&
      slot.type !== "item_picker_list" &&
      slot.type !== "point_assignment"
    ) {
      continue;
    }
    for (const item of db.forSlot(slot.id)) {
      add(built.item, item.id, slot.id);
      for (const tag of item.tags ?? []) add(built.tag, tag, slot.id);
      for (const candidate of db.bonusesFor(item)) {
        add(built.bonus, candidate.bonusId, slot.id);
      }
    }
  }

  cache.set(db, built);
  return built;
}

/** The slots that could supply `need`. Empty when nothing in the catalog offers it. */
export function slotsSupplying(db: Db, need: SupplyNeed): ReadonlySet<string> {
  const by = index(db);
  switch (need.kind) {
    case "bonus":
      return by.bonus.get(need.bonusId) ?? EMPTY;
    case "tag":
      return by.tag.get(need.tag) ?? EMPTY;
    case "item":
      return by.item.get(need.itemId) ?? EMPTY;
  }
}

/** Whether offering "show me where this comes from" would lead anywhere. */
export function hasSuppliers(db: Db, need: SupplyNeed): boolean {
  return slotsSupplying(db, need).size > 0;
}

/**
 * The need a "where would I get this" action on a condition line should filter by, or null
 * when the line gets no such action: a met leaf (inside a `not`, more of it is the wrong
 * direction), a leaf about the context rather than the catalog, or a need nothing in the
 * catalog can supply.
 */
export function supplyNeedFor(
  db: Db,
  leaf: ConditionLeafResult,
): SupplyNeed | null {
  return !leaf.ok && leaf.need && hasSuppliers(db, leaf.need)
    ? leaf.need
    : null;
}
