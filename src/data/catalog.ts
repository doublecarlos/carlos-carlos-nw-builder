// The item/bonus catalogue as composable layers.
//
// Until now the catalogue was fixed: `db.fromGlobals()` read `NW_ITEMS` / `NW_BONUSES` once and
// nothing could change it. The editor needs to change it, and custom gear saved *with a build*
// will need to change it per build -- so the catalogue is now a base plus an ordered list of
// overlays, folded together on demand.
//
//     effective = base  <-  workspace overlay  <-  (future) build overlay
//
// An overlay is `{ items: { [id]: item|null }, bonuses: { [id]: bonus|null } }`, where the
// value replaces whatever the layers below it had and `null` is a tombstone hiding a base
// entry. That single shape covers add, edit and delete, survives JSON, and composes -- which
// is what makes the per-build case a matter of passing one more overlay rather than a redesign.
//
// Nothing here touches the DOM or the engine. `makeDb` hands the composed arrays to the
// existing `db.build`, so the engine cannot tell the difference.

import { NW_ITEMS, NW_BONUSES, NW_SCHEMA, NW_SLOTS } from "./data";
import * as db from "./db";
import { findParamSlot, resolveLinkedItem } from "../lib/build-path";
import { deepEqual } from "../lib/deep-equal";
import { bonusIdOf } from "../lib/bonus-attachment";
import type {
  Item,
  Bonus,
  Schema,
  CatalogOverlay,
  CatalogGroup,
  ConditionWhen,
  ParamCondition,
  LintFinding,
  Slot,
  SectionPreset,
  BuildParameterSlot,
  ItemPickerSlot,
  Db,
  Build,
} from "../types";

export const emptyOverlay = (): CatalogOverlay => ({
  items: {},
  bonuses: {},
  sectionPresets: {},
});

export const isEmpty = (overlay: CatalogOverlay | null | undefined) =>
  !overlay ||
  (Object.keys(overlay.items ?? {}).length === 0 &&
    Object.keys(overlay.bonuses ?? {}).length === 0 &&
    Object.keys(overlay.sectionPresets ?? {}).length === 0);

/** Anything persisted or pasted has to survive being wrong. */
export function normaliseOverlay(raw: unknown): CatalogOverlay {
  const overlay = emptyOverlay();
  if (!raw || typeof raw !== "object") return overlay;
  for (const group of ["items", "bonuses", "sectionPresets"] as const) {
    const source = (raw as Record<string, unknown>)[group];
    if (!source || typeof source !== "object") continue;
    for (const [key, value] of Object.entries(source)) {
      if (value === null)
        overlay[group][key] = null; // tombstone
      else if (value && typeof value === "object")
        overlay[group][key] = value as Item & Bonus & SectionPreset;
    }
  }
  return overlay;
}

export const base = (): {
  items: Item[];
  bonuses: Bonus[];
  sectionPresets: SectionPreset[];
} => ({
  items: NW_ITEMS ?? [],
  bonuses: NW_BONUSES ?? [],
  sectionPresets: NW_SLOTS.presets ?? [],
});

/**
 * Fold overlays over the base, later layers winning. Output is sorted by id so the
 * export is stable and diffs against the generated files stay readable.
 */
export function compose(overlays: (CatalogOverlay | null | undefined)[] = []) {
  const {
    items: baseItems,
    bonuses: baseBonuses,
    sectionPresets: basePresets,
  } = base();

  const items = new Map(baseItems.map((item) => [item.id, item]));
  const bonuses = new Map(baseBonuses.map((bonus) => [bonus.id, bonus]));
  const sectionPresets = new Map(
    basePresets.map((preset) => [preset.id, preset]),
  );

  for (const overlay of overlays) {
    if (!overlay) continue;
    for (const [id, item] of Object.entries(overlay.items ?? {})) {
      if (item === null) items.delete(id);
      else items.set(id, item);
    }
    for (const [id, bonus] of Object.entries(overlay.bonuses ?? {})) {
      if (bonus === null) bonuses.delete(id);
      else bonuses.set(id, bonus);
    }
    for (const [id, preset] of Object.entries(overlay.sectionPresets ?? {})) {
      if (preset === null) sectionPresets.delete(id);
      else sectionPresets.set(id, preset);
    }
  }

  return {
    items: [...items.values()].sort((a, b) => a.id.localeCompare(b.id)),
    bonuses: [...bonuses.values()].sort((a, b) => a.id.localeCompare(b.id)),
    sectionPresets: [...sectionPresets.values()].sort((a, b) =>
      a.id.localeCompare(b.id),
    ),
  };
}

