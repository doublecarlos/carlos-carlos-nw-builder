// Regenerates the shipped data/db-items.json, data/db-bonuses.json, and data/slots.json
// bodies from the composed in-memory catalog -- the maintainer path for pasting edits
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
  BonusOccurrenceSpec,
  ConditionWhen,
  Grant,
  Slot,
  SectionPreset,
  SlotSection,
  FilterDefaultsMap,
  FilterFieldsMap,
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

/** An occurrence leaf naming the bonus it sits in is spelled by omitting `bonus`, which is
 *  how the engine reads an absent one (`EvalContext.self`). */
function implicitSelf(
  spec: BonusOccurrenceSpec,
  self: string,
): BonusOccurrenceSpec {
  if (spec.bonus !== self) return spec;
  const { bonus: _self, ...rest } = spec;
  return rest;
}

function whenWithImplicitSelf(
  when: ConditionWhen,
  self: string,
): ConditionWhen {
  const out: ConditionWhen = { ...when };
  if (out.bonusOccurrences)
    out.bonusOccurrences = implicitSelf(out.bonusOccurrences, self);
  if (out.all) out.all = out.all.map((sub) => whenWithImplicitSelf(sub, self));
  if (out.any) out.any = out.any.map((sub) => whenWithImplicitSelf(sub, self));
  if (out.not) out.not = whenWithImplicitSelf(out.not, self);
  return out;
}

/** "At least one of the bonus itself" is no gate at all: a bonus is only evaluated through an
 *  attachment, and one contributing no occurrences already forces every grant inactive
 *  (bonus.ts's `evaluateBonus`). Only as the whole `when`: combined with anything else, or
 *  negated, the leaf is not trivially true. */
function isTrivialSelfGate(when: ConditionWhen): boolean {
  const spec = when.bonusOccurrences;
  return (
    Object.keys(when).length === 1 &&
    spec !== undefined &&
    spec.bonus === undefined &&
    spec.below === undefined &&
    spec.exactly === undefined &&
    (spec.atLeast === undefined || spec.atLeast === 1)
  );
}

function canonicalWhen(
  when: ConditionWhen,
  self: string,
): ConditionWhen | undefined {
  const out = whenWithImplicitSelf(when, self);
  return isTrivialSelfGate(out) ? undefined : out;
}

/** Keeps `key`'s position while dropping it when its canonical form is empty. */
function withWhen<T extends { when?: ConditionWhen }>(
  holder: T,
  self: string,
): T {
  if (!holder.when) return holder;
  const when = canonicalWhen(holder.when, self);
  const { when: _when, ...rest } = holder;
  return (when ? { ...holder, when } : rest) as T;
}

function grantWithImplicitSelf(grant: Grant, self: string): Grant {
  const out: Grant = withWhen(grant, self);
  if (out.variants)
    out.variants = out.variants.map((variant) => withWhen(variant, self));
  if (out.tiers)
    out.tiers = out.tiers.map((tier) =>
      tier.bonusOccurrences
        ? {
            ...tier,
            bonusOccurrences: implicitSelf(tier.bonusOccurrences, self),
          }
        : tier,
    );
  return out;
}

export function toBonusesFile(bonuses: Bonus[]): string {
  const canonical = bonuses.map((bonus) => ({
    id: bonus.id,
    name: bonus.name ?? bonus.id,
    grants: (bonus.grants ?? []).map((grant) =>
      grantWithImplicitSelf(grant, bonus.id),
    ),
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
 * shaped for slots.json's nested `{ filterDefaults, filterFields, sections: [{ ..., presets?,
 * slots }] }` structure instead of a bare top-level array. `filterDefaults` and `filterFields`
 * are required rather than defaulted: neither is composed from the layers, so a caller that
 * omits one drops the block.
 */
export function toSlotsFile(
  sections: SlotSection[],
  slots: Slot[],
  presets: SectionPreset[],
  filterDefaults: FilterDefaultsMap,
  filterFields: FilterFieldsMap,
): string {
  const body = {
    filterDefaults,
    filterFields,
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
