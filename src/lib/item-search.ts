// Searchable text for one catalog item, so the picker's typeahead can match what an item
// *does* -- its stats, and the bonuses it belongs to -- not just what it is called.
//
// Split into buckets because the picker options menu turns each off independently. A bonus
// payload's stats count as stat text: "severity" should find the gear that grants it.
//
// Built statically off the catalog rather than off the picker's live preview lines, which
// matters most for bonuses: a bonus contributes the same searchable text whether it is already
// active, only partly unlocked, or unreachable in the current build, so searching "gladiator"
// finds the pieces of a set that has not been completed yet. It also keeps this independent of
// any `Build`, so it costs no engine resolve and works the same in callers that have no live
// build to resolve against (PresetForm's item rows).
//
// Matching itself stays in text-filter.ts -- this only assembles the haystack.

import { slotLine } from "../engine/insignia";
import type { Bonus, Db, Item, Schema, StatKey, StatValues } from "../types";

/** Every way a user might name one stat: its schema label, its short form, and the raw key
 *  (which is what shows up in exported/imported data, so it is worth matching too). */
const pushStatTerms = (schema: Schema, key: StatKey, out: string[]) => {
  const def = schema.statByKey[key];
  out.push(key);
  if (def?.label) out.push(def.label);
  if (def?.abbr) out.push(def.abbr);
};

const pushStatValues = (
  schema: Schema,
  stats: StatValues | undefined,
  out: string[],
) => {
  for (const [key, value] of Object.entries(stats ?? {})) {
    if (!value) continue;
    pushStatTerms(schema, key as StatKey, out);
  }
};

/** Every payload shape is walked, because which one applies is a runtime question. */
const pushBonusStats = (schema: Schema, bonus: Bonus, out: string[]) => {
  for (const grant of bonus.grants ?? []) {
    pushStatValues(schema, grant.stats, out);
    for (const variant of grant.variants ?? [])
      pushStatValues(schema, variant.stats, out);
    for (const tier of grant.tiers ?? [])
      pushStatValues(schema, tier.stats, out);
  }
};

/** What a bonus is called, down to each grant's own name and blurb. */
const pushBonusNames = (bonus: Bonus, out: string[]) => {
  if (bonus.name) out.push(bonus.name);
  for (const grant of bonus.grants ?? []) {
    if (grant.name) out.push(grant.name);
    if (grant.shortDescription) out.push(grant.shortDescription);
  }
};

export interface ItemSearchText {
  /** The item's own stats, plus every stat its bonuses can pay out. */
  stat: string;
  /** The names and blurbs of the bonuses the item takes part in. */
  bonus: string;
}

/** Per-`Db` memo: the text for an item never changes while the catalog it came from is alive,
 *  and a rebuilt Db (a catalog overlay edit) simply gets a fresh map. */
const cache = new WeakMap<Db, Map<string, ItemSearchText>>();

/**
 * The extra haystacks ItemPicker hands ComboBox, one per search option. `matchesQuery`
 * lowercases both sides. An item's own description and slot line go in `stat`: they describe
 * the gear, and there is no third switch to hang them off.
 */
export function itemSearchText(db: Db, item: Item): ItemSearchText {
  let byId = cache.get(db);
  if (!byId) {
    byId = new Map();
    cache.set(db, byId);
  }
  const memoized = byId.get(item.id);
  if (memoized !== undefined) return memoized;

  const stat: string[] = [];
  const bonus: string[] = [];
  if (item.shortDescription) stat.push(item.shortDescription);
  if (item.insigniaSlots) stat.push(slotLine(item));
  for (const key of db.schema.statKeys) {
    if (!item[key]) continue;
    pushStatTerms(db.schema, key, stat);
  }
  for (const candidate of db.bonusesFor(item)) {
    pushBonusStats(db.schema, candidate.bonus, stat);
    pushBonusNames(candidate.bonus, bonus);
  }

  const text = { stat: stat.join(" "), bonus: bonus.join(" ") };
  byId.set(item.id, text);
  return text;
}
