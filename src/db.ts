// Item database indexing (plan §4.2).
//
// Consumes the globals published by data/db-items.js, data/db-bonuses.js, data/schema.js and
// data/slots.js and builds the lookups the engine and UI need. Pure: no DOM, no fetch.
//
// `fromGlobals` still reads `window.NW_*` for now -- Phase 3 of the npm/Vite migration replaces
// those globals with a `src/data.ts` module of static imports; until then the data/*.js classic
// loaders are still what populates them.

import { NW_ITEMS, NW_BONUSES, NW_SCHEMA, NW_SLOTS } from './data';

const pushTo = (map: Map<any, any[]>, key: any, value: any) => {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
};

export function build(items: any[], bonusSets: any[] = [], schema: any, slots: any) {
  const byName = new Map<string, any>();
  const byFilter = new Map<string, any[]>();
  const setMembers = new Map<string, string[]>();     // setId -> [item name]
  const itemsByTag = new Map<string, string[]>();     // tag   -> [item name]
  const duplicates: string[] = [];

  for (const item of items) {
    if (byName.has(item.name)) duplicates.push(item.name);
    byName.set(item.name, item);
    pushTo(byFilter, item.filter, item);

    for (const setId of item.bonuses ?? []) pushTo(setMembers, setId, item.name);
    for (const tag of item.tags ?? []) pushTo(itemsByTag, tag, item.name);
  }

  for (const list of byFilter.values()) {
    list.sort((a, b) => a.name.localeCompare(b.name));
  }

  // Shared bonuses, keyed by set id. Membership is never listed here -- it lives on the
  // items (`sets: [...]`, plan §2.3), so this is the only place the two are joined.
  const bonusSetById = new Map(bonusSets.map((set) => [set.id, set]));
  const slotList = slots?.slots ?? [];
  const slotById = new Map<string, any>(slotList.map((slot: any) => [slot.id, slot]));

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

    /** Look up an item by exact name. `-`, blank and nullish all mean "empty slot". */
    get(name: string | null | undefined) {
      if (name == null || name === '' || name === '-') return null;
      return byName.get(name) ?? null;
    },

    /** Items selectable in a filter category, sorted by name. */
    forFilter: (filter: string) => byFilter.get(filter) ?? [],

    /** Items selectable in a given slot id. */
    forSlot(slotId: string) {
      const slot = slotById.get(slotId);
      return slot ? (byFilter.get(slot.filter) ?? []) : [];
    },

    /** 0 or absent means unlimited. */
    maxCopies: (item: any) => item?.maxCopies ?? 0,

    /**
     * Every bonus an item contributes: every bonus set it belongs to, whether that set has
     * one member (a bonus that is nobody else's business) or many. One candidate per set --
     * a set resolves as one unit (bonus.js sums its `grants`), not one candidate per grant.
     */
    bonusesFor(item: any) {
      return (item.bonuses ?? []).flatMap((setId: string) => {
        const set = bonusSetById.get(setId);
        return set ? [{ bonus: set, setId: set.id, source: item.name }] : [];
      });
    },
  };
}

/** Convenience for the browser: build from the loaded globals. */
export const fromGlobals = () => build(
  (window as any).NW_ITEMS,
  (window as any).NW_BONUSES,
  (window as any).NW_SCHEMA,
  (window as any).NW_SLOTS,
);

/** Convenience for tests/tooling: build from the statically-imported data (src/data.ts), no
 * `window` required. */
export const fromData = () => build(
  NW_ITEMS, NW_BONUSES, NW_SCHEMA, NW_SLOTS,
);
