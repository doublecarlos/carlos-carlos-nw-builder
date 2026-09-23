// The draft <-> Slot conversion for SlotForm.vue (see bonus-draft.ts for the pattern).
//
// One draft covers every `Slot` variant: a `type` plus the union of all variants' fields.
// `toSlot` writes only the active type's fields, and `TYPE_FIELDS` says which blocks each type
// shows.
import {
  putIfSet,
  numberOrUnset,
  fieldDiffLabel,
  type DiffCheck,
} from "./draft-fields";
import {
  whenToRows,
  rowsToWhen,
  whenRowsComplete,
  whenIsRepresentable,
  type ConditionRow,
} from "../engine/condition-draft";
import { STABLE_ROLE_FILTER, validateSlotDefaults } from "../data/catalog";
import type {
  BuildParameterSlot,
  ConditionWhen,
  Db,
  ItemPickerListSlot,
  ItemPickerSlot,
  PointAssignmentSlot,
  SeparatorSlot,
  Slot,
  StableRole,
  TextSlot,
} from "../types";

type Scaler = NonNullable<BuildParameterSlot["scaler"]>;

export interface OptionRow {
  value: string;
  label: string;
}

/** The field blocks each slot type is authored with, rendered in order by the form. */
export type SlotFieldGroup =
  | "param"
  | "selector"
  | "filter"
  | "itemDefault"
  | "pickerFlags"
  | "toggleable"
  | "defaultRows"
  | "stable"
  | "text";

export const TYPE_FIELDS: Record<Slot["type"], SlotFieldGroup[]> = {
  build_parameter: ["param"],
  item_picker: ["selector", "itemDefault", "pickerFlags", "stable"],
  item_picker_list: ["selector", "defaultRows", "toggleable"],
  point_assignment: ["filter"],
  separator: [],
  text: ["text"],
};

/** The type picker's options, in order. */
export const SLOT_TYPE_OPTIONS: { value: Slot["type"]; label: string }[] = [
  { value: "build_parameter", label: "build parameter" },
  { value: "item_picker", label: "item picker" },
  { value: "item_picker_list", label: "item picker list" },
  { value: "point_assignment", label: "point assignment" },
  { value: "separator", label: "separator" },
  { value: "text", label: "text" },
];

/** What a message calls a slot of this type. */
export function nounOf(type: Slot["type"]): string {
  return type === "build_parameter" ? "parameter" : "slot";
}

/** Types that render their label, so it is required. Separators and text slots don't. */
const LABELED_TYPES: readonly Slot["type"][] = [
  "build_parameter",
  "item_picker",
  "item_picker_list",
  "point_assignment",
];

export interface SlotDraft {
  type: Slot["type"];
  label: string;
  section: string;
  /** `visibleWhen` as condition rows, or as raw JSON when the rows cannot express it. */
  whenMode: "rows" | "json";
  when: ConditionRow[];
  whenJson: string;
  // --- build_parameter --------------------------------------------------------------------
  paramType: BuildParameterSlot["paramType"];
  path: string;
  /** Held loosely in the draft: `toSlot` casts back per `paramType`, so switching type
   *  mid-edit can't leave a number sitting in a boolean's `default`. `string | number`
   *  rather than `string` because Vue's `v-model` casts to a number by itself on an
   *  `<input type="number">`, so these fields start as strings and become numbers as soon
   *  as they are typed into. */
  default: string | number;
  /** Which way the option set is authored. A three-way choice rather than two independent
   *  fields so `options` XOR `optionsFrom`, and `filter` XOR `tags` within it, are structurally
   *  impossible to violate from this form; `validateSlots` still enforces both for data
   *  arriving from a file. */
  optionsSource: "inline" | "tags" | "filter";
  options: OptionRow[];
  optionsFromTags: string;
  optionsFromFilter: string;
  allowEmpty: boolean;
  min: string | number;
  max: string | number;
  step: string | number;
  presets: string;
  /** Empty means the parameter is not a scaler; see `BuildParameterSlot.scaler`. The filter
   *  and tag lists are comma-separated like `optionsFromTags`. */
  scalerMode: "" | Scaler["mode"];
  scalerFilters: string;
  scalerTags: string;
  // --- item_picker / item_picker_list / point_assignment -----------------------------------
  /** `filter` XOR `tags`, shaped like `optionsSource`. `point_assignment` always uses a filter. */
  selectorSource: "filter" | "tags";
  filter: string;
  tags: string;
  // --- item_picker -------------------------------------------------------------------------
  /** The item id a new build starts on, kept apart from the param `default`. */
  itemDefault: string;
  disallowEmpty: boolean;
  hidePreview: boolean;
  /** Shared with `item_picker_list`, which hands it to every row. */
  toggleable: boolean;
  /** Shared with `build_parameter`: both render in the quick strip. */
  quick: boolean;
  /** Empty when the row is not part of the stable. */
  stableRole: "" | StableRole;
  stableGroup: string | number;
  stableIndex: string | number;
  // --- item_picker_list ---------------------------------------------------------------------
  defaultRows: string | number;
  // --- text ---------------------------------------------------------------------------------
  text: string;
}