/** A db the engine accepts, built from the composed catalogue. */
export function makeDb(overlays: (CatalogOverlay | null | undefined)[] = []) {
  const { items, bonuses, sectionPresets } = compose(overlays);
  return db.build(items, bonuses, NW_SCHEMA, {
    ...NW_SLOTS,
    presets: sectionPresets,
  });
}

// --- editing (pure: every helper returns a new overlay) ---------------------------------

const clone = (overlay: CatalogOverlay): CatalogOverlay => ({
  items: { ...overlay.items },
  bonuses: { ...overlay.bonuses },
  sectionPresets: { ...overlay.sectionPresets },
});

const inBase = (group: CatalogGroup, key: string) => {
  const catalogueBase = base();
  if (group === "items")
    return catalogueBase.items.some((item) => item.id === key);
  if (group === "bonuses")
    return catalogueBase.bonuses.some((bonus) => bonus.id === key);
  return catalogueBase.sectionPresets.some((preset) => preset.id === key);
};

/** Save an entry under its id. Ids are frozen at creation (`nextId`, below) and never
 * user-edited afterwards, so the key an entry is saved under never changes across its
 * lifetime. */
export function upsert(
  overlay: CatalogOverlay,
  group: CatalogGroup,
  key: string,
  value: Item | Bonus | SectionPreset,
) {
  const next = clone(overlay);
  (next[group] as Record<string, Item | Bonus | SectionPreset | null>)[key] =
    value;
  return next;
}

const slugify = (text: string) =>
  String(text)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/**
 * A stable id for a brand-new item or bonus, derived from its name at the moment of first
 * save and never regenerated afterwards -- see `Item.id`'s own comment on why. Disambiguates
 * against `existingIds` (every id already in use) by appending `-2`, `-3`, ... so two entries
 * whose names happen to slugify the same still get distinct ids with no user action needed.
 */
export function nextId(
  name: string,
  existingIds: string[],
  fallback = "item",
): string {
  const base = slugify(name) || fallback;
  const taken = new Set(existingIds);
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

/** Hide a base entry, or drop an added one outright. */
export function remove(
  overlay: CatalogOverlay,
  group: CatalogGroup,
  key: string,
) {
  const next = clone(overlay);
  if (inBase(group, key)) next[group][key] = null;
  else delete next[group][key];
  return next;
}

/** Forget an override so the base entry shows through again. */
export function revert(
  overlay: CatalogOverlay,
  group: CatalogGroup,
  key: string,
) {
  const next = clone(overlay);
  delete next[group][key];
  return next;
}

/** How an entry differs from what shipped -- drives the badges in the editor list. */
export function statusOf(
  overlay: CatalogOverlay | null | undefined,
  group: CatalogGroup,
  key: string,
) {
  const override = overlay?.[group]?.[key];
  const shipped = inBase(group, key);
  if (override === null) return "removed";
  if (override === undefined) return shipped ? "base" : "base";
  return shipped ? "edited" : "added";
}

// --- portable files (phase 7) -------------------------------------------------------------

/** Everything in the composed catalogue this build depends on that base does not already
 *  provide — what a download has to carry to resolve identically elsewhere. */
export function referencedOverlay(db: Db, build: Build): CatalogOverlay {
  const itemIds = new Set<string>();
  const bonusIds = new Set<string>();

  // Seed items from choices
  for (const id of Object.values(build.choices)) {
    if (id && id !== "-" && id !== "") itemIds.add(id);
  }

  // Seed items from build_parameter slots' linkedItem -- the item a list/boolean param
  // currently resolves to is just as much "part of the build" as a picked one, so a download
  // needs to carry it too if it's not already in base.
  for (const slot of db.slots) {
    if (slot.type !== "build_parameter") continue;
    const id = resolveLinkedItem(slot, build.context);
    if (id) itemIds.add(id);
  }

  // Resolve items to find referenced bonus ids
  const visitedItems = new Set<string>();
  const stack = [...itemIds];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (visitedItems.has(id)) continue;
    visitedItems.add(id);
    const item = db.get(id);
    if (!item) continue;
    for (const attachment of item.bonuses ?? [])
      bonusIds.add(bonusIdOf(attachment));
    for (const bonusId of item.excludes ?? []) bonusIds.add(bonusId);
  }

  // Follow bonus excludes transitively — bonuses can chain through excludes
  const visitedBonuses = new Set<string>();
  const bonusStack = [...bonusIds];
  while (bonusStack.length > 0) {
    const id = bonusStack.pop()!;
    if (visitedBonuses.has(id)) continue;
    visitedBonuses.add(id);
    const bonus = db.bonusById.get(id);
    if (!bonus) continue;
    for (const exId of bonus.excludes ?? []) {
      if (!visitedBonuses.has(exId)) bonusStack.push(exId);
    }
  }

  // Build reference maps for base catalogue
  const baseItems = new Map(base().items.map((i) => [i.id, i]));
  const baseBonuses = new Map(base().bonuses.map((b) => [b.id, b]));

  const overlay = emptyOverlay();

  // Emit only items absent from base or not deep-equal to their base counterpart
  for (const id of itemIds) {
    const item = db.get(id);
    if (!item) continue;
    const baseItem = baseItems.get(id);
    if (!baseItem || !deepEqual(item, baseItem)) {
      overlay.items[id] = item;
    }
  }

  // Emit only bonuses absent from base or not deep-equal to their base counterpart
  for (const id of visitedBonuses) {
    const bonus = db.bonusById.get(id);
    if (!bonus) continue;
    const baseBonus = baseBonuses.get(id);
    if (!baseBonus || !deepEqual(bonus, baseBonus)) {
      overlay.bonuses[id] = bonus;
    }
  }

  return overlay;
}

