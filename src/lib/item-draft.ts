// The draft <-> item conversion for ItemForm.vue, split out the same way BonusForm's own
// draft mapping already lived in bonus-draft.ts (see that module's header comment): that
// pattern carried to Item. `ItemForm.vue` keeps the markup, field-group gating and Vue wiring;
// everything about what a draft looks like and how it reads/writes an `Item` lives here, where
// it is unit-testable and Vue-free.
import { NW_SCHEMA } from "../data/data";
import { replacementIdOf, replacementValuesOf } from "./item-replacement";
import { isPlainOccurrence } from "./occurrence-mode";
import {
  entriesToRows,
  rowsToEntries,
  putIfSet,
  hasValue,
  numberOrUnset,
  fieldDiffLabel,
  arrayDiffLabel,
  statDiffLabel,
  dynamicStatsDiffLabel,
  type DiffCheck,
} from "./draft-fields";
import {
  dynamicStatRows,
  rowsToDynamicStats,
  type StatRow,
  type DynamicStatDraft,
} from "./bonus-draft";
import type {
  Item,
  BonusOccurrenceConfig,
  ItemReplacement,
  StatValues,
} from "../types";

export type { StatRow, DynamicStatDraft };

/** One attached bonus's editable occurrence bounds: mirrors `BonusOccurrenceConfig`'s own
 *  `min`/`max`/`default`, just widened to `number | string | null` like every other numeric
 *  draft field so a cleared input reads as empty rather than `0`. `label` mirrors the config's
 *  own optional field directly (always a string here; "" reads as unset, same as
 *  `DynamicStatDraft.label`). */
export interface OccurrenceDraft {
  min: number | string | null;
  max: number | string | null;
  default: number | string | null;
  label: string;
}

export interface ItemDraft {
  name: string;
  filter: string;
  shortDescription: string;
  longDescription: string;
  maxCopies: number | string | null;
  /** Both halves optional and independent; see `Item.hideFromPicker` / `Item.replacedBy`. */
  hideFromPicker: boolean;
  replacedBy: string;
  /** `ItemReplacement.values` as rows; empty writes the bare-id form back out. */
  replacedByValues: { stat: string; value: number | string | null }[];
  allowedClass: string[];
  tags: string[];
  gameIds: string[];
  bonuses: string[];
  /** Present only for a bonus id upgraded to a `BonusOccurrenceConfig`; absence means a
   *  plain-id attachment (always 1 occurrence), same "optional fields" convention
   *  `DynamicStatDraft` uses. Keyed by bonus id, not array index, since it tracks
   *  `draft.bonuses` entries by identity. */
  bonusOccurrences: Record<string, OccurrenceDraft>;
  dynamicStats: DynamicStatDraft[];
  repetitionMin: number | string | null;
  repetitionMax: number | string | null;
  repetitionDefault: number | string | null;
  repetitionPriority: number | string | null;
  repetitionLabel: string;
  stats: StatRow[];
  defaultParams: { slotId: string; value: string | number | boolean }[];
  /** Keyed by context *path*, not slot id: a published value has no slot (see
   *  `Item.publishes`), which is the whole reason it can replace one. */
  publishes: { path: string; value: string }[];
  /** An empty `shape` means universal, so one picker cannot contradict a separate checkbox. */
  insigniaSlots: { shape: string; preferred: string }[];
  insigniaShape: string;
  preferredVariant: string;
  /** A bonus recipe as three or four shapes; empty rows are dropped on save. */
  insigniaRecipe: string[];
}

/** Inline-repetition numeric fields count as "set" once they hold a real number, not just an
 *  empty string left behind by a cleared number input: `draft-fields.ts`'s `hasValue` under
 *  the name this form's fields are usually discussed by. */
export const hasRepetitionField = hasValue;

export function hasDescription(d: ItemDraft): boolean {
  return d.shortDescription !== "" || d.longDescription !== "";
}

export function hasInlineRepetition(d: ItemDraft): boolean {
  return (
    hasRepetitionField(d.repetitionMin) ||
    hasRepetitionField(d.repetitionMax) ||
    hasRepetitionField(d.repetitionDefault) ||
    hasRepetitionField(d.repetitionPriority)
  );
}

