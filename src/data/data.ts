// Statically-imported game data.

import rawSchema from "../../data/schema.json";
import rawSlots from "../../data/slots.json";
import rawVocabulary from "../../data/vocabulary.json";
import rawItems from "../../data/db-items.json";
import rawBonuses from "../../data/db-bonuses.json";
import type {
  Schema,
  StatDef,
  StatKey,
  SlotsData,
  Slot,
  FilterDef,
  TagDef,
  SectionPreset,
  Item,
  Bonus,
} from "../types";

function deriveSchema(raw: typeof rawSchema): Schema {
  const byKey = {} as Record<StatKey, StatDef>;
  raw.stats.forEach((s) => {
    byKey[s.key] = s;
  });

  return {
    stats: raw.stats,
    statByKey: byKey,
    statKeys: raw.stats.map((s) => s.key),
    multiplicativeStats: raw.stats
      .filter((s) => s.kind === "mult")
      .map((s) => s.key),
    ratingStats: raw.stats.filter((s) => s.kind === "rating").map((s) => s.key),
    abilityStats: raw.stats
      .filter((s): boolean => "ability" in s && Boolean(s.ability))
      .map((s) => s.key),
    ratingConversion: raw.ratingConversion,
    statContributions: raw.statContributions,
    forteSplit: raw.forteSplit,
    roles: raw.roles,
  };
}

/**
 * Flattens the nested `data/slots.json` into the `{sections, slots, presets}` shape `Db` uses:
 * each slot and preset gets its `section`, each section its `slotIds`. `presets` is optional
 * per section, hence the cast.
 */
function deriveSlots(raw: typeof rawSlots): SlotsData {
  return {
    sections: raw.sections.map(({ id, label, defaultOpen, slots }) => ({
      id,
      label,
      defaultOpen,
      slotIds: slots.map((slot) => slot.id),
    })),
    slots: raw.sections.flatMap((section) =>
      section.slots.map((slot) => ({ ...slot, section: section.id }) as Slot),
    ),
    presets: raw.sections.flatMap((section) => {
      const rawPresets = (
        section as { presets?: Omit<SectionPreset, "section">[] }
      ).presets;
      return (rawPresets ?? []).map(
        (preset) => ({ ...preset, section: section.id }) as SectionPreset,
      );
    }),
  };
}

/**
 * Turns one id-keyed section of `data/vocabulary.json` into a list of entities with their id
 * inside, like items. Sorted by id, the same order the file is written in.
 */
function deriveSection<T extends { id: string }>(
  raw: Record<string, Omit<T, "id">>,
): T[] {
  return Object.keys(raw)
    .sort()
    .map((id) => ({ id, ...raw[id] }) as T);
}

export const NW_SCHEMA: Schema = deriveSchema(rawSchema);
export const NW_SLOTS: SlotsData = deriveSlots(rawSlots);
export const NW_FILTERS: FilterDef[] = deriveSection<FilterDef>(
  rawVocabulary.filters,
);
export const NW_TAGS: TagDef[] = deriveSection<TagDef>(rawVocabulary.tags);
export const NW_ITEMS: Item[] = rawItems;
export const NW_BONUSES: Bonus[] = rawBonuses as Bonus[];

/** What a build's stored choices/overlay were authored against -- storage.ts's export/import/
 * share-link envelope carries this so a stale build can warn ("no longer resolves") instead of
 * silently loading empty. Bump by hand whenever `data/db-items.json`/`data/db-bonuses.json`
 * change in a way that could invalidate an existing choice or overlay key (an item's id
 * reassigned, an item/bonus removed) -- not on every data edit, only identity-affecting ones. */
export const NW_CATALOG_VERSION = 2;