export { inBase };

// --- validation --------------------------------------------------------------------------

const CONDITION_KEYS = new Set([
  "toggle",
  "role",
  "class",
  "damageType",
  "duration",
  "enemies",
  "bonusOccurrences",
  "equipped",
  "param",
  "all",
  "any",
  "not",
]);

// Every non-stat key an item may legitimately carry. Anything else is a typo, and a
// misspelled stat (`sevrity: 5000`) is invisible otherwise -- it simply never applies.
const ITEM_FIELDS = new Set([
  "id",
  "name",
  "filter",
  "tags",
  "maxCopies",
  "allowedClass",
  "dynamicStats",
  "inlineRepetition",
  "bonuses",
  "excludes",
  "shortDescription",
  "longDescription",
  "gameIds",
  "defaultParams",
]);

// A `param` condition addressing one of these paths duplicates a dedicated leaf that already
// exists for it -- not wrong (conditions.ts happily evaluates either), but worth steering
// authors toward the leaf that reads better and is what every shipped bonus already uses.
const DEDICATED_LEAF_FOR_PATH: Record<string, string> = {
  role: "role",
  class: "class",
  damageType: "damageType",
  duration: "duration",
  enemies: "enemies",
};

function checkParamCondition(
  spec: ParamCondition | undefined,
  path: string,
  report: (level: "error" | "warn", message: string) => void,
  paramSlots: Map<string, BuildParameterSlot>,
) {
  if (!spec || typeof spec !== "object" || !spec.key) {
    report("error", `${path}: param condition has no "key"`);
    return;
  }

  const dedicated =
    DEDICATED_LEAF_FOR_PATH[spec.key] ??
    (spec.key.startsWith("toggles.") ? "toggle" : null);
  if (dedicated) {
    report(
      "warn",
      `${path}: param "${spec.key}" has a dedicated "${dedicated}" condition -- prefer that`,
    );
  }

  const slot = paramSlots.get(spec.key);
  if (!slot) {
    // conditions.ts's param leaf fails closed on an unresolvable key, same as an unknown
    // condition key -- the bonus would silently never apply.
    report(
      "error",
      `${path}: param "${spec.key}" is not a build_parameter's path — the condition can never be active`,
    );
    return;
  }

  const numeric = slot.paramType === "number" || slot.paramType === "percent";
  if (
    numeric &&
    spec.atLeast === undefined &&
    spec.below === undefined &&
    spec.exactly === undefined
  ) {
    report(
      "error",
      `${path}: param "${spec.key}" is a number — use atLeast/below/exactly`,
    );
  } else if (slot.paramType === "boolean" && spec.is === undefined) {
    report("error", `${path}: param "${spec.key}" is a boolean — use "is"`);
  } else if (slot.paramType === "list" && spec.equals === undefined) {
    report("error", `${path}: param "${spec.key}" is a list — use "equals"`);
  }

  if (slot.paramType === "list" && spec.equals !== undefined) {
    const allowed = new Set((slot.options ?? []).map((o) => o.value));
    for (const value of Array.isArray(spec.equals)
      ? spec.equals
      : [spec.equals]) {
      if (!allowed.has(value)) {
        report(
          "error",
          `${path}: param "${spec.key}" equals "${value}", which is not one of its declared options`,
        );
      }
    }
  }
}

