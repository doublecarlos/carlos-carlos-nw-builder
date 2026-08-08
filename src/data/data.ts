// Statically-imported game data.

import rawSchema from "../../data/schema.json";
import rawSlots from "../../data/slots.json";
import rawItems from "../../data/db-items.json";
import rawBonusSets from "../../data/db-bonuses.json";
import type {
  Schema,
  StatDef,
  StatKey,
  SlotsData,
  Slot,
  SectionPreset,
  Item,
  BonusSet,
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
    abilityContributions: raw.abilityContributions,
    forteSplit: raw.forteSplit,
    roles: raw.roles,
  };
}

/**
 * `data/slots.json` is authored nested (a section's slots -- and, optionally, its presets --
 * live inside it -- no per-slot `section` back-reference, no `row`; order is array position).
 * Every consumer (db.ts, engine.ts, bonus.ts, BuildEditor.vue) still wants the flat
 * `{sections, slots, presets}` shape `Db` has always had (plus presets), so this is the one
 * place that reconciles the two -- everything downstream is unchanged. `presets` is optional
 * per section in the JSON (most sections don't have any yet), hence the cast rather than a
 * destructure that `resolveJsonModule` could type-check against every section uniformly.
 */
function deriveSlots(raw: typeof rawSlots): SlotsData {
  return {
    sections: raw.sections.map(({ id, label, defaultOpen }) => ({
      id,
      label,
      defaultOpen,
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

export const NW_SCHEMA: Schema = deriveSchema(rawSchema);
export const NW_SLOTS: SlotsData = deriveSlots(rawSlots);
export const NW_ITEMS: Item[] = rawItems;
export const NW_BONUSES: BonusSet[] = rawBonusSets as BonusSet[];

/** What a build's stored choices/overlay were authored against -- storage.ts's export/import/
 * share-link envelope carries this so a stale build can warn ("no longer resolves") instead of
 * silently loading empty. Bump by hand whenever `data/db-items.json`/`data/db-bonuses.json`
 * change in a way that could invalidate an existing choice or overlay key (an item's id
 * reassigned, an item/bonus set removed) -- not on every data edit, only identity-affecting ones. */
export const NW_CATALOG_VERSION = 1;
