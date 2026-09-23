// Regenerates the shipped data/*.json files from the composed catalog, so maintainers can paste
// layer editor edits back into the repo. A separate module so it is only loaded in maintainer
// mode.
//
// Produces valid JSON that can replace the data files wholesale. Whitespace is left to
// Prettier (`npm run fix`). Key order is rebuilt here, so a hand edit that scrambles it is
// corrected on the next `npm run fix`. Stats follow their order in data/schema.json.

import { NW_SCHEMA } from "./data";
import type {
  Item,
  Bonus,
  BonusOccurrenceSpec,
  ConditionWhen,
  DynamicStatConfig,
  Grant,
  GrantTier,
  GrantVariant,
  Slot,
  SectionPreset,
  SlotSection,
  FilterDef,
  Schema,
  StatValues,
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
const BONUS_KEYS = [
  "id",
  "name",
  "grants",
  "excludes",
  "stacking",
  "maxStacks",
] as const;
const GRANT_KEYS = [
  "name",
  "when",
  "stats",
  "dynamicStats",
  "variants",
  "tiers",
  "problem",
  "scaledBy",
  "shortDescription",
  "longDescription",
] as const;
const VARIANT_KEYS = ["when", "stats", "dynamicStats"] as const;
const TIER_KEYS = ["bonusOccurrences", "stats"] as const;
const PROBLEM_KEYS = [
  "severity",
  "message",
  "label",
  "hideFromPicker",
] as const;
const DYNAMIC_STAT_KEYS = ["stat", "min", "max", "default", "label"] as const;

/** Rebuilds `value` with `leading` keys first and `trailing` keys last, each in the given
 *  order. Unlisted keys keep their relative order in between. Undefined values are dropped. */
function orderKeys<T extends object>(
  value: T,
  leading: readonly string[],
  trailing: readonly string[] = [],
): T {
  const source = value as Record<string, unknown>;
  const trailingSet = new Set(trailing);
  const head = leading.filter((key) => !trailingSet.has(key));
  const listed = new Set([...head, ...trailing]);
  const rest = Object.keys(source).filter((key) => !listed.has(key));
  const ordered: Record<string, unknown> = {};
  for (const key of [...head, ...rest, ...trailing]) {
    if (source[key] !== undefined) ordered[key] = source[key];
  }
  return ordered as T;
}

function canonicalStats(stats: StatValues, schema: Schema): StatValues {
  return orderKeys(stats, schema.statKeys);
}

function canonicalDynamicStats(
  configs: DynamicStatConfig[] | undefined,
): DynamicStatConfig[] | undefined {
  return configs?.map((config) => orderKeys(config, DYNAMIC_STAT_KEYS));
}

function canonicalItem(item: Item, schema: Schema): Item {
  const ordered = orderKeys(
    item,
    [...ITEM_LEADING_KEYS, ...schema.statKeys],
    ITEM_TRAILING_KEYS,
  );
  if (ordered.dynamicStats)
    ordered.dynamicStats = canonicalDynamicStats(ordered.dynamicStats);
  return ordered;
}

export function toItemsFile(items: Item[], schema: Schema = NW_SCHEMA): string {
  const canonical = items.map((item) => canonicalItem(item, schema));
  return `${JSON.stringify(canonical, null, 2)}\n`;
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

function canonicalVariant(variant: GrantVariant, schema: Schema): GrantVariant {
  const out = orderKeys(variant, VARIANT_KEYS);
  if (out.stats) out.stats = canonicalStats(out.stats, schema);
  if (out.dynamicStats)
    out.dynamicStats = canonicalDynamicStats(out.dynamicStats);
  return out;
}

function canonicalTier(tier: GrantTier, schema: Schema): GrantTier {
  const out = orderKeys(tier, TIER_KEYS);
  if (out.stats) out.stats = canonicalStats(out.stats, schema);
  return out;
}

function canonicalGrant(grant: Grant, self: string, schema: Schema): Grant {
  const out = orderKeys(grantWithImplicitSelf(grant, self), GRANT_KEYS);
  if (out.stats) out.stats = canonicalStats(out.stats, schema);
  if (out.dynamicStats)
    out.dynamicStats = canonicalDynamicStats(out.dynamicStats);
  if (out.variants)
    out.variants = out.variants.map((variant) =>
      canonicalVariant(variant, schema),
    );
  if (out.tiers)
    out.tiers = out.tiers.map((tier) => canonicalTier(tier, schema));
  if (out.problem) out.problem = orderKeys(out.problem, PROBLEM_KEYS);
  return out;
}

export function toBonusesFile(
  bonuses: Bonus[],
  schema: Schema = NW_SCHEMA,
): string {
  const canonical = bonuses.map((bonus) =>
    orderKeys(
      {
        ...bonus,
        name: bonus.name ?? bonus.id,
        grants: (bonus.grants ?? []).map((grant) =>
          canonicalGrant(grant, bonus.id, schema),
        ),
      },
      BONUS_KEYS,
    ),
  );
  return `${JSON.stringify(canonical, null, 2)}\n`;
}

/** Drops the `section` field `deriveSlots` injects on load. The file implies it by nesting. */
function stripSection<T extends { section?: string }>(value: T) {
  const { section: _section, ...rest } = value;
  return rest;
}

const SECTION_KEYS = [
  "id",
  "label",
  "defaultOpen",
  "presets",
  "slots",
] as const;
const SLOT_KEYS = [
  "id",
  "label",
  "type",
  "text",
  "filter",
  "tags",
  "list",
  "stable",
  "paramType",
  "path",
  "default",
  "options",
  "optionsFrom",
  "allowEmpty",
  "min",
  "max",
  "step",
  "presets",
  "scaler",
  "defaultRows",
  "quick",
  "disallowEmpty",
  "hidePreview",
  "toggleable",
] as const;
const SELECTOR_KEYS = ["filter", "tags"] as const;
const OPTION_KEYS = ["value", "label"] as const;
const SCALER_KEYS = ["mode", "applies"] as const;
const STABLE_KEYS = ["group", "role", "index"] as const;
const PRESET_KEYS = [
  "id",
  "label",
  "params",
  "choices",
  "values",
  "assignments",
  "occurrences",
  "clears",
] as const;
const FILTER_KEYS = ["maxCopies", "fields"] as const;

function canonicalSlot(slot: Slot) {
  const out = orderKeys(slot, SLOT_KEYS);
  if (out.type === "build_parameter") {
    if (out.options)
      out.options = out.options.map((option) => orderKeys(option, OPTION_KEYS));
    if (out.optionsFrom)
      out.optionsFrom = orderKeys(out.optionsFrom, SELECTOR_KEYS);
    if (out.scaler) {
      out.scaler = orderKeys(out.scaler, SCALER_KEYS);
      if (out.scaler.applies)
        out.scaler.applies = orderKeys(out.scaler.applies, SELECTOR_KEYS);
    }
  }
  if (out.type === "item_picker" && out.stable)
    out.stable = orderKeys(out.stable, STABLE_KEYS);
  return stripSection(out);
}

function canonicalPreset(preset: SectionPreset) {
  return stripSection(orderKeys(preset, PRESET_KEYS));
}

/**
 * Regenerates `data/slots.json`, nesting slots and presets under their sections. Order comes
 * from `compose`, so `slotIds` is not written out. A slot whose section is missing is dropped.
 */
export function toSlotsFile(
  sections: SlotSection[],
  slots: Slot[],
  presets: SectionPreset[],
): string {
  const body = {
    sections: sections.map((section) => {
      const sectionPresets = presets
        .filter((preset) => preset.section === section.id)
        .map(canonicalPreset);
      return orderKeys(
        {
          id: section.id,
          label: section.label,
          defaultOpen: section.defaultOpen,
          presets: sectionPresets.length ? sectionPresets : undefined,
          slots: slots
            .filter((slot) => slot.section === section.id)
            .map(canonicalSlot),
        },
        SECTION_KEYS,
      );
    }),
  };
  return `${JSON.stringify(body, null, 2)}\n`;
}

/**
 * Regenerates `data/filters.json`, keyed and sorted by id in code-unit order, matching how
 * `data.ts` reads it. Each filter's `fields` are sorted the same way.
 */
export function toFiltersFile(filters: FilterDef[]): string {
  const byId = new Map(filters.map((filter) => [filter.id, filter]));
  const body: Record<string, Omit<FilterDef, "id">> = {};
  for (const id of [...byId.keys()].sort()) {
    const { id: _id, ...filter } = byId.get(id)!;
    body[id] = orderKeys(
      { ...filter, fields: filter.fields && [...filter.fields].sort() },
      FILTER_KEYS,
    );
  }
  return `${JSON.stringify(body, null, 2)}\n`;
}