export function buildDraft(item: Item | null | undefined): ItemDraft {
  const source = item ?? ({} as Partial<Item>);
  const bonuses: string[] = [];
  const bonusOccurrences: Record<string, OccurrenceDraft> = {};
  for (const entry of source.bonuses ?? []) {
    if (typeof entry === "string") {
      bonuses.push(entry);
    } else {
      bonuses.push(entry.bonus);
      bonusOccurrences[entry.bonus] = {
        min: entry.min,
        max: entry.max,
        default: entry.default,
        label: entry.label ?? "",
      };
    }
  }
  return {
    name: source.name ?? "",
    filter: source.filter ?? "",
    shortDescription: source.shortDescription ?? "",
    longDescription: source.longDescription ?? "",
    maxCopies: source.maxCopies ?? null,
    hideFromPicker: source.hideFromPicker ?? false,
    replacedBy: source.replacedBy ? replacementIdOf(source.replacedBy) : "",
    replacedByValues: entriesToRows(
      source.replacedBy ? replacementValuesOf(source.replacedBy) : {},
      (stat, value) => ({ stat, value: value ?? null }),
    ),
    allowedClass: [...(source.allowedClass ?? [])],
    tags: [...(source.tags ?? [])],
    gameIds: [...(source.gameIds ?? [])],
    bonuses,
    bonusOccurrences,
    dynamicStats: dynamicStatRows(source.dynamicStats),
    repetitionMin: source.inlineRepetition?.min ?? null,
    repetitionMax: source.inlineRepetition?.max ?? null,
    repetitionDefault: source.inlineRepetition?.default ?? null,
    repetitionPriority: source.inlineRepetition?.priority ?? null,
    repetitionLabel: source.inlineRepetition?.label ?? "",
    stats: itemStatRows(source),
    publishes: entriesToRows(source.publishes, (path, value) => ({
      path,
      value: String(value),
    })),
    defaultParams: Object.entries(source.defaultParams ?? {}).flatMap(
      ([slotId, value]) => (value === undefined ? [] : [{ slotId, value }]),
    ),
    insigniaSlots: (source.insigniaSlots ?? []).map((spec) => ({
      shape: spec.universal ? "" : (spec.shape ?? ""),
      preferred: spec.preferred ?? "",
    })),
    insigniaShape: source.insigniaShape ?? "",
    preferredVariant: source.preferredVariant ?? "",
    insigniaRecipe: [...(source.insigniaRecipe ?? [])],
  };
}

/** Resolved item id: the source's own when editing, otherwise whatever the form's `computeId`
 *  worked out from the draft's name. Threaded in rather than computed here, since it depends on
 *  `allocatableIds`/`db.items`, both reactive props `toItem` has no business reading. */
export interface ItemDraftContext {
  id: string;
}

export function toItem(local: ItemDraft, ctx: ItemDraftContext): Item {
  const item: Item = {
    id: ctx.id,
    name: local.name.trim(),
    filter: local.filter.trim(),
  };

  putIfSet(item, "shortDescription", local.shortDescription.trim());
  putIfSet(item, "longDescription", local.longDescription.trim());

  for (const { key, value } of local.stats) {
    if (!key) continue;
    const number = Number(value);
    if (value === "" || value == null || !Number.isFinite(number)) continue;
    item[key] = number;
  }

  putIfSet(item, "tags", [...local.tags]);
  putIfSet(item, "gameIds", [...local.gameIds]);
  if (local.bonuses.length) {
    const bonuses: (string | BonusOccurrenceConfig)[] = local.bonuses.map(
      (id) => {
        const occurrence = local.bonusOccurrences[id];
        if (!occurrence || isPlainOccurrence(occurrence)) return id;
        const config: BonusOccurrenceConfig = {
          bonus: id,
          min: Number(occurrence.min) || 0,
          max: Number(occurrence.max) || 0,
          default: Number(occurrence.default) || 0,
        };
        putIfSet(config, "label", occurrence.label.trim());
        return config;
      },
    );
    item.bonuses = bonuses;
  }
  // A typed 0 is a deliberate "unlimited even so", so `numberOrUnset` (emptiness, not
  // truthiness) is what decides whether this is written at all.
  putIfSet(item, "maxCopies", numberOrUnset(local.maxCopies));
  if (local.hideFromPicker) item.hideFromPicker = true;
  if (local.replacedBy.trim()) {
    const target = local.replacedBy.trim();
    // Bare string unless a seed is set, so the simple case stays simple in the JSON.
    const values: StatValues = rowsToEntries(
      local.replacedByValues,
      (row) => row.stat,
      (row) =>
        row.value === null || row.value === "" ? undefined : Number(row.value),
    );
    item.replacedBy = Object.keys(values).length
      ? { item: target, values }
      : target;
  }
  putIfSet(item, "allowedClass", [...local.allowedClass]);

  // Every row is a slot: an empty shape means universal, so there is no blank row to discard.
  const insigniaSlots = local.insigniaSlots.map((row) =>
    row.shape
      ? { shape: row.shape }
      : {
          universal: true as const,
          ...(row.preferred ? { preferred: row.preferred } : {}),
        },
  );
  putIfSet(item, "insigniaSlots", insigniaSlots);
  putIfSet(item, "insigniaShape", local.insigniaShape);
  putIfSet(item, "preferredVariant", local.preferredVariant.trim());
  putIfSet(item, "insigniaRecipe", local.insigniaRecipe.filter(Boolean));

  putIfSet(item, "dynamicStats", rowsToDynamicStats(local.dynamicStats));

  if (
    hasRepetitionField(local.repetitionMin) ||
    hasRepetitionField(local.repetitionMax) ||
    hasRepetitionField(local.repetitionDefault)
  ) {
    item.inlineRepetition = {
      min: Number(local.repetitionMin) || 0,
      max: Number(local.repetitionMax) || 0,
      default: Number(local.repetitionDefault) || 0,
    };
    putIfSet(
      item.inlineRepetition,
      "priority",
      numberOrUnset(local.repetitionPriority),
    );
    putIfSet(item.inlineRepetition, "label", local.repetitionLabel.trim());
  }

  putIfSet(
    item,
    "publishes",
    rowsToEntries(
      local.publishes,
      (row) => row.path.trim(),
      (row) => row.value,
    ),
  );
  putIfSet(
    item,
    "defaultParams",
    rowsToEntries(
      local.defaultParams,
      (row) => row.slotId,
      (row) => row.value,
    ),
  );

  return item;
}