function checkConditions(
  when: ConditionWhen | undefined,
  path: string,
  report: (level: "error" | "warn", message: string) => void,
  paramSlots: Map<string, BuildParameterSlot>,
) {
  if (!when || typeof when !== "object") return;
  for (const [key, spec] of Object.entries(when)) {
    if (!CONDITION_KEYS.has(key)) {
      // conditions.ts fails closed on an unknown key, so this would silently never apply.
      report(
        "error",
        `${path}: unknown condition "${key}" — the bonus can never be active`,
      );
      continue;
    }
    if (key === "all" || key === "any") {
      if (Array.isArray(spec))
        spec.forEach((sub) => checkConditions(sub, path, report, paramSlots));
      else report("error", `${path}: "${key}" must be a list`);
    } else if (key === "not") {
      checkConditions(spec as ConditionWhen, path, report, paramSlots);
    } else if (key === "param") {
      checkParamCondition(spec as ParamCondition, path, report, paramSlots);
    }
  }
}

// BuildContext's own field names (types.ts). A path colliding with one of these would corrupt
// engine state on write: a bare "forte"/"toggles" replaces the whole object, and a path nested
// under a scalar field ("class.tier") overwrites that scalar with an object.
const CONTEXT_SCALAR_KEYS = new Set([
  "class",
  "role",
  "damageType",
  "duration",
  "enemies",
  "magnitude",
  "m32Forte",
]);
const CONTEXT_CONTAINER_KEYS = new Set(["forte", "toggles"]);

function shadowsBuildContext(path: string): boolean {
  const [head, ...rest] = path.split(".");
  return rest.length === 0
    ? CONTEXT_CONTAINER_KEYS.has(head)
    : CONTEXT_SCALAR_KEYS.has(head);
}

/**
 * Lint every `build_parameter` slot's `path` (empty, duplicated -- two slots silently fighting
 * over one value -- or shadowing a `BuildContext` field outright), every `point_assignment`
 * slot's `filter`, and every `item_picker` slot's `filter`/`tags` selector. Standalone from
 * `validate()` below since it needs only the slot list, not a composed catalogue.
 */
export function validateSlots(slots: Slot[]): LintFinding[] {
  const findings: LintFinding[] = [];
  const seenPaths = new Map<string, string>();
  for (const slot of slots) {
    if (slot.type === "point_assignment") {
      if (!slot.filter) {
        findings.push({
          level: "error",
          kind: "item",
          message: `${slot.id}: point_assignment slot has no filter`,
        });
      }
      continue;
    }
    if (slot.type === "item_picker") {
      const hasFilter = !!slot.filter;
      const hasTags = !!slot.tags?.length;
      if (!hasFilter && !hasTags) {
        findings.push({
          level: "error",
          kind: "item",
          message: `${slot.id}: item_picker slot has neither a filter nor tags`,
        });
      } else if (hasFilter && hasTags) {
        findings.push({
          level: "error",
          kind: "item",
          message: `${slot.id}: item_picker slot has both a filter and tags -- pick one, resolving both is ambiguous`,
        });
      }
      continue;
    }
    if (slot.type !== "build_parameter") continue;
    if (!slot.path) {
      findings.push({
        level: "error",
        message: `${slot.id}: build_parameter slot has no path`,
        kind: "item",
      });
      continue;
    }
    const owner = seenPaths.get(slot.path);
    if (owner) {
      findings.push({
        level: "error",
        kind: "item",
        message: `${slot.id}: path "${slot.path}" duplicates ${owner}'s -- they would silently share one value`,
      });
    } else {
      seenPaths.set(slot.path, slot.id);
    }
    if (shadowsBuildContext(slot.path)) {
      findings.push({
        level: "error",
        kind: "item",
        message: `${slot.id}: path "${slot.path}" shadows a BuildContext field`,
      });
    }
  }
  return findings;
}

