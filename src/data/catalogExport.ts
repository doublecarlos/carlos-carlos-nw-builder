// Regenerates the shipped data/db-items.json, data/db-bonuses.json, and data/slots.json
// bodies from the composed in-memory catalogue -- the maintainer path for pasting edits
// made in the layer editor back into the repo. Kept in its own module, separate from
// catalog.ts's core compose/upsert/etc, so LayerExportModal.vue can dynamic-import it and
// leave it a chunk the page never requests unless maintainer mode is on.
//
// Produces valid JSON, so the result can replace db-items.json / db-bonuses.json wholesale
// with no further editing (JSON has no comment syntax, so unlike the pre-JSON export there
// is no header here -- the provenance note lives in data/db-items.js / data/db-bonuses.js,
// the loaders that fetch these files). Formatting is Prettier's job once the result lands
// in the repo (`npm run fix`); this side only rebuilds each entry's own key order --
// id/name/filter leading, tags/bonuses/etc trailing -- so a hand edit that scrambles an
// item's keys is corrected back on the next `npm run fix` rather than round-tripping as-is
// forever. Stats (whatever is left over) keep their existing relative order: there is no
// canonical order among them worth enforcing, and their number/names vary per item.

import type {
  Item,
  Bonus,
  Slot,
  SectionPreset,
  SlotSection,
  FilterDefaultsMap,
} from "../types";

const ITEM_LEADING_KEYS = ["id", "name", "filter"] as const;
const ITEM_TRAILING_KEYS = [
  "shortDescription",
  "longDescription",
  "maxCopies",
  "dynamicStats",
  "allowedClass",
  "tags",
  "bonuses",
  "excludes",
  "inlineRepetition",
  "publishes",
] as const;

function canonicalItem(item: Item): Item {
  const used = new Set<string>([...ITEM_LEADING_KEYS, ...ITEM_TRAILING_KEYS]);
  const stats = Object.keys(item).filter((key) => !used.has(key));
  const ordered = {} as Record<string, unknown>;
  for (const key of [...ITEM_LEADING_KEYS, ...stats, ...ITEM_TRAILING_KEYS]) {
    const value = (item as Record<string, unknown>)[key];
    if (value !== undefined) ordered[key] = value;
  }
  return ordered as Item;
}

export function toItemsFile(items: Item[]): string {
  return `${JSON.stringify(items.map(canonicalItem), null, 2)}\n`;
}

export function toBonusesFile(bonuses: Bonus[]): string {
  const canonical = bonuses.map((bonus) => ({
    id: bonus.id,
    name: bonus.name ?? bonus.id,
    grants: bonus.grants ?? [],
    ...(bonus.excludes !== undefined ? { excludes: bonus.excludes } : {}),
    ...(bonus.stacking !== undefined ? { stacking: bonus.stacking } : {}),
    ...(bonus.maxStacks !== undefined ? { maxStacks: bonus.maxStacks } : {}),
  }));
  return `${JSON.stringify(canonical, null, 2)}\n`;
}

/** Drops the `section` field `data.ts`'s `deriveSlots` injects on load -- the raw file's own
 *  slot/preset objects never carry it (it's implied by nesting), so round-tripping through
 *  `toSlotsFile` has to strip it back off before re-serializing. */
function stripSection<T extends { section?: string }>(value: T) {
  const { section: _section, ...rest } = value;
  return rest;
}

/**
 * Regenerates the whole `data/slots.json` body from the composed in-memory data -- same "paste
 * back over the file" workflow `toItemsFile`/`toBonusesFile` already give items/bonuses, just
 * shaped for slots.json's nested `{ sections: [{ ..., presets?, slots }] }` structure instead of
 * a bare top-level array.
 */
export function toSlotsFile(
  sections: SlotSection[],
  slots: Slot[],
  presets: SectionPreset[],
  filterDefaults: FilterDefaultsMap = {},
): string {
  const body = {
    filterDefaults,
    sections: sections.map((section) => {
      const sectionSlots = slots
        .filter((slot) => slot.section === section.id)
        .map(stripSection);
      const sectionPresets = presets
        .filter((preset) => preset.section === section.id)
        .map(stripSection);
      return {
        defaultOpen: section.defaultOpen,
        id: section.id,
        label: section.label,
        ...(sectionPresets.length ? { presets: sectionPresets } : {}),
        slots: sectionSlots,
      };
    }),
  };
  return `${JSON.stringify(body, null, 2)}\n`;
}