/** An item's flat stat keys as `StatRow`s: unlike every other field, a stat has no property of
 *  its own on `Item` (`item[key] = number`, not `item.stats = [...]`), so both `buildDraft` and
 *  the `diffLabel` stats check below read the same top-level-key scan instead of a plain field
 *  access. */
function itemStatRows(item: Partial<Item>): StatRow[] {
  const statKeys = new Set(NW_SCHEMA.statKeys);
  return Object.keys(item)
    .filter((key) => statKeys.has(key))
    .map((key) => ({ key, value: item[key as keyof Item] as number }));
}

/** A draft's `replacedBy` in the shape `Item` stores, for `diffLabel` below. */
function replacementOf(value: unknown): ItemReplacement | null {
  if (!value) return null;
  return typeof value === "string"
    ? { item: value }
    : (value as ItemReplacement);
}

/** A saved item's `bonuses` entries mix plain ids and `BonusOccurrenceConfig` objects; split
 *  that into "which bonuses are attached" (id order/membership) and "which attached ones carry
 *  an occurrence config" so attach/detach and occurrence edits get distinct, readable diff
 *  labels instead of one opaque "edit bonuses". */
function bonusIdsOf(entries: unknown): string[] {
  return Array.isArray(entries)
    ? entries.map((e) =>
        typeof e === "string" ? e : (e as { bonus: string }).bonus,
      )
    : [];
}
function occurrenceConfigsOf(entries: unknown): Record<string, unknown> {
  const configs: Record<string, unknown> = {};
  if (Array.isArray(entries)) {
    for (const e of entries) {
      if (typeof e !== "string") configs[(e as { bonus: string }).bonus] = e;
    }
  }
  return configs;
}

/** Labels an occurrence-config change with the specific bonus id it touched, same spirit as
 *  `arrayDiffLabel`: "edit occurrence config" alone wouldn't say which of an item's several
 *  attachments changed. */
function diffOccurrenceLabel(
  oldConfigs: Record<string, unknown>,
  nwConfigs: Record<string, unknown>,
): string {
  const oldKeys = new Set(Object.keys(oldConfigs));
  const nwKeys = new Set(Object.keys(nwConfigs));
  const added = [...nwKeys].filter((id) => !oldKeys.has(id));
  const removed = [...oldKeys].filter((id) => !nwKeys.has(id));
  if (added.length) return `add occurrence config for "${added[0]}"`;
  if (removed.length) return `remove occurrence config for "${removed[0]}"`;
  const changed = [...nwKeys].find(
    (id) => JSON.stringify(oldConfigs[id]) !== JSON.stringify(nwConfigs[id]),
  );
  return changed
    ? `edit occurrence config for "${changed}"`
    : "edit occurrence config";
}