// A preset field's declared slot type -- `validatePresets`' own check that e.g. `choices`
// only ever references an `item_picker` slot, not a `build_parameter` one wearing the wrong
// hat and silently doing nothing when applied.
const PRESET_FIELD_SLOT_TYPE = {
  params: "build_parameter",
  choices: "item_picker",
  values: "item_picker",
  assignments: "point_assignment",
} as const;

/**
 * Lint every `SectionPreset`: a duplicate id, a reference to a slot id that doesn't exist, a
 * reference that exists but belongs to a different section (a preset can only touch its own
 * section), or a reference whose slot type doesn't match the field it was declared under (e.g.
 * an `item_picker` slot id under `assignments`). Standalone from `validate()` below, same as
 * `validateSlots`, since it needs only the slot/preset lists, not a composed catalogue.
 */
export function validatePresets(
  presets: SectionPreset[],
  slots: Slot[],
): LintFinding[] {
  const findings: LintFinding[] = [];
  const slotById = new Map(slots.map((slot) => [slot.id, slot]));
  const seenIds = new Set<string>();

  for (const preset of presets) {
    if (!preset.id) {
      findings.push({
        level: "error",
        kind: "sectionPreset",
        message: `a preset in section "${preset.section}" has no id`,
      });
    } else if (seenIds.has(preset.id)) {
      findings.push({
        level: "error",
        kind: "sectionPreset",
        name: preset.id,
        message: `preset "${preset.id}" is defined more than once`,
      });
    } else {
      seenIds.add(preset.id);
    }

    for (const [field, expectedType] of Object.entries(
      PRESET_FIELD_SLOT_TYPE,
    )) {
      for (const slotId of Object.keys(
        preset[field as keyof typeof PRESET_FIELD_SLOT_TYPE] ?? {},
      )) {
        const slot = slotById.get(slotId);
        if (!slot) {
          findings.push({
            level: "error",
            kind: "sectionPreset",
            name: preset.id,
            message: `preset "${preset.id}": "${slotId}" (in ${field}) is not a known slot`,
          });
        } else if (slot.type !== expectedType) {
          findings.push({
            level: "error",
            kind: "sectionPreset",
            name: preset.id,
            message: `preset "${preset.id}": "${slotId}" is a ${slot.type} slot, but ${field} only applies to a ${expectedType} slot`,
          });
        } else if (slot.section !== preset.section) {
          findings.push({
            level: "error",
            kind: "sectionPreset",
            name: preset.id,
            message: `preset "${preset.id}" (section "${preset.section}"): "${slotId}" belongs to section "${slot.section}"`,
          });
        }
      }
    }
  }
  return findings;
}

/** Every item id a `build_parameter` slot "equips" through its `linkedItem` -- a list option's
 * or a checked boolean's own. Standalone from `validate()` below, same as `validateSlots`/
 * `validatePresets`, since `validate()` uses it only to exempt these items from the "no
 * filter" checks (such an item is never meant to appear in an item_picker/point_assignment
 * row, so it has no filter to match one). */
export function collectLinkedItemIds(slots: Slot[]): Set<string> {
  const linkedItemIds = new Set<string>();
  for (const slot of slots) {
    if (slot.type !== "build_parameter") continue;
    if (slot.paramType === "list") {
      for (const option of slot.options ?? []) {
        if (option.linkedItem) linkedItemIds.add(option.linkedItem);
      }
    } else if (slot.linkedItem) {
      linkedItemIds.add(slot.linkedItem);
    }
  }
  return linkedItemIds;
}

/**
 * Lint every `build_parameter` slot's `linkedItem`: a reference to an item id with no
 * definition, or one set on a slot type (`number`/`percent`) that can never resolve one.
 * Standalone from `validate()` below, same as `validateSlots`/`validatePresets`, since it
 * needs only the slot list and the catalogue's item ids, not the rest of the composed
 * catalogue.
 */