/** Every variant's fields, all optional. `type` and `default` differ per variant, so they are
 *  read off the narrowed slot instead. */
type SlotFields = Partial<
  Omit<ItemPickerSlot, "type" | "default"> &
    Omit<ItemPickerListSlot, "type"> &
    Omit<BuildParameterSlot, "type" | "default"> &
    Omit<PointAssignmentSlot, "type"> &
    Omit<SeparatorSlot, "type"> &
    Omit<TextSlot, "type">
>;

export function buildDraft(slot: Slot | null | undefined): SlotDraft {
  const source = (slot ?? {}) as SlotFields;
  const representable = whenIsRepresentable(source.visibleWhen);
  return {
    type: slot?.type ?? "build_parameter",
    label: source.label ?? "",
    section: source.section ?? "",
    whenMode: representable ? "rows" : "json",
    when: representable ? whenToRows(source.visibleWhen) : [],
    whenJson: source.visibleWhen
      ? JSON.stringify(source.visibleWhen, null, 2)
      : "",
    paramType: source.paramType ?? "number",
    path: source.path ?? "",
    default:
      slot?.type === "build_parameter" && slot.default != null
        ? String(slot.default)
        : "",
    optionsSource: source.optionsFrom
      ? source.optionsFrom.tags?.length
        ? "tags"
        : "filter"
      : "inline",
    options: (source.options ?? []).map((option) => ({
      value: option.value,
      label: option.label,
    })),
    optionsFromTags: (source.optionsFrom?.tags ?? []).join(", "),
    optionsFromFilter: source.optionsFrom?.filter ?? "",
    allowEmpty: source.allowEmpty ?? false,
    min: source.min == null ? "" : String(source.min),
    max: source.max == null ? "" : String(source.max),
    step: source.step == null ? "" : String(source.step),
    presets: (source.presets ?? []).join(", "),
    scalerMode: source.scaler?.mode ?? "",
    scalerFilters: (source.scaler?.applies?.filter ?? []).join(", "),
    scalerTags: (source.scaler?.applies?.tags ?? []).join(", "),
    selectorSource: source.tags?.length ? "tags" : "filter",
    filter: source.filter ?? "",
    tags: (source.tags ?? []).join(", "),
    itemDefault: slot?.type === "item_picker" ? (slot.default ?? "") : "",
    disallowEmpty: source.disallowEmpty ?? false,
    hidePreview: source.hidePreview ?? false,
    toggleable: source.toggleable ?? false,
    quick: source.quick ?? false,
    stableRole: source.stable?.role ?? "",
    stableGroup:
      source.stable?.group == null ? "" : String(source.stable.group),
    stableIndex:
      source.stable?.index == null ? "" : String(source.stable.index),
    defaultRows: source.defaultRows == null ? "" : String(source.defaultRows),
    text: source.text ?? "",
  };
}

