// Statically-imported game data.

import rawSchema from '../data/schema.json';
import rawSlots from '../data/slots.json';
import rawItems from '../data/db-items.json';
import rawBonusSets from '../data/db-bonuses.json';
import type { Schema, StatDef, StatKey, SlotsData, Slot, Item, BonusSet } from './types';

function deriveSchema(raw: typeof rawSchema): Schema {
  const byKey = {} as Record<StatKey, StatDef>;
  raw.stats.forEach((s) => { byKey[s.key] = s; });

  return {
    stats: raw.stats,
    statByKey: byKey,
    statKeys: raw.stats.map((s) => s.key),
    multiplicativeStats: raw.stats.filter((s) => s.kind === 'mult').map((s) => s.key),
    ratingStats: raw.stats.filter((s) => s.kind === 'rating').map((s) => s.key),
    abilityStats: raw.stats.filter((s): boolean => 'ability' in s && Boolean(s.ability)).map((s) => s.key),
    ratingConversion: raw.ratingConversion,
    abilityContributions: raw.abilityContributions,
    forteSplit: raw.forteSplit,
    roles: raw.roles,
  };
}

/**
 * `data/slots.json` is authored nested (a section's slots live inside it -- no per-slot `section`
 * back-reference, no `row`; order is array position). Every consumer (db.ts, engine.ts,
 * bonus.ts, BuildEditor.vue) still wants the flat `{sections, slots}` shape `Db` has always had,
 * so this is the one place that reconciles the two -- everything downstream is unchanged.
 */
function deriveSlots(raw: typeof rawSlots): SlotsData {
  return {
    sections: raw.sections.map(({ id, label }) => ({ id, label })),
    slots: raw.sections.flatMap((section) => section.slots.map((slot) => (
      { ...slot, section: section.id } as Slot
    ))),
  };
}

export const NW_SCHEMA: Schema = deriveSchema(rawSchema);
export const NW_SLOTS: SlotsData = deriveSlots(rawSlots);
export const NW_ITEMS: Item[] = rawItems;
export const NW_BONUSES: BonusSet[] = rawBonusSets;