export function validateLinkedItems(
  slots: Slot[],
  itemIds: Set<string>,
): LintFinding[] {
  const findings: LintFinding[] = [];
  for (const slot of slots) {
    if (slot.type !== "build_parameter") continue;
    if (slot.paramType === "list") {
      for (const option of slot.options ?? []) {
        if (option.linkedItem && !itemIds.has(option.linkedItem)) {
          findings.push({
            level: "warn",
            kind: "item",
            name: slot.id,
            message: `linkedItem "${option.linkedItem}" (option "${option.value}") has no definition`,
          });
        }
      }
    } else if (slot.linkedItem) {
      if (slot.paramType !== "boolean") {
        findings.push({
          level: "error",
          kind: "item",
          name: slot.id,
          message: `linkedItem is only meaningful on a list or boolean param — this is a ${slot.paramType}`,
        });
      } else if (!itemIds.has(slot.linkedItem)) {
        findings.push({
          level: "warn",
          kind: "item",
          name: slot.id,
          message: `linkedItem "${slot.linkedItem}" has no definition`,
        });
      }
    }
  }
  return findings;
}

/** A filter naming convention for items that are equipped without going through any slot's
 *  picker (e.g. resolved directly off a build_parameter, or intentionally hidden) -- these
 *  are expected to match no slot, so the "matches no slot" warning would just be noise. */
function isUnpickableFilter(filter: string): boolean {
  return filter.includes("build_param") || filter.includes("hidden");
}

/**
 * Lint the composed catalogue. Warnings are things that are probably a mistake; errors are
 * things the engine will misread or silently drop.
 */