const CHECKS: DiffCheck<Item>[] = [
  (old, nw) => (old.name !== nw.name ? `edit name → "${nw.name}"` : null),
  (old, nw) =>
    old.filter !== nw.filter ? `edit filter → "${nw.filter}"` : null,
  (old, nw) =>
    old.shortDescription !== nw.shortDescription
      ? "edit short description"
      : null,
  (old, nw) =>
    old.longDescription !== nw.longDescription ? "edit long description" : null,
  (old, nw) =>
    old.maxCopies !== nw.maxCopies
      ? `edit max copies → ${nw.maxCopies ?? "(none)"}`
      : null,
  (old, nw) =>
    old.hideFromPicker !== nw.hideFromPicker
      ? nw.hideFromPicker
        ? "hide from pickers"
        : "offer in pickers again"
      : null,
  (old, nw) =>
    JSON.stringify(replacementOf(old.replacedBy)) !==
    JSON.stringify(replacementOf(nw.replacedBy))
      ? `edit replaced by → ${replacementOf(nw.replacedBy)?.item ?? "(none)"}`
      : null,
  (old, nw) =>
    JSON.stringify(old.allowedClass) !== JSON.stringify(nw.allowedClass)
      ? "edit classes"
      : null,
  (old, nw) =>
    JSON.stringify(old.tags) !== JSON.stringify(nw.tags)
      ? arrayDiffLabel("tag", old.tags ?? [], nw.tags ?? [])
      : null,
  (old, nw) =>
    JSON.stringify(old.gameIds) !== JSON.stringify(nw.gameIds)
      ? arrayDiffLabel("game id", old.gameIds ?? [], nw.gameIds ?? [])
      : null,
  (old, nw) =>
    JSON.stringify(bonusIdsOf(old.bonuses)) !==
    JSON.stringify(bonusIdsOf(nw.bonuses))
      ? arrayDiffLabel("bonus", bonusIdsOf(old.bonuses), bonusIdsOf(nw.bonuses))
      : null,
  (old, nw) => {
    const oldConfigs = occurrenceConfigsOf(old.bonuses);
    const nwConfigs = occurrenceConfigsOf(nw.bonuses);
    return JSON.stringify(oldConfigs) !== JSON.stringify(nwConfigs)
      ? diffOccurrenceLabel(oldConfigs, nwConfigs)
      : null;
  },
  (old, nw) =>
    JSON.stringify(old.dynamicStats) !== JSON.stringify(nw.dynamicStats)
      ? dynamicStatsDiffLabel(old.dynamicStats ?? [], nw.dynamicStats ?? [])
      : null,
  (old, nw) =>
    JSON.stringify(old.inlineRepetition) !== JSON.stringify(nw.inlineRepetition)
      ? "edit inline repetition"
      : null,
  (old, nw) => {
    const oldStats = itemStatRows(old);
    const nwStats = itemStatRows(nw);
    return JSON.stringify(oldStats) !== JSON.stringify(nwStats)
      ? statDiffLabel(oldStats, nwStats)
      : null;
  },
  (old, nw) =>
    JSON.stringify(old.publishes) !== JSON.stringify(nw.publishes)
      ? "edit published values"
      : null,
  (old, nw) =>
    JSON.stringify(old.defaultParams) !== JSON.stringify(nw.defaultParams)
      ? "edit default build parameters"
      : null,
];

export function diffLabel(oldJson: string, newJson: string): string {
  return fieldDiffLabel(CHECKS, oldJson, newJson, "edit item");
}

// --- which field groups this item is offered ---------------------------------------------
// `filterFields` in data/slots.json says which fields each filter is authored with, so a layer
// can declare its own item category with no code edit. This table says which item fields each
// optional template group edits; whether to show one stays in ItemForm.vue, since that depends
// on reactive props/draft state (`showsGroup`/`carriesField`).

/** Every optional group in ItemForm.vue's template, in the order it draws them, by the item
 *  fields it edits. */
export const FIELD_GROUPS = {
  tags: ["tags"],
  gameIds: ["gameIds"],
  description: ["shortDescription", "longDescription"],
  allowedClass: ["allowedClass"],
  inlineRepetition: ["inlineRepetition"],
  insignia: ["insigniaShape", "preferredVariant"],
  insigniaSlots: ["insigniaSlots"],
  insigniaRecipe: ["insigniaRecipe"],
  dynamicStats: ["dynamicStats"],
  bonuses: ["bonuses"],
  defaultParams: ["defaultParams"],
  publishes: ["publishes"],
  retirement: ["hideFromPicker", "replacedBy"],
} as const;

export type FieldGroup = keyof typeof FIELD_GROUPS;
