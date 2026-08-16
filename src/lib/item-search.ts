// Searchable text for one catalogue item, so the picker's typeahead can match what an item
// *does* -- its stats, and the bonuses it belongs to -- not just what it is called.
//
// Built statically off the catalogue rather than off the picker's live preview lines, which
// matters most for bonuses: a bonus contributes the same searchable text whether it is already
// active, only partly unlocked, or unreachable in the current build, so searching "gladiator"
// finds the pieces of a set that has not been completed yet. It also keeps this independent of
// any `Build`, so it costs no engine resolve and works the same in callers that have no live
// build to resolve against (PresetForm's item rows).
//
// Matching itself stays in text-filter.ts -- this only assembles the haystack.

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

/** A bonus's own name plus every stat any of its grants can pay out. Every payload shape is
 *  walked (`stats`, `variants`, `tiers`) because which one applies is a runtime question this
 *  deliberately does not ask -- see the note at the top on why potential counts as searchable. */
const pushBonusTerms = (schema: Schema, bonus: Bonus, out: string[]) => {
  if (bonus.name) out.push(bonus.name);
  for (const grant of bonus.grants ?? []) {
    if (grant.name) out.push(grant.name);
    if (grant.shortDescription) out.push(grant.shortDescription);
    pushStatValues(schema, grant.stats, out);
    for (const variant of grant.variants ?? [])
      pushStatValues(schema, variant.stats, out);
    for (const tier of grant.tiers ?? [])
      pushStatValues(schema, tier.stats, out);
  }
};

/** Per-`Db` memo: the text for an item never changes while the catalogue it came from is alive,
 *  and a rebuilt Db (a catalogue overlay edit) simply gets a fresh map. */
const cache = new WeakMap<Db, Map<string, string>>();

/**
 * The extra haystack ItemPicker hands ComboBox alongside an option's label -- the item's own
 * stats and every bonus it contributes to, joined into one blob. Case is irrelevant here;
 * `matchesQuery` lowercases both sides.
 */
export function itemSearchText(db: Db, item: Item): string {
  let byId = cache.get(db);
  if (!byId) {
    byId = new Map();
    cache.set(db, byId);
  }
  const memoized = byId.get(item.id);
  if (memoized !== undefined) return memoized;

  const terms: string[] = [];
  if (item.shortDescription) terms.push(item.shortDescription);
  for (const key of db.schema.statKeys) {
    if (!item[key]) continue;
    pushStatTerms(db.schema, key, terms);
  }
  for (const candidate of db.bonusesFor(item))
    pushBonusTerms(db.schema, candidate.bonus, terms);

  const text = terms.join(" ");
  byId.set(item.id, text);
  return text;
}
