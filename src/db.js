// Item database indexing (plan §4.2).
//
// Consumes the globals published by data/db-items.js, data/db-bonuses.js, data/schema.js and
// data/slots.js and builds the lookups the engine and UI need. Pure: no DOM, no fetch.

window.NW = window.NW ?? {};
window.NW.db = (() => {
  'use strict';

  const pushTo = (map, key, value) => {
    const list = map.get(key);
    if (list) list.push(value);
    else map.set(key, [value]);
  };

  function build(items, bonusSets = [], schema, slots) {
    const byName = new Map();
    const byFilter = new Map();
    const setMembers = new Map();     // setId -> [item name]
    const itemsByTag = new Map();     // tag   -> [item name]
    const duplicates = [];

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
    const slotById = new Map(slotList.map((slot) => [slot.id, slot]));

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
      get(name) {
        if (name == null || name === '' || name === '-') return null;
        return byName.get(name) ?? null;
      },

      /** Items selectable in a filter category, sorted by name. */
      forFilter: (filter) => byFilter.get(filter) ?? [],

      /** Items selectable in a given slot id. */
      forSlot(slotId) {
        const slot = slotById.get(slotId);
        return slot ? (byFilter.get(slot.filter) ?? []) : [];
      },

      /** 0 or absent means unlimited. */
      maxCopies: (item) => item?.maxCopies ?? 0,

      /**
       * Every bonus an item contributes: every bonus set it belongs to, whether that set has
       * one member (a bonus that is nobody else's business) or many.
       */
      bonusesFor(item) {
        return (item.bonuses ?? []).flatMap((setId) => {
          const set = bonusSetById.get(setId);
          return set ? set.effects.map((bonus) => ({ bonus, setId, source: item.name })) : [];
        });
      },
    };
  }

  return {
    build,
    /** Convenience for the browser: build from the loaded globals. */
    fromGlobals: () => build(
      window.NW_ITEMS, window.NW_BONUSES, window.NW_SCHEMA, window.NW_SLOTS,
    ),
  };
})();