/** Whether a brand-new draft holds anything worth saving. */
export function hasContent(local: SlotDraft): boolean {
  return Boolean(
    local.label.trim() ||
    local.path.trim() ||
    local.filter.trim() ||
    local.tags.trim() ||
    local.text.trim(),
  );
}

export const isNumeric = (paramType: BuildParameterSlot["paramType"]) =>
  paramType === "number" || paramType === "percent";

/** `Number(raw)` when the string/number holds a real value, else `undefined`: like
 *  `numberOrUnset`, but a slot draft's numeric fields are `string | number`, never `null`,
 *  since they start as ordinary text fields rather than a cleared-to-null number input. */
const number = (raw: string | number): number | undefined =>
  numberOrUnset(raw === "" ? null : raw);

const commaList = (raw: string): string[] =>
  raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

/** Resolved slot id, threaded the same way `item-draft.ts`'s `ItemDraftContext` is: the
 *  source's own once one exists, otherwise whatever the form's `computeId` worked out. */
export interface SlotDraftContext {
  id: string;
}

/** The authored `visibleWhen`, or undefined. Throws on invalid JSON, which `save()` reports. */
function visibleWhenOf(local: SlotDraft): ConditionWhen | undefined {
  if (local.whenMode === "json") {
    const text = local.whenJson.trim();
    if (!text) return undefined;
    return JSON.parse(text) as ConditionWhen;
  }
  const when = rowsToWhen(local.when);
  return Object.keys(when).length ? when : undefined;
}

/** The `filter` XOR `tags` selector the three item-selecting types share. */
function putSelector(
  slot: { filter?: string; tags?: string[] },
  local: SlotDraft,
) {
  if (local.selectorSource === "tags")
    putIfSet(slot, "tags", commaList(local.tags));
  else putIfSet(slot, "filter", local.filter.trim());
}

/** Fields common to every variant. */
interface SlotCommon {
  id: string;
  section: string;
  label: string;
  visibleWhen?: ConditionWhen;
}

