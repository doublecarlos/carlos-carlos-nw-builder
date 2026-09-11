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
import { findParamSlot } from "../lib/build-path";
import { resolvedOptions } from "../lib/param-options";
import { deepEqual } from "../lib/deep-equal";
import { bonusIdOf } from "../lib/bonus-attachment";
import { replacementIdOf, replacementValuesOf } from "../lib/item-replacement";
import { parseRowSlotId, rowSlot } from "../lib/item-picker-list";
import { INSIGNIA_SHAPES } from "../types";

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
  StableRole,
  SectionPreset,
  BuildParameterSlot,
  ItemPickerSlot,
  ItemPickerListSlot,
  Db,
  Build,
  FilterDefaultsMap,
  FilterFieldsMap,
} from "../types";
import { outOfRangeErrorMessage } from "../lib/format";

export const emptyOverlay = (): CatalogOverlay => ({
  items: {},
  bonuses: {},
  sectionPresets: {},
  slots: {},
});

/** Every group an overlay carries, in one place -- the loops below iterate this rather than
 * spelling the four names out, so adding a fifth group is one edit here. */
const GROUPS = ["items", "bonuses", "sectionPresets", "slots"] as const;

export const isEmpty = (overlay: CatalogOverlay | null | undefined) =>
  !overlay ||
  GROUPS.every((group) => !Object.keys(overlay[group] ?? {}).length);

/** Anything persisted or pasted has to survive being wrong. */
export function normaliseOverlay(raw: unknown): CatalogOverlay {
  const overlay = emptyOverlay();
  if (!raw || typeof raw !== "object") return overlay;
  for (const group of GROUPS) {
    const source = (raw as Record<string, unknown>)[group];
    if (!source || typeof source !== "object") continue;
    for (const [key, value] of Object.entries(source)) {
      if (value === null)
        overlay[group][key] = null; // tombstone
      else if (value && typeof value === "object")
        overlay[group][key] = value as Item & Bonus & SectionPreset & Slot;
    }
  }
  return overlay;
}

export const base = (): {
  items: Item[];
  bonuses: Bonus[];
  sectionPresets: SectionPreset[];
  slots: Slot[];
} => ({
  items: NW_ITEMS ?? [],
  bonuses: NW_BONUSES ?? [],
  sectionPresets: NW_SLOTS.presets ?? [],
  slots: NW_SLOTS.slots ?? [],
});

/**
 * Fold overlays over the base, later layers winning. Items, bonuses and presets come out
 * sorted by id so the export is stable and diffs against the generated files stay readable.
 *
 * Slots deliberately do not sort: a slot list *is* its render order, hand-authored in
 * slots.json, and sorting it by id would reshuffle every section on load. They come out in
 * base order instead, with an overlay-added slot appended -- a `Map` keyed by id gives exactly
 * that, since re-`set`ting an existing key keeps its original position. Appending globally is
 * the same as appending within a section, because every consumer groups by `slot.section`.
 */
export function compose(overlays: (CatalogOverlay | null | undefined)[] = []) {
  const {
    items: baseItems,
    bonuses: baseBonuses,
    sectionPresets: basePresets,
    slots: baseSlots,
  } = base();

  const items = new Map(baseItems.map((item) => [item.id, item]));
  const bonuses = new Map(baseBonuses.map((bonus) => [bonus.id, bonus]));
  const sectionPresets = new Map(
    basePresets.map((preset) => [preset.id, preset]),
  );
  const slots = new Map(baseSlots.map((slot) => [slot.id, slot]));

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
    for (const [id, slot] of Object.entries(overlay.slots ?? {})) {
      if (slot === null) slots.delete(id);
      else slots.set(id, slot);
    }
  }

  return {
    items: [...items.values()].sort((a, b) => a.id.localeCompare(b.id)),
    bonuses: [...bonuses.values()].sort((a, b) => a.id.localeCompare(b.id)),
    sectionPresets: [...sectionPresets.values()].sort((a, b) =>
      a.id.localeCompare(b.id),
    ),
    slots: [...slots.values()],
  };
}

/** A db the engine accepts, built from the composed catalogue. */
export function makeDb(overlays: (CatalogOverlay | null | undefined)[] = []) {
  const { items, bonuses, sectionPresets, slots } = compose(overlays);
  return db.build(items, bonuses, NW_SCHEMA, {
    sections: NW_SLOTS.sections,
    slots,
    presets: sectionPresets,
    filterDefaults: NW_SLOTS.filterDefaults,
    filterFields: NW_SLOTS.filterFields,
  });
}

// --- editing (pure: every helper returns a new overlay) ---------------------------------

const clone = (overlay: CatalogOverlay): CatalogOverlay => ({
  items: { ...overlay.items },
  bonuses: { ...overlay.bonuses },
  sectionPresets: { ...overlay.sectionPresets },
  slots: { ...overlay.slots },
});

const inBase = (group: CatalogGroup, key: string) => {
  const catalogueBase = base();
  if (group === "items")
    return catalogueBase.items.some((item) => item.id === key);
  if (group === "bonuses")
    return catalogueBase.bonuses.some((bonus) => bonus.id === key);
  if (group === "slots")
    return catalogueBase.slots.some((slot) => slot.id === key);
  return catalogueBase.sectionPresets.some((preset) => preset.id === key);
};

/** Save an entry under its id. Ids are frozen at creation (`nextId`, below) and never
 * user-edited afterwards, so the key an entry is saved under never changes across its
 * lifetime. */
