// Statically-imported game data, replacing the classic fetch+window-global loaders
// (data/*.js) for anything that can run outside a browser (Vitest specs) or doesn't need to
// wait on a runtime fetch. `data/schema.json` is hand-written/authoritative; `data/slots.json`,
// `data/db-items.json` and `data/db-bonuses.json` are GENERATED via tools/*.py -- never hand-
// edit those three, regenerate them instead.
//
// `deriveSchema` ports data/schema.js's derivation logic verbatim (byKey/statKeys/etc; see that
// file's header comment for the FIX-note provenance). The browser app still uses the classic
// data/*.js loaders + window.NW_* globals until Phase 3 of the npm/Vite migration switches it
// over to this module too and deletes them.

import rawSchema from '../data/schema.json';
import rawSlots from '../data/slots.json';
import rawItems from '../data/db-items.json';
import rawBonusSets from '../data/db-bonuses.json';

function deriveSchema(raw: any) {
  const byKey: Record<string, any> = {};
  raw.stats.forEach((s: any) => { byKey[s.key] = s; });

  return {
    stats: raw.stats,
    statByKey: byKey,
    statKeys: raw.stats.map((s: any) => s.key),
    multiplicativeStats: raw.stats.filter((s: any) => s.kind === 'mult').map((s: any) => s.key),
    ratingStats: raw.stats.filter((s: any) => s.kind === 'rating').map((s: any) => s.key),
    abilityStats: raw.stats.filter((s: any) => s.ability).map((s: any) => s.key),
    ratingConversion: raw.ratingConversion,
    abilityContributions: raw.abilityContributions,
    forteSplit: raw.forteSplit,
    roles: raw.roles,
    context: raw.context,
  };
}

export const NW_SCHEMA = deriveSchema(rawSchema);
export const NW_SLOTS = rawSlots;
export const NW_ITEMS = rawItems;
export const NW_BONUSES = rawBonusSets;