/** One builder per slot type, each writing only its own type's fields. */
const BUILDERS: {
  [T in Slot["type"]]: (
    local: SlotDraft,
    common: SlotCommon,
  ) => Extract<Slot, { type: T }>;
} = {
  build_parameter: (local, common) => {
    const slot: BuildParameterSlot = {
      id: common.id,
      label: common.label,
      section: common.section,
      type: "build_parameter",
      paramType: local.paramType,
      path: local.path.trim(),
    };
    putIfSet(slot, "visibleWhen", common.visibleWhen);
    if (local.quick) slot.quick = true;

    // Cast `default` by `paramType`, so a boolean param never stores the string "true".
    if (local.paramType === "boolean") {
      slot.default = String(local.default) === "true";
    } else if (isNumeric(local.paramType)) {
      putIfSet(slot, "default", number(local.default));
      putIfSet(slot, "min", number(local.min));
      putIfSet(slot, "max", number(local.max));
      putIfSet(slot, "step", number(local.step));
      const presets = local.presets
        .split(",")
        .map((part) => number(part))
        .filter((value): value is number => value !== undefined);
      putIfSet(slot, "presets", presets);
      if (local.scalerMode) {
        const applies: NonNullable<Scaler["applies"]> = {};
        putIfSet(applies, "filter", commaList(local.scalerFilters));
        putIfSet(applies, "tags", commaList(local.scalerTags));
        slot.scaler = { mode: local.scalerMode };
        putIfSet(slot.scaler, "applies", applies);
      }
    } else {
      slot.default = String(local.default);
      if (local.optionsSource === "inline") {
        const options = local.options
          .filter((row) => row.label.trim())
          .map((row) => ({ value: row.value, label: row.label.trim() }));
        putIfSet(slot, "options", options);
      } else {
        slot.optionsFrom =
          local.optionsSource === "tags"
            ? { tags: commaList(local.optionsFromTags) }
            : { filter: local.optionsFromFilter.trim() };
        if (local.allowEmpty) slot.allowEmpty = true;
      }
    }
    return slot;
  },
  item_picker: (local, common) => {
    const slot: ItemPickerSlot = {
      id: common.id,
      label: common.label,
      section: common.section,
      type: "item_picker",
    };
    putIfSet(slot, "visibleWhen", common.visibleWhen);
    putSelector(slot, local);
    putIfSet(slot, "default", local.itemDefault.trim());
    if (local.disallowEmpty) slot.disallowEmpty = true;
    if (local.hidePreview) slot.hidePreview = true;
    if (local.toggleable) slot.toggleable = true;
    if (local.quick) slot.quick = true;
    if (local.stableRole) {
      const group = number(local.stableGroup);
      slot.stable = { group: group ?? 0, role: local.stableRole };
      putIfSet(slot.stable, "index", number(local.stableIndex));
    }
    return slot;
  },
  item_picker_list: (local, common) => {
    const slot: ItemPickerListSlot = {
      id: common.id,
      label: common.label,
      section: common.section,
      type: "item_picker_list",
    };
    putIfSet(slot, "visibleWhen", common.visibleWhen);
    putSelector(slot, local);
    putIfSet(slot, "defaultRows", number(local.defaultRows));
    if (local.toggleable) slot.toggleable = true;
    return slot;
  },
  point_assignment: (local, common) => {
    const slot: PointAssignmentSlot = {
      id: common.id,
      label: common.label,
      section: common.section,
      type: "point_assignment",
      filter: local.filter.trim(),
    };
    putIfSet(slot, "visibleWhen", common.visibleWhen);
    return slot;
  },
  separator: (_local, common) => {
    const slot: SeparatorSlot = {
      id: common.id,
      section: common.section,
      type: "separator",
    };
    putIfSet(slot, "visibleWhen", common.visibleWhen);
    putIfSet(slot, "label", common.label);
    return slot;
  },
  text: (local, common) => {
    const slot: TextSlot = {
      id: common.id,
      section: common.section,
      type: "text",
      text: local.text.trim(),
    };
    putIfSet(slot, "visibleWhen", common.visibleWhen);
    putIfSet(slot, "label", common.label);
    return slot;
  },
};

export function toSlot(local: SlotDraft, ctx: SlotDraftContext): Slot {
  const common: SlotCommon = {
    id: ctx.id,
    section: local.section,
    label: local.label.trim(),
    visibleWhen: visibleWhenOf(local),
  };
  return BUILDERS[local.type](local, common);
}

const CHECKS: DiffCheck<Slot>[] = [
  (old, nw) => (old.type !== nw.type ? `edit type to "${nw.type}"` : null),
  (old, nw) => (old.label !== nw.label ? `edit label to "${nw.label}"` : null),
  (old, nw) =>
    old.section !== nw.section ? `move to section "${nw.section}"` : null,
  (old, nw) =>
    JSON.stringify(old.visibleWhen) !== JSON.stringify(nw.visibleWhen)
      ? "edit visibility condition"
      : null,
  (old, nw) =>
    (old as BuildParameterSlot).path !== (nw as BuildParameterSlot).path
      ? `edit path to "${(nw as BuildParameterSlot).path}"`
      : null,
  (old, nw) =>
    (old as BuildParameterSlot).paramType !==
    (nw as BuildParameterSlot).paramType
      ? `edit value type to "${(nw as BuildParameterSlot).paramType}"`
      : null,
  (old, nw) =>
    JSON.stringify((old as ItemPickerSlot).filter) !==
      JSON.stringify((nw as ItemPickerSlot).filter) ||
    JSON.stringify((old as ItemPickerSlot).tags) !==
      JSON.stringify((nw as ItemPickerSlot).tags)
      ? "edit item filter or tags"
      : null,
  (old, nw) =>
    JSON.stringify((old as BuildParameterSlot).options) !==
    JSON.stringify((nw as BuildParameterSlot).options)
      ? "edit options"
      : null,
  (old, nw) =>
    (old as TextSlot).text !== (nw as TextSlot).text ? "edit text" : null,
  (old, nw) =>
    (old as BuildParameterSlot).default !== (nw as BuildParameterSlot).default
      ? "edit default"
      : null,
  (old, nw) =>
    JSON.stringify((old as ItemPickerSlot).stable) !==
    JSON.stringify((nw as ItemPickerSlot).stable)
      ? "edit stable settings"
      : null,
  (old, nw) =>
    JSON.stringify((old as BuildParameterSlot).scaler) !==
    JSON.stringify((nw as BuildParameterSlot).scaler)
      ? "edit scaler"
      : null,
];