export function upsert(
  overlay: CatalogOverlay,
  group: CatalogGroup,
  key: string,
  value: Item | Bonus | SectionPreset | Slot,
) {
  const next = clone(overlay);
  (next[group] as Record<string, Item | Bonus | SectionPreset | Slot | null>)[
    key
  ] = value;
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

/**
 * A new `build_parameter` slot's id. Slot ids are namespaced by their section
 * (`options.magnitude`, `gear.head`), unlike item/bonus ids, so this prefixes rather than
 * calling `nextId` directly -- disambiguating against the prefixed form, since that is what
 * actually has to be unique.
 */
export function nextSlotId(
  section: string,
  label: string,
  existingIds: string[],
): string {
  const prefix = section ? `${section}.` : "";
  const stem = slugify(label) || "param";
  const taken = new Set(existingIds);
  if (!taken.has(`${prefix}${stem}`)) return `${prefix}${stem}`;
  let n = 2;
  while (taken.has(`${prefix}${stem}-${n}`)) n += 1;
  return `${prefix}${stem}-${n}`;
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

export type EntryStatus = "base" | "added" | "edited" | "removed";

/** How an entry differs from what shipped -- drives the badges in the editor list. */
export function statusOf(
  overlay: CatalogOverlay | null | undefined,
  group: CatalogGroup,
  key: string,
): EntryStatus {
  const override = overlay?.[group]?.[key];
  const shipped = inBase(group, key);
  if (override === null) return "removed";
  if (override === undefined) return "base";
  return shipped ? "edited" : "added";
}

/** Every id `group` tombstones in `overlay`, the ids `statusOf` calls "removed". An editor
 *  entry list shows these alongside the group's present entries, so a deletion stays
 *  reversible from the list. */
export function tombstoneIds(
  overlay: CatalogOverlay,
  group: CatalogGroup,
): string[] {
  return Object.entries(overlay[group] ?? {})
    .filter(([, value]) => value === null)
    .map(([id]) => id);
}

// --- portable files (phase 7) -------------------------------------------------------------

/** Everything in the composed catalogue this build depends on that base does not already
 *  provide - what a download has to carry to resolve identically elsewhere. */
export function referencedOverlay(db: Db, build: Build): CatalogOverlay {
  const itemIds = new Set<string>();
  const bonusIds = new Set<string>();

  // Seed items from choices
  for (const id of Object.values(build.choices)) {
    if (id && id !== "-" && id !== "") itemIds.add(id);
  }

  // Both ends of a `replacedBy` travel: without the stored id the choice dangles on the other
  // side, without the replacement the offer points at nothing.
  for (const id of [...itemIds]) {
    const replacement = db.replacementFor(id);
    if (replacement) itemIds.add(replacement.id);
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
  }

  // Follow bonus excludes transitively - bonuses can chain through excludes
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

  // Emit only items absent from base or not deep-equal to it. An overlay entry is keyed by the
  // id it is stored under and db.ts re-indexes it by the entry's own `id`, so the two must
  // agree: one emitted under someone else's id vanishes from the catalogue on import.
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

  // Every build_parameter slot that differs from base, whether or not this build ever set it.
  // Unlike an item, a param needs no reference to matter: bonus.ts's `collect()` walks the
  // *whole* slot list and puts each param in `ctx.params` at its stored value or its `default`,
  // so an added slot and an edited default both change what conditions see. Carrying only the
  // ones the build happens to have a stored value for would let the same build resolve
  // differently on the other machine -- which is the one thing a download must not do.
  //
  // Added/edited only, the same deep-equal test items use. A *removed* shipped param does not
  // travel: "not in `db.slots`" cannot be told apart from "this db was never built from base"
  // here, and tombstoning on that guess would embed a full set of them into every ordinary
  // download. Same limitation items and presets already have.
  //
  // Restricted to `build_parameter` because that is all an overlay can carry (see
  // `CatalogOverlay.slots`), so nothing else can have diverged.
  const baseParamSlots = new Map(
    base()
      .slots.filter((slot) => slot.type === "build_parameter")
      .map((slot) => [slot.id, slot]),
  );
  for (const slot of db.authoredSlots) {
    if (slot.type !== "build_parameter") continue;
    const baseSlot = baseParamSlots.get(slot.id);
    if (!baseSlot || !deepEqual(slot, baseSlot)) overlay.slots[slot.id] = slot;
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
  "shortDescription",
  "longDescription",
  "gameIds",
  "defaultParams",
  "publishes",
  "hideFromPicker",
  "replacedBy",
  "insigniaSlots",
  "insigniaShape",
  "preferredVariant",
  "insigniaRecipe",
]);

const SHAPES = new Set<string>(INSIGNIA_SHAPES);
const isShape = (value: unknown) =>
  typeof value === "string" && SHAPES.has(value);

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
      `${path}: param "${spec.key}" has a dedicated "${dedicated}" condition; prefer that`,
    );
  }

  const slot = paramSlots.get(spec.key);
  if (!slot) {
    // conditions.ts's param leaf fails closed on an unresolvable key, same as an unknown
    // condition key -- the bonus would silently never apply.
    report(
      "error",
      `${path}: param "${spec.key}" is not a build_parameter's path; the condition can never be active`,
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
      `${path}: param "${spec.key}" is a number; use atLeast/below/exactly`,
    );
  } else if (slot.paramType === "boolean" && spec.is === undefined) {
    report("error", `${path}: param "${spec.key}" is a boolean; use "is"`);
  } else if (slot.paramType === "list" && spec.equals === undefined) {
    report("error", `${path}: param "${spec.key}" is a list; use "equals"`);
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
        `${path}: unknown condition "${key}"; the bonus can never be active`,
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

/** Every path a `visibleWhen` reads, flattened out of its combinators -- the `param` leaf's
 * `key` plus the dedicated leaves that are really a param under another name. Used only to
 * catch a slot gating itself; the conditions themselves are linted by `checkConditions`. */
function conditionPaths(when: ConditionWhen | undefined, out: Set<string>) {
  if (!when || typeof when !== "object") return;
  for (const [key, spec] of Object.entries(when)) {
    if (key === "all" || key === "any") {
      if (Array.isArray(spec))
        for (const sub of spec) conditionPaths(sub as ConditionWhen, out);
    } else if (key === "not") {
      conditionPaths(spec as ConditionWhen, out);
    } else if (key === "param") {
      const paramKey = (spec as ParamCondition)?.key;
      if (paramKey) out.add(paramKey);
    } else if (key === "toggle") {
      for (const name of Array.isArray(spec) ? spec : [spec])
        out.add(`toggles.${name}`);
    } else if (DEDICATED_LEAF_FOR_PATH[key] === key) {
      // `role`/`class`/`damageType`/`duration`/`enemies`: leaves whose name *is* the path they
      // read, so the key doubles as the param path. The `toggle` leaf above is the one that
      // isn't, hence its own branch.
      out.add(key);
    }
  }
}

/** Every bonus id a `when`'s occurrence leaves name, flattened out of its combinators. */
function occurrenceTargets(when: ConditionWhen | undefined, out: string[]) {
  if (!when || typeof when !== "object") return;
  const named = when.bonusOccurrences?.bonus;
  if (named !== undefined) out.push(named);
  for (const sub of [...(when.all ?? []), ...(when.any ?? [])])
    occurrenceTargets(sub, out);
  occurrenceTargets(when.not, out);
}

/**
 * Lint every `build_parameter` slot's `path` (empty, duplicated -- two slots silently fighting
 * over one value -- or shadowing a `BuildContext` field outright) and its `visibleWhen`, every
 * `point_assignment` slot's `filter`, and every `item_picker` slot's `filter`/`tags` selector.
 * Standalone from `validate()` below since it needs only the slot list, not a composed
 * catalogue.
 */
export function validateSlots(slots: Slot[]): LintFinding[] {
  const findings: LintFinding[] = [];
  const seenPaths = new Map<string, string>();
  // Built up front rather than during the loop below: a `visibleWhen` may legitimately read a
  // param declared further down the list, and `checkConditions` errors on a key it can't resolve.
  const paramSlots = new Map<string, BuildParameterSlot>();
  for (const slot of slots) {
    if (slot.type === "build_parameter" && slot.path)
      paramSlots.set(slot.path, slot);
  }
  for (const slot of slots) {
    // Every slot type carries `visibleWhen`, so this runs ahead of the per-type branches
    // below: a mistyped condition on a separator is as broken as one on a param.
    if (slot.visibleWhen) {
      checkConditions(
        slot.visibleWhen,
        `${slot.id} visibleWhen`,
        (level, message) => findings.push({ level, kind: "item", message }),
        paramSlots,
      );
    }
    // Read off the raw object: the other variants do not declare the field, which is how a
    // file can still arrive carrying it.
    if (
      (slot as { toggleable?: unknown }).toggleable !== undefined &&
      slot.type !== "item_picker" &&
      slot.type !== "item_picker_list"
    ) {
      findings.push({
        level: "error",
        kind: "item",
        message: `${slot.id}: toggleable is only meaningful on an item_picker or item_picker_list, this is a ${slot.type}`,
      });
    }
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
    if (slot.type === "item_picker" || slot.type === "item_picker_list") {
      const hasFilter = !!slot.filter;
      const hasTags = !!slot.tags?.length;
      if (!hasFilter && !hasTags) {
        findings.push({
          level: "error",
          kind: "item",
          message: `${slot.id}: ${slot.type} slot has neither a filter nor tags`,
        });
      } else if (hasFilter && hasTags) {
        findings.push({
          level: "error",
          kind: "item",
          message: `${slot.id}: ${slot.type} slot has both a filter and tags; pick one, resolving both is ambiguous`,
        });
      }
      if (slot.type === "item_picker_list") {
        const rows = slot.defaultRows;
        if (rows !== undefined && (!Number.isInteger(rows) || rows < 0)) {
          findings.push({
            level: "error",
            kind: "item",
            message: `${slot.id}: defaultRows must be a whole number of rows, got ${rows}`,
          });
        }
        continue;
      }
      // With no `default` the only state `disallowEmpty` forbids is the one every fresh build
      // starts in.
      if (slot.disallowEmpty && !slot.default) {
        findings.push({
          level: "error",
          kind: "item",
          message: `${slot.id}: disallowEmpty needs a default; without one every fresh build starts in the state it forbids`,
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
        message: `${slot.id}: path "${slot.path}" duplicates ${owner}'s; they would silently share one value`,
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
    if (slot.optionsFrom) {
      if (slot.paramType !== "list") {
        findings.push({
          level: "error",
          kind: "slot",
          name: slot.id,
          message: `${slot.id}: optionsFrom is only meaningful on a list param; this is a ${slot.paramType}`,
        });
      }
      if (slot.options) {
        findings.push({
          level: "error",
          kind: "slot",
          name: slot.id,
          message: `${slot.id}: has both options and optionsFrom; pick one, resolving both is ambiguous`,
        });
      }
      // Same "exactly one selector" rule `item_picker` has: a slot
      // resolves its candidates one way or the other, never both.
      const hasFilter = !!slot.optionsFrom.filter;
      const hasTags = !!slot.optionsFrom.tags?.length;
      if (!hasFilter && !hasTags) {
        findings.push({
          level: "error",
          kind: "slot",
          name: slot.id,
          message: `${slot.id}: optionsFrom has neither a filter nor tags`,
        });
      } else if (hasFilter && hasTags) {
        findings.push({
          level: "error",
          kind: "slot",
          name: slot.id,
          message: `${slot.id}: optionsFrom has both a filter and tags; pick one, resolving both is ambiguous`,
        });
      }
    }
    if (slot.visibleWhen) {
      // The condition itself is checked at the top of the loop; this is the one rule only a
      // `build_parameter` can break. Harmless at runtime -- the row just disappears at
      // whichever values fail -- but a param that hides itself can never be set back.
      const read = new Set<string>();
      conditionPaths(slot.visibleWhen, read);
      if (read.has(slot.path)) {
        findings.push({
          level: "error",
          kind: "item",
          message: `${slot.id}: visibleWhen reads its own path "${slot.path}"; the param would hide itself at some values, with no way to change it back`,
        });
      }
    }
  }
  return findings;
}

// The slot types a preset field may reference -- `validatePresets`' own check that e.g.
// `choices` only ever names an `item_picker` slot, not a `build_parameter` one wearing the
// wrong hat and silently doing nothing when applied. A list rather than one type because
// `assignments` addresses inline-repetition counts, which both instancing slot types carry.
const PRESET_FIELD_SLOT_TYPE = {
  params: ["build_parameter"],
  choices: ["item_picker"],
  values: ["item_picker"],
  assignments: ["point_assignment", "item_picker"],
} as const;

// The slot types `clears` can reset -- those that hold a build value, an `item_picker_list`
// included (naming the container resets every row it holds). A `separator`/`text` slot has
// nothing to clear, so naming one is an authoring mistake rather than a no-op.
const CLEARABLE_SLOT_TYPES: readonly Slot["type"][] = [
  "build_parameter",
  "item_picker",
  "item_picker_list",
  "point_assignment",
];

/** `slots` as a lookup that also answers for the row ids an `item_picker_list` expands into --
 *  db.ts's `slotFor`, for the validators, which have a slot list but no `Db`. */
function slotResolver(slots: Slot[]): (slotId: string) => Slot | undefined {
  const byId = new Map(slots.map((slot) => [slot.id, slot]));
  return (slotId) => {
    const authored = byId.get(slotId);
    if (authored) return authored;
    const row = parseRowSlotId(slotId);
    const list = row ? byId.get(row.listId) : undefined;
    return list?.type === "item_picker_list"
      ? rowSlot(list, row!.index)
      : undefined;
  };
}

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
  const resolve = slotResolver(slots);
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

    for (const [field, expectedTypes] of Object.entries(
      PRESET_FIELD_SLOT_TYPE,
    ) as [keyof typeof PRESET_FIELD_SLOT_TYPE, readonly Slot["type"][]][]) {
      for (const slotId of Object.keys(
        preset[field as keyof typeof PRESET_FIELD_SLOT_TYPE] ?? {},
      )) {
        const slot = resolve(slotId);
        if (!slot) {
          findings.push({
            level: "error",
            kind: "sectionPreset",
            name: preset.id,
            message: `preset "${preset.id}": "${slotId}" (in ${field}) is not a known slot`,
          });
        } else if (!expectedTypes.includes(slot.type)) {
          findings.push({
            level: "error",
            kind: "sectionPreset",
            name: preset.id,
            message: `preset "${preset.id}": "${slotId}" is a ${slot.type} slot, but ${field} only applies to ${expectedTypes.map((type) => `a ${type}`).join(" or ")} slot`,
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

    // `clears` is a bare list rather than a keyed map, and it accepts any of the three
    // value-holding slot types, so it can't ride the PRESET_FIELD_SLOT_TYPE loop above.
    for (const slotId of preset.clears ?? []) {
      const slot = resolve(slotId);
      if (!slot) {
        findings.push({
          level: "error",
          kind: "sectionPreset",
          name: preset.id,
          message: `preset "${preset.id}": "${slotId}" (in clears) is not a known slot`,
        });
      } else if (!CLEARABLE_SLOT_TYPES.includes(slot.type)) {
        findings.push({
          level: "error",
          kind: "sectionPreset",
          name: preset.id,
          message: `preset "${preset.id}": "${slotId}" is a ${slot.type} slot, which holds no value to clear`,
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
  return findings;
}

/** A filter naming convention for items that are equipped without going through any slot's
 *  picker (e.g. resolved directly off a build_parameter, or intentionally hidden) -- these
 *  are expected to match no slot, so the "matches no slot" warning would just be noise. */
function isUnpickableFilter(filter: string): boolean {
  return filter.includes("build_param") || filter.includes("hidden");
}

// Engine-coupled list params whose option set is fixed by data/schema.json, not by the slot.
// `schema.json` is not overlayable, so an option the schema does not know resolves through a
// silent fallback (`?? schema.roles.dps`, or a stat key the vector simply has no column for) --
// wrong numbers, no error. The `allowedClass` lint below is the same shape: validate authored
// values against the vocabulary that actually decides them.
const SCHEMA_BACKED_PARAM_PATHS: Record<string, "role" | "statKey"> = {
  role: "role",
  "forte.primary": "statKey",
  "forte.secondaryA": "statKey",
  "forte.secondaryB": "statKey",
};

/**
 * Every option an engine-coupled list param offers has to be a value `schema.json` knows --
 * a real `schema.roles` key, or a real `StatKey`. Empty is always allowed: it is the
 * "- none -" row every one of these slots carries.
 */
export function validateParamSchema(
  slots: Slot[],
  schema: Schema = NW_SCHEMA,
): LintFinding[] {
  const findings: LintFinding[] = [];
  const vocabulary = {
    role: new Set(Object.keys(schema.roles ?? {})),
    statKey: new Set(schema.statKeys ?? []),
  };
  for (const slot of slots) {
    if (slot.type !== "build_parameter" || slot.paramType !== "list") continue;
    const kind = SCHEMA_BACKED_PARAM_PATHS[slot.path];
    if (!kind) continue;
    for (const option of slot.options ?? []) {
      if (!option.value || vocabulary[kind].has(option.value)) continue;
      findings.push({
        level: "error",
        kind: "slot",
        name: slot.id,
        message:
          `${slot.id}: option "${option.value}" is not a ` +
          `${kind === "role" ? "role in schema.roles" : "stat key in schema.statKeys"}; ` +
          `the engine would fall back silently and compute the wrong numbers`,
      });
    }
  }
  return findings;
}

/**
 * A shipped `build_parameter` removed by an overlay, while a bonus still gates on its path.
 * conditions.ts's `param` leaf fails closed on a key it cannot resolve, so the bonus does not
 * error -- it just quietly stops applying, which is the hardest kind of data bug to notice.
 * A warning rather than an error: removing the param may well be the point, and the fix
 * (dropping the condition too) is the author's call.
 */
export function validateParamReaders(
  slots: Slot[],
  bonuses: Bonus[],
): LintFinding[] {
  const livePaths = new Set(
    slots
      .filter((slot) => slot.type === "build_parameter")
      .map((slot) => slot.path),
  );
  const missing = new Map<string, string>(); // path -> the shipped slot id that had it
  for (const slot of base().slots) {
    if (slot.type !== "build_parameter") continue;
    if (!livePaths.has(slot.path)) missing.set(slot.path, slot.id);
  }
  if (!missing.size) return [];

  const findings: LintFinding[] = [];
  for (const bonus of bonuses) {
    const read = new Set<string>();
    for (const grant of bonus.grants ?? []) {
      conditionPaths(grant.when, read);
      // Only `when` carries a condition -- a tier gates on `bonusOccurrences` alone, and a
      // `problem` rides on its grant's own `when`.
      for (const variant of grant.variants ?? [])
        conditionPaths(variant.when, read);
    }
    for (const path of read) {
      const slotId = missing.get(path);
      if (!slotId) continue;
      findings.push({
        level: "warn",
        kind: "bonus",
        name: bonus.id,
        message:
          `reads parameter "${path}", but ${slotId} has been removed; the condition ` +
          `fails closed, so this bonus silently never applies`,
      });
    }
  }
  return findings;
}

/**
 * Lint the composed catalogue. Warnings are things that are probably a mistake; errors are
 * things the engine will misread or silently drop.
 */
/**
 * Lint every `ItemPickerSlot.default` against the catalogue: an id that does not exist, or is
 * not one of that slot's own candidates, leaves the slot quietly empty in every fresh build.
 * Split out of `validateSlots` because it is the one slot rule needing the item list too.
 */
export function validateSlotDefaults(
  slots: Slot[],
  items: Item[],
): LintFinding[] {
  const findings: LintFinding[] = [];
  const byId = new Map(items.map((item) => [item.id, item]));

  for (const slot of slots) {
    if (slot.type !== "item_picker" || !slot.default) continue;
    const item = byId.get(slot.default);
    if (!item) {
      findings.push({
        level: "error",
        kind: "slot",
        name: slot.id,
        message: `${slot.id}: default "${slot.default}" does not exist`,
      });
      continue;
    }
    // Same `filter` XOR `tags` resolution `Db.forSlot` does: a default the slot would never
    // offer is silently no default at all.
    const candidate = slot.tags?.length
      ? (item.tags ?? []).some((tag) => slot.tags!.includes(tag))
      : item.filter === slot.filter;
    if (!candidate) {
      findings.push({
        level: "error",
        kind: "slot",
        name: slot.id,
        message: `${slot.id}: default "${slot.default}" is not one of this slot's own candidates`,
      });
    }
  }

  return findings;
}

/**
 * Every `Item.replacedBy` chain has to end somewhere real. A broken one never crashes -- it
 * just silently leaves builds on an item they were meant to move off, which only a lint finds.
 * Errors throughout: no reading of a self-reference, cycle or dangling target is intentional.
 */
export function validateReplacements(
  items: Item[],
  schema: Schema = NW_SCHEMA,
): LintFinding[] {
  const findings: LintFinding[] = [];
  const byId = new Map(items.map((item) => [item.id, item]));
  const statKeys = new Set(schema.statKeys);

  for (const item of items) {
    if (!item.replacedBy) continue;
    const target = replacementIdOf(item.replacedBy);
    if (target === item.id) {
      findings.push({
        level: "error",
        kind: "item",
        name: item.id,
        message: "replacedBy points at itself",
      });
      continue;
    }
    if (!byId.has(target)) {
      findings.push({
        level: "error",
        kind: "item",
        name: item.id,
        message: `replacedBy "${target}" does not exist`,
      });
      continue;
    }
    // A seed reaches `Build.values` only through a `dynamicStats` entry on the item ending the
    // chain, so one naming a stat that item lacks is silently dropped at migration.
    const seeds = Object.entries(replacementValuesOf(item.replacedBy));
    if (seeds.length) {
      const final = endOfChain(byId, item);
      const declared = new Set(
        (final?.dynamicStats ?? []).map((config) => config.stat),
      );
      for (const [stat, value] of seeds) {
        if (!statKeys.has(stat)) {
          findings.push({
            level: "error",
            kind: "item",
            name: item.id,
            message: `replacedBy seeds "${stat}", which is not a stat in the schema`,
          });
        } else if (typeof value !== "number" || !Number.isFinite(value)) {
          findings.push({
            level: "error",
            kind: "item",
            name: item.id,
            message: `replacedBy seeds ${stat} with a non-finite value`,
          });
        } else if (final && !declared.has(stat)) {
          findings.push({
            level: "error",
            kind: "item",
            name: item.id,
            message:
              `replacedBy seeds ${stat}, but "${final.id}" declares no dynamicStats ` +
              "entry for it; the value would be dropped on migration",
          });
        }
      }
    }

    // One finding per cycle member: each is an item whose `replacedBy` needs fixing.
    const seen = new Set<string>([item.id]);
    let cursor: string | undefined = target;
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      const next: Item["replacedBy"] = byId.get(cursor)?.replacedBy;
      cursor = next ? replacementIdOf(next) : undefined;
    }
    if (cursor) {
      findings.push({
        level: "error",
        kind: "item",
        name: item.id,
        message: `replacedBy chain loops back to "${cursor}"`,
      });
    }
  }
  return findings;
}

/** The item a chain ends on, or undefined if it cycles or dangles (reported separately). */
function endOfChain(byId: Map<string, Item>, start: Item): Item | undefined {
  const seen = new Set<string>([start.id]);
  let item: Item | undefined = start;
  while (item?.replacedBy) {
    const next = replacementIdOf(item.replacedBy);
    if (seen.has(next)) return undefined;
    seen.add(next);
    item = byId.get(next);
    if (!item) return undefined;
  }
  return item;
}

/** Rows that could hold `item` at once: one per `item_picker` offering it, unbounded for an
 *  `item_picker_list` or a `point_assignment`. Resolves candidates as `Db.forSlot` does. */
function rowsOffering(item: Item, slots: Slot[]): number {
  let rows = 0;
  for (const slot of slots) {
    if (slot.type === "item_picker" || slot.type === "item_picker_list") {
      const candidate = slot.tags?.length
        ? (item.tags ?? []).some((tag) => slot.tags!.includes(tag))
        : !!slot.filter && slot.filter === item.filter;
      if (!candidate) continue;
      rows += slot.type === "item_picker" ? 1 : Number.POSITIVE_INFINITY;
    } else if (
      slot.type === "point_assignment" &&
      slot.filter === item.filter
    ) {
      rows += Number.POSITIVE_INFINITY;
    }
  }
  return rows;
}

/**
 * Within one filter a cap is either a category-wide fact or nobody's, so members carrying
 * `maxCopies` beside members that don't is an oversight. Quiet where a cap could never bind
 * (a filter one row alone can hold) or where a `filterDefaults` entry already answers for
 * every member. Warns rather than errors: unlimited is right for some categories, and an
 * item that means it says so with `maxCopies: 0`.
 */
export function validateMaxCopies(
  items: Item[],
  slots: Slot[] = NW_SLOTS?.slots ?? [],
  filterDefaults: FilterDefaultsMap = NW_SLOTS.filterDefaults ?? {},
): LintFinding[] {
  const findings: LintFinding[] = [];
  const byFilter = new Map<string, Item[]>();

  for (const item of items) {
    if (!item.filter) continue;
    if (filterDefaults[item.filter]?.maxCopies !== undefined) continue;
    if (rowsOffering(item, slots) < 2) continue;
    const group = byFilter.get(item.filter);
    if (group) group.push(item);
    else byFilter.set(item.filter, [item]);
  }

  for (const [filter, group] of byFilter) {
    const capped = group.filter((item) => item.maxCopies !== undefined);
    if (!capped.length || capped.length === group.length) continue;
    for (const item of group) {
      if (item.maxCopies !== undefined) continue;
      findings.push({
        level: "warn",
        kind: "item",
        name: item.id,
        message:
          `${capped.length} of ${group.length} "${filter}" items cap how many copies a ` +
          "build may hold and this one does not; set a max, or 0 to say it may repeat",
      });
    }
  }

  return findings;
}

/**
 * Every field a `filterFields` entry claims is a real item field. A misspelling silently
 * withholds a form group instead of narrowing one.
 */
export function validateFilterFields(
  filterFields: FilterFieldsMap = NW_SLOTS.filterFields ?? {},
): LintFinding[] {
  const findings: LintFinding[] = [];
  for (const [filter, fields] of Object.entries(filterFields)) {
    for (const field of fields) {
      if (ITEM_FIELDS.has(field)) continue;
      findings.push({
        level: "error",
        kind: "item",
        message:
          `filterFields "${filter}" claims "${field}", which is not an item field; ` +
          "no form group answers to it, so the entry does nothing",
      });
    }
  }
  return findings;
}

/**
 * The stable's slot declarations are coherent.
 *
 * A group missing its mount row, two insignia claiming one position, or a row pointed at the
 * wrong filter all leave the resolver quietly doing nothing rather than failing.
 */
export function validateStableSlots(
  slots: Slot[] = NW_SLOTS?.slots ?? [],
): LintFinding[] {
  const findings: LintFinding[] = [];
  const report = (name: string, message: string) =>
    findings.push({ level: "error", kind: "slot", name, message });

  const FILTER_FOR: Record<StableRole, string> = {
    mount: "mount",
    insignia: "insignia",
    bonus: "insignia_bonus",
  };

  const groups = new Map<
    number,
    {
      mounts: string[];
      bonuses: string[];
      insignia: { id: string; index?: number }[];
    }
  >();

  for (const slot of slots) {
    if (slot.type !== "item_picker" || !slot.stable) continue;
    const { group, role, index } = slot.stable;
    if (!FILTER_FOR[role]) {
      report(slot.id, `stable.role "${role}" is not a stable role`);
      continue;
    }
    if (!Number.isInteger(group)) {
      report(slot.id, `stable.group must be a whole number, got ${group}`);
      continue;
    }
    if (slot.filter !== FILTER_FOR[role]) {
      report(
        slot.id,
        `a stable "${role}" row must select "${FILTER_FOR[role]}", not "${slot.filter ?? "nothing"}"`,
      );
    }
    let entry = groups.get(group);
    if (!entry) {
      entry = { mounts: [], bonuses: [], insignia: [] };
      groups.set(group, entry);
    }
    if (role === "mount") entry.mounts.push(slot.id);
    else if (role === "bonus") entry.bonuses.push(slot.id);
    else entry.insignia.push({ id: slot.id, index });
  }

  for (const [group, entry] of groups) {
    const at = `stable group ${group}`;
    if (entry.mounts.length !== 1)
      report(
        entry.mounts[0] ?? at,
        `${at} declares ${entry.mounts.length} mount rows, needs 1`,
      );
    if (entry.bonuses.length !== 1)
      report(
        entry.bonuses[0] ?? at,
        `${at} declares ${entry.bonuses.length} bonus rows, needs 1`,
      );

    // Three or four, matching what a mount can offer.
    if (entry.insignia.length < 3 || entry.insignia.length > 4) {
      report(
        at,
        `${at} declares ${entry.insignia.length} insignia rows, needs 3 or 4`,
      );
    }
    // A gap or repeat shifts every slot after it onto the wrong shape.
    const seen = new Set<number>();
    for (const { id, index } of entry.insignia) {
      if (index === undefined) {
        report(id, "a stable insignia row needs a stable.index");
      } else if (index < 1 || index > entry.insignia.length) {
        report(
          id,
          `stable.index ${index} is outside 1-${entry.insignia.length}`,
        );
      } else if (seen.has(index)) {
        report(id, `stable.index ${index} is already taken in ${at}`);
      } else {
        seen.add(index);
      }
    }
  }

  return findings;
}

export function validate(
  items: Item[],
  bonuses: Bonus[],
  schema: Schema = NW_SCHEMA,
  presets: SectionPreset[] = NW_SLOTS.presets ?? [],
  slots: Slot[] = NW_SLOTS?.slots ?? [],
  filterDefaults: FilterDefaultsMap = NW_SLOTS.filterDefaults ?? {},
  filterFields: FilterFieldsMap = NW_SLOTS.filterFields ?? {},
): LintFinding[] {
  const findings: LintFinding[] = [
    ...validateSlots(slots),
    ...validateSlotDefaults(slots, items),
    ...validatePresets(presets, slots),
    ...validateParamSchema(slots, schema),
    ...validateParamReaders(slots, bonuses),
    ...validateReplacements(items, schema),
    ...validateMaxCopies(items, slots, filterDefaults),
    ...validateStableSlots(slots),
    ...validateFilterFields(filterFields),
  ];
  const report = (
    level: "error" | "warn",
    message: string,
    name?: string,
    kind: "item" | "bonus" = "item",
  ) => findings.push({ level, message, name, kind });

  const statKeys = new Set(schema.statKeys);
  const byId = new Map(items.map((item) => [item.id, item]));
  const percentKinds = new Set(["percent", "mult"]);
  const allSlots = slots;
  const itemPickerFilters = new Set<string>(
    allSlots
      .filter(
        (
          slot,
        ): slot is (ItemPickerSlot | ItemPickerListSlot) & {
          filter: string;
        } =>
          (slot.type === "item_picker" || slot.type === "item_picker_list") &&
          !!slot.filter,
      )
      .map((slot) => slot.filter),
  );
  // Tags claimed by an item_picker slot instead of a filter -- an item carrying one of these
  // resolves into a slot the same way a matching `filter` would, so it counts as "in a slot"
  // for the checks below even though it has no `filter` of its own.
  const itemPickerTags = new Set<string>(
    allSlots
      .filter(
        (slot) =>
          slot.type === "item_picker" || slot.type === "item_picker_list",
      )
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
  // The class vocabulary is whatever the catalogue publishes at `class` -- there is no
  // class param to read options off any more. Falls back to a class *param*'s options when one
  // exists, so an overlay that still declares the old shape keeps linting sensibly.
  // Blank values are excluded either way: "" is not a class an item may be restricted to, and
  // accepting it would let a typo'd allowedClass pass silently.
  const classSlot = findParamSlot(allSlots, "class");
  const classes = new Set(
    [
      ...items.map((item) => item.publishes?.class),
      ...(classSlot ? (resolvedOptions(classSlot, items) ?? []) : []).map(
        (option) => option.value,
      ),
    ].filter((value): value is string => typeof value === "string" && !!value),
  );
  const bonusIds = new Set(bonuses.map((bonus) => bonus.id));
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
          `${label}: ${key} = ${value} means ${value * 100}%; this field takes decimals ` +
            "(0.09 is 9%)",
          name,
          kind,
        );
      }
    }
  };

  /** Same shape as an occurrence config's own check (`bonus "x" occurrence config ...` below)
   *  -- stat exists, min/max/default are finite numbers, default falls within min-max. Shared
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
          outOfRangeErrorMessage(
            `${label} "${config.stat}" default`,
            def as number,
            min as number,
            max as number,
          ),
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
      if (!matchesPickerTag) {
        report(
          "error",
          "no filter or tag; the item appears in no slot",
          item.id,
        );
      }
    } else if (!slotFilters.has(item.filter)) {
      if (!matchesPickerTag && !isUnpickableFilter(item.filter)) {
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
          "point_assignment slot; which one resolves it is ambiguous",
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
          outOfRangeErrorMessage(`inlineRepetition default`, def, min, max),
          item.id,
        );
      }
    }

    // A typo in any of these fails silently: the resolver simply never matches.
    if (item.insigniaShape && !isShape(item.insigniaShape))
      report(
        "error",
        `insigniaShape "${item.insigniaShape}" is not a shape`,
        item.id,
      );

    if (item.insigniaSlots) {
      if (item.insigniaSlots.length < 3 || item.insigniaSlots.length > 4) {
        report(
          "error",
          `insigniaSlots has ${item.insigniaSlots.length} entries; a mount has 3 or 4`,
          item.id,
        );
      }
      item.insigniaSlots.forEach((spec, i) => {
        const where = `insigniaSlots[${i}]`;
        if (spec.universal) {
          if (spec.shape)
            report(
              "error",
              `${where} is universal and also names a shape`,
              item.id,
            );
          if (spec.preferred && !isShape(spec.preferred))
            report(
              "error",
              `${where} preferred "${spec.preferred}" is not a shape`,
              item.id,
            );
        } else if (!spec.shape) {
          report("error", `${where} is neither universal nor shaped`, item.id);
        } else {
          if (!isShape(spec.shape))
            report(
              "error",
              `${where} shape "${spec.shape}" is not a shape`,
              item.id,
            );
          if (spec.preferred)
            report(
              "error",
              `${where} is a fixed slot, so its preferred shape does nothing`,
              item.id,
            );
        }
      });
    }

    if (item.insigniaRecipe) {
      if (item.insigniaRecipe.length < 3 || item.insigniaRecipe.length > 4) {
        report(
          "error",
          `insigniaRecipe has ${item.insigniaRecipe.length} shapes; a bonus takes 3 or 4`,
          item.id,
        );
      }
      for (const shape of item.insigniaRecipe) {
        if (!isShape(shape))
          report(
            "error",
            `insigniaRecipe shape "${shape}" is not a shape`,
            item.id,
          );
      }
    }

    if (item.preferredVariant) {
      const twin = byId.get(item.preferredVariant);
      if (!twin) {
        report(
          "error",
          `preferredVariant "${item.preferredVariant}" is not an item`,
          item.id,
        );
      } else {
        if (twin.insigniaShape !== item.insigniaShape)
          report(
            "error",
            `preferredVariant "${twin.id}" is ${twin.insigniaShape ?? "shapeless"}, not ${item.insigniaShape ?? "shapeless"}`,
            item.id,
          );
        if (twin.preferredVariant)
          report(
            "error",
            `preferredVariant "${twin.id}" declares one of its own`,
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
          `"${key}" is neither a stat nor an item field; it is ignored ` +
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
    for (const [path, value] of Object.entries(item.publishes ?? {})) {
      if (!path) {
        report("error", "publishes has an empty path", item.id);
      } else if (paramSlots.has(path)) {
        // Two declarations of one value: the param's own control would show a value the
        // engine then overwrote from this item, with no hint on screen that it had.
        report(
          "error",
          `publishes "${path}" is already a build_parameter's path (${paramSlots.get(path)!.id}); the parameter's own value would be silently overridden`,
          item.id,
        );
      }
      if (value !== null && typeof value === "object") {
        report(
          "error",
          `publishes "${path}" must be a string, number or boolean`,
          item.id,
        );
      }
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
          outOfRangeErrorMessage(
            `bonus "${bonusId}" occurrence config default`,
            def,
            min,
            max,
          ),
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

  // Several items may claim one game id -- that is how an in-game item whose stats depend on
  // its slot is modelled (an enchantment's offense / defense / utility forms are three entries
  // but one `Hitem`). The importer tells them apart by which slot accepts which item, so the
  // claimants have to differ by `filter`; two sharing one is the case nothing can resolve.
  const filterOf = new Map(items.map((item) => [item.id, item.filter]));
  for (const [gameId, owners] of gameIdOwners) {
    if (owners.size < 2) continue;
    const byFilter = new Map<string | undefined, string[]>();
    for (const owner of owners) {
      const key = filterOf.get(owner);
      const list = byFilter.get(key);
      if (list) list.push(owner);
      else byFilter.set(key, [owner]);
    }
    for (const [filter, clash] of byFilter) {
      if (clash.length < 2) continue;
      report(
        "error",
        `gameId "${gameId}" is claimed by multiple "${filter ?? "(no filter)"}" items: ` +
          `${clash.join(", ")}. No slot could tell them apart, so the map would be ambiguous`,
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

      const targets: string[] = [];
      occurrenceTargets(grant.when, targets);
      for (const variant of grant.variants ?? [])
        occurrenceTargets(variant.when, targets);
      for (const tier of grant.tiers ?? []) {
        const named = tier.bonusOccurrences?.bonus;
        if (named !== undefined) targets.push(named);
      }
      for (const target of new Set(targets)) {
        if (target === bonus.id) {
          report(
            "warn",
            `${label}: bonusOccurrences names this bonus itself; omit "bonus"`,
            bonus.id,
            "bonus",
          );
        } else if (!bonusIds.has(target)) {
          report(
            "error",
            `${label}: bonusOccurrences names "${target}", which does not exist`,
            bonus.id,
            "bonus",
          );
        }
      }
    });
  }

  return findings;
}

// `toItemsFile`/`toBonusesFile`/`toSlotsFile` -- regenerating the shipped data/*.json files
// from the composed catalogue -- live in `catalogExport.ts`, not here: that keeps this
// module free of the maintainer-only export code so it can be dynamic-imported and left
// unfetched unless maintainer mode is on (see LayerExportModal.vue).
