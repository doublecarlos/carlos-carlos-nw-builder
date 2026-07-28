// Statically-imported game data.

import rawSchema from '../data/schema.json';
import rawSlots from '../data/slots.json';
import rawItems from '../data/db-items.json';
import rawBonusSets from '../data/db-bonuses.json';
import type { Schema, StatDef, StatKey, SlotsData, Item, BonusSet } from './types';

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
    context: raw.context,
  };
}

export const NW_SCHEMA: Schema = deriveSchema(rawSchema);
export const NW_SLOTS: SlotsData = rawSlots;
export const NW_ITEMS: Item[] = rawItems;
export const NW_BONUSES: BonusSet[] = rawBonusSets;