export function validate(
  items: Item[],
  bonuses: Bonus[],
  schema: Schema = NW_SCHEMA,
  presets: SectionPreset[] = NW_SLOTS.presets ?? [],
): LintFinding[] {
  const findings: LintFinding[] = [
    ...validateSlots(NW_SLOTS?.slots ?? []),
    ...validatePresets(presets, NW_SLOTS?.slots ?? []),
  ];
  const report = (
    level: "error" | "warn",
    message: string,
    name?: string,
    kind: "item" | "bonus" = "item",
  ) => findings.push({ level, message, name, kind });

  const statKeys = new Set(schema.statKeys);
  const percentKinds = new Set(["percent", "mult"]);
  const allSlots = NW_SLOTS?.slots ?? [];
  const itemPickerFilters = new Set<string>(
    allSlots
      .filter(
        (slot): slot is ItemPickerSlot & { filter: string } =>
          slot.type === "item_picker" && !!slot.filter,
      )
      .map((slot) => slot.filter),
  );
  // Tags claimed by an item_picker slot instead of a filter -- an item carrying one of these
  // resolves into a slot the same way a matching `filter` would, so it counts as "in a slot"
  // for the checks below even though it has no `filter` of its own.
  const itemPickerTags = new Set<string>(
    allSlots
      .filter((slot) => slot.type === "item_picker")
      .flatMap((slot) => slot.tags ?? []),
  );
  const pointAssignmentFilters = new Set<string>(
    allSlots
      .filter((slot) => slot.type === "point_assignment")
      .map((slot) => slot.filter),
  );
  const slotFilters = new Set<string>([
    ...itemPickerFilters,
    ...pointAssignmentFilters,
  ]);
  const classSlot = findParamSlot(allSlots, "class");
  // Exclude the class slot's own "— none —" row: "" is not a class an item may be
  // restricted to, and accepting it would let a typo'd allowedClass pass silently.
  const classes = new Set(
    (classSlot?.options?.map((o) => o.value) ?? []).filter(Boolean),
  );
  const bonusIds = new Set(bonuses.map((bonus) => bonus.id));
  const itemIds = new Set(items.map((item) => item.id).filter(Boolean));
  const seenIds = new Set();
  const gameIdOwners = new Map<string, Set<string>>();
  const paramSlots = new Map<string, BuildParameterSlot>();
  const paramSlotsById = new Map<string, BuildParameterSlot>();
  for (const slot of allSlots) {
    if (slot.type === "build_parameter") {
      paramSlots.set(slot.path, slot);
      paramSlotsById.set(slot.id, slot);
    }
  }
  const linkedItemIds = collectLinkedItemIds(allSlots);
  findings.push(...validateLinkedItems(allSlots, itemIds));

  const checkStats = (
    stats: Record<string, unknown> | undefined,
    label: string,
    name?: string,
    kind: "item" | "bonus" = "item",
  ) => {
    for (const [key, value] of Object.entries(stats ?? {})) {
      if (!statKeys.has(key)) {
        report(
          "error",
          `${label}: "${key}" is not a stat in the schema`,
          name,
          kind,
        );
        continue;
      }
      if (typeof value !== "number" || !Number.isFinite(value)) {
        report("error", `${label}: ${key} is not a finite number`, name, kind);
        continue;
      }
      // Percentages are decimals: 0.09 is 9%. Typing 9 means 900%, which is the single
      // easiest mistake to make in this data and impossible to spot in the totals.
      if (
        percentKinds.has(schema.statByKey[key]?.kind) &&
        Math.abs(value) > 1.5
      ) {
        report(
          "warn",
          `${label}: ${key} = ${value} means ${value * 100}% — decimals here ` +
            "(0.09 is 9%)",
          name,
          kind,
        );
      }
    }
  };

  /** Same shape as an occurrence config's own check (`bonus "x" occurrence config ...` below)
   *  -- stat exists, min/max/default are finite numbers, default falls within min–max. Shared
   *  by an item's own `dynamicStats` and a grant/variant's, since both use the identical
   *  `DynamicStatConfig` shape. */
  const checkDynamicStats = (
    configs:
      | { stat: string; min: unknown; max: unknown; default: unknown }[]
      | undefined,
    label: string,
    name?: string,
    kind: "item" | "bonus" = "item",
  ) => {
    for (const config of configs ?? []) {
      if (!statKeys.has(config.stat)) {
        report(
          "error",
          `${label} stat "${config.stat}" is not a stat`,
          name,
          kind,
        );
        continue;
      }
      const { min, max, default: def } = config;
      if (
        ![min, max, def].every(
          (n) => typeof n === "number" && Number.isFinite(n),
        )
      ) {
        report(
          "error",
          `${label} "${config.stat}" has a non-numeric min/max/default`,
          name,
          kind,
        );
      } else if (
        (min as number) > (max as number) ||
        (def as number) < (min as number) ||
        (def as number) > (max as number)
      ) {
        report(
          "error",
          `${label} "${config.stat}" default ${def} is outside ${min}–${max}`,
          name,
          kind,
        );
      }
    }
  };

  for (const item of items) {
    if (!item.id) {
      report("error", "an item has no id", item.name);
      continue;
    }
    if (seenIds.has(item.id)) report("error", "duplicate item id", item.id);
    seenIds.add(item.id);

    // A tag-selected item_picker slot needs no `filter` at all -- an item matching one of its
    // tags is just as "in a slot" as one matching a `filter` exactly.
    const matchesPickerTag = (item.tags ?? []).some((tag) =>
      itemPickerTags.has(tag),
    );

    if (!item.filter) {
      if (!matchesPickerTag && !linkedItemIds.has(item.id)) {
        report(
          "error",
          "no filter or tag — the item appears in no slot",
          item.id,
        );
      }
    } else if (!slotFilters.has(item.filter)) {
      if (
        !matchesPickerTag &&
        !linkedItemIds.has(item.id) &&
        !isUnpickableFilter(item.filter)
      ) {
        report(
          "warn",
          `filter "${item.filter}" matches no slot, so nothing can equip it ` +
            `(name it with "build_param" or "hidden" to silence this)`,
          item.id,
        );
      }
    } else if (
      itemPickerFilters.has(item.filter) &&
      pointAssignmentFilters.has(item.filter)
    ) {
      report(
        "error",
        `filter "${item.filter}" is claimed by both an item_picker slot and a ` +
          "point_assignment slot — which one resolves it is ambiguous",
        item.id,
      );
    } else if (
      pointAssignmentFilters.has(item.filter) &&
      !item.inlineRepetition
    ) {
      report(
        "warn",
        `filter "${item.filter}" is a point_assignment slot's filter, but this ` +
          "item has no inlineRepetition config, so it never appears as a row",
        item.id,
      );
    }

    if (item.inlineRepetition) {
      const { min, max, default: def } = item.inlineRepetition;
      if (
        ![min, max, def].every(
          (n) => typeof n === "number" && Number.isFinite(n),
        )
      ) {
        report(
          "error",
          "inlineRepetition has a non-numeric min/max/default",
          item.id,
        );
      } else if (min > max || def < min || def > max) {
        report(
          "error",
          `inlineRepetition default ${def} is outside ${min}–${max}`,
          item.id,
        );
      }
    }

    const stats: Record<string, unknown> = {};
    for (const key of Object.keys(item)) {
      if (statKeys.has(key)) stats[key] = item[key];
      else if (!ITEM_FIELDS.has(key)) {
        report(
          "error",
          `"${key}" is neither a stat nor an item field — it is ignored ` +
            "entirely, so a misspelled stat name silently does nothing",
          item.id,
        );
      }
    }
    checkStats(stats, "stat", item.id);

    for (const cls of item.allowedClass ?? []) {
      if (!classes.has(cls))
        report("error", `allowedClass "${cls}" is not a class`, item.id);
    }
    for (const [slotId, value] of Object.entries(item.defaultParams ?? {})) {
      const slot = paramSlotsById.get(slotId);
      if (!slot) {
        report(
          "error",
          `defaultParams "${slotId}" is not a build_parameter slot`,
          item.id,
        );
      } else if (
        slot.paramType === "list" &&
        !slot.options?.some((option) => option.value === value)
      ) {
        report(
          "error",
          `defaultParams "${slotId}": "${value}" is not one of its options`,
          item.id,
        );
      }
    }
    for (const attachment of item.bonuses ?? []) {
      const bonusId = bonusIdOf(attachment);
      if (!bonusIds.has(bonusId)) {
        report("warn", `bonus "${bonusId}" has no definition`, item.id);
      }
      if (typeof attachment === "string") continue;
      const { min, max, default: def } = attachment;
      if (
        ![min, max, def].every(
          (n) => typeof n === "number" && Number.isFinite(n),
        )
      ) {
        report(
          "error",
          `bonus "${bonusId}" occurrence config has a non-numeric min/max/default`,
          item.id,
        );
      } else if (min > max || def < min || def > max) {
        report(
          "error",
          `bonus "${bonusId}" occurrence config default ${def} is outside ${min}–${max}`,
          item.id,
        );
      }
      if (
        attachment.label !== undefined &&
        (typeof attachment.label !== "string" || !attachment.label.trim())
      ) {
        report(
          "error",
          `bonus "${bonusId}" occurrence config label is present but not a non-empty string`,
          item.id,
        );
      }
    }
    checkDynamicStats(item.dynamicStats, "dynamicStats", item.id);

    if (item.gameIds) {
      const seenInItem = new Set<string>();
      for (const gameId of item.gameIds) {
        if (typeof gameId !== "string" || !gameId) {
          report("error", "gameIds entry is not a non-empty string", item.id);
          continue;
        }
        if (seenInItem.has(gameId)) {
          report("warn", `gameIds has a duplicate entry "${gameId}"`, item.id);
        }
        seenInItem.add(gameId);
        const owners = gameIdOwners.get(gameId) ?? new Set<string>();
        owners.add(item.id);
        gameIdOwners.set(gameId, owners);
      }
    }
  }

  for (const [gameId, owners] of gameIdOwners) {
    if (owners.size > 1) {
      report(
        "error",
        `gameId "${gameId}" is claimed by multiple items: ` +
          `${[...owners].join(", ")} — the map would be ambiguous`,
      );
    }
  }

  for (const bonus of bonuses) {
    if (!bonus.id) {
      report("error", "a bonus has no id");
      continue;
    }
    bonus.grants?.forEach((grant, index) => {
      const label = `grant ${index + 1}`;
      checkConditions(
        grant.when,
        label,
        (level, message) => report(level, message, bonus.id, "bonus"),
        paramSlots,
      );
      checkStats(grant.stats, label, bonus.id, "bonus");
      checkDynamicStats(
        grant.dynamicStats,
        `${label} dynamicStats`,
        bonus.id,
        "bonus",
      );
      for (const tier of grant.tiers ?? []) {
        checkStats(tier.stats, `${label} tier`, bonus.id, "bonus");
      }
      for (const variant of grant.variants ?? []) {
        checkDynamicStats(
          variant.dynamicStats,
          `${label} variant dynamicStats`,
          bonus.id,
          "bonus",
        );
      }
    });
  }

  return findings;
}

// `toItemsFile`/`toBonusesFile`/`toSlotsFile` -- regenerating the shipped data/*.json files
// from the composed catalogue -- live in `catalogExport.ts`, not here: that keeps this
// module free of the maintainer-only export code so it can be dynamic-imported and kept out
// of the production bundle (see LayerExportDrawer.vue).