export function diffLabel(oldJson: string, newJson: string): string {
  return fieldDiffLabel(CHECKS, oldJson, newJson, "edit slot");
}

/** The other slot already sitting on this `path`, if any. Two slots sharing a path silently
 * fight over one value in `context`, so this blocks the save outright rather than leaving it
 * to the lint drawer to report after the damage is saved. */
export function findPathConflict(
  local: SlotDraft,
  db: Db,
  ownId: string,
): string | null {
  if (local.type !== "build_parameter") return null;
  const path = local.path.trim();
  if (!path) return null;
  const clash = db.slots.find(
    (slot) =>
      slot.type === "build_parameter" &&
      slot.path === path &&
      slot.id !== ownId,
  );
  return clash ? clash.id : null;
}

/**
 * Why this draft cannot be saved yet, or null when it can. Gates both the live-edit emit and
 * Save, and reuses the lint's own checks where they apply.
 */
export function slotSaveError(
  local: SlotDraft,
  db: Db,
  ownId: string,
): string | null {
  const noun = nounOf(local.type);
  if (!local.section) return `The ${noun} needs a section.`;
  if (LABELED_TYPES.includes(local.type) && !local.label.trim())
    return `The ${noun} needs a label.`;

  if (local.whenMode === "json") {
    try {
      const text = local.whenJson.trim();
      if (text) JSON.parse(text);
    } catch (err: unknown) {
      return `"Shown when" is not valid JSON: ${err instanceof Error ? err.message : String(err)}`;
    }
  } else if (!whenRowsComplete(local.when)) {
    return "Finish or remove the half-filled condition under “Shown when”.";
  }

  if (local.type === "build_parameter") {
    if (!local.path.trim()) return "The parameter needs a path.";
    const clash = findPathConflict(local, db, ownId);
    if (clash)
      return `Path "${local.path.trim()}" is already used by ${clash}; the two would silently share one value.`;
  }
  if (local.type === "point_assignment" && !local.filter.trim())
    return "The slot needs an item filter.";
  if (local.type === "text" && !local.text.trim())
    return "The slot needs some text.";
  if (local.type === "item_picker" || local.type === "item_picker_list") {
    const hasSelector =
      local.selectorSource === "tags"
        ? commaList(local.tags).length > 0
        : Boolean(local.filter.trim());
    if (!hasSelector) return "The slot needs an item filter or tags.";
  }
  if (local.type === "item_picker" && local.stableRole) {
    const wanted = STABLE_ROLE_FILTER[local.stableRole];
    if (local.selectorSource !== "filter" || local.filter.trim() !== wanted)
      return `A stable "${local.stableRole}" row must select the "${wanted}" filter.`;
    if (number(local.stableGroup) === undefined)
      return "A stable row needs a group number.";
    if (
      local.stableRole === "insignia" &&
      number(local.stableIndex) === undefined
    )
      return "A stable insignia row needs a position.";
  }

  const slot = toSlot(local, { id: ownId });
  if (slot.type === "item_picker" && slot.default) {
    const [finding] = validateSlotDefaults([slot], db.items);
    if (finding) return finding.message;
  }
  return null;
}
