// Item database indexing (plan §4.2).
//
// Consumes the statically-imported data (src/data.ts) and builds the lookups the engine and UI
// need. Pure: no DOM, no fetch -- `build()` takes items/bonusSets/schema/slots as plain
// arguments so catalog.ts can hand it a composed (base + overlay) catalogue instead.

import { NW_ITEMS, NW_BONUSES, NW_SCHEMA, NW_SLOTS } from './data';
import type { Item, BonusSet, Schema, SlotsData, Slot, Db, BonusCandidate } from './types';

const pushTo = <K,>(map: Map<K, string[]>, key: K, value: string) => {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
};

export function build(items: Item[], bonusSets: BonusSet[] = [], schema: Schema, slots: SlotsData): Db {
  const byId = new Map<string, Item>();
  // Keyed by `string | undefined` (not just `string`): an item with no `filter` still lands
  // here under the `undefined` key, same as the untyped original -- dead weight (`forFilter`
  // is only ever called with a real string) but preserved rather than silently dropped.
  const byFilter = new Map<string | undefined, Item[]>();
  const setMembers = new Map<string, string[]>();     // setId -> [item id]
  const itemsByTag = new Map<string, string[]>();     // tag   -> [item id]
  const duplicates: string[] = [];

  for (const item of items) {
    if (byId.has(item.id)) duplicates.push(item.id);
    byId.set(item.id, item);
    const filterList = byFilter.get(item.filter);
    if (filterList) filterList.push(item);
    else byFilter.set(item.filter, [item]);

    for (const setId of item.bonuses ?? []) pushTo(setMembers, setId, item.id);
    for (const tag of item.tags ?? []) pushTo(itemsByTag, tag, item.id);
  }

  for (const list of byFilter.values()) {
    list.sort((a, b) => a.name.localeCompare(b.name));
  }

  // Shared bonuses, keyed by set id. Membership is never listed here -- it lives on the
  // items (`sets: [...]`, plan §2.3), so this is the only place the two are joined.
  const bonusSetById = new Map(bonusSets.map((set) => [set.id, set]));
  const slotList = slots?.slots ?? [];
  const slotById = new Map<string, Slot>(slotList.map((slot) => [slot.id, slot]));

  return {
    items,
    schema,
    slots: slotList,
    sections: slots?.sections ?? [],
    slotById,
    bonusSets,
    bonusSetById,
    setMembers,
    itemsByTag,
    duplicates,

    /** Look up an item by id. `-`, blank and nullish all mean "empty slot". */
    get(id: string | null | undefined) {
      if (id == null || id === '' || id === '-') return null;
      return byId.get(id) ?? null;
    },

    /** Items selectable in a filter category, sorted by name. */
    forFilter: (filter: string) => byFilter.get(filter) ?? [],

    /** Items selectable in a given slot id -- empty for a build_parameter slot, which has no
     * `filter` to look up (it isn't an item choice at all). */
    forSlot(slotId: string) {
      const slot = slotById.get(slotId);
      return slot?.type === 'item_picker' ? (byFilter.get(slot.filter) ?? []) : [];
    },

    /** 0 or absent means unlimited. */
    maxCopies: (item: Item | null | undefined) => item?.maxCopies ?? 0,

    /**
     * Every bonus an item contributes: every bonus set it belongs to, whether that set has
     * one member (a bonus that is nobody else's business) or many. One candidate per set --
     * a set resolves as one unit (bonus.js sums its `grants`), not one candidate per grant.
     */
    bonusesFor(item: Item): BonusCandidate[] {
      return (item.bonuses ?? []).flatMap((setId: string) => {
        const set = bonusSetById.get(setId);
        return set ? [{ bonus: set, setId: set.id, source: item.name }] : [];
      });
    },
  };
}

/** Convenience for tests/tooling: build from the statically-imported data (src/data.ts), no
 * `window` required. */
export const fromData = () => build(
  NW_ITEMS, NW_BONUSES, NW_SCHEMA, NW_SLOTS,
);
