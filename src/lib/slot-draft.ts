// The draft <-> BuildParameterSlot conversion for SlotForm.vue, the same pattern
// bonus-draft.ts/item-draft.ts/preset-draft.ts already carry for their own entities (see
// bonus-draft.ts's header comment).
//
// `passthrough` is Slot's own wrinkle: fields the form doesn't edit (`visibleWhen` today) must
// be *preserved*, not dropped, since editing a shipped param's label must not silently un-scope
// it; every other draft here drops what it doesn't recognize, this one inverts that. It has to
// live alongside the draft rather than inside it (`buildDraft` returns only the `SlotDraft`
// shape `useEditorDraft` diffs/undoes), so `toSlot` takes it as part of its context.
import {
  putIfSet,
  numberOrUnset,
  fieldDiffLabel,
  type DiffCheck,
} from "./draft-fields";
import type { BuildParameterSlot, Db } from "../types";

export interface OptionRow {
  value: string;
  label: string;
}

export interface SlotDraft {
  label: string;
  section: string;
  paramType: BuildParameterSlot["paramType"];
  path: string;
  quick: boolean;
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
}

/** Fields the form does not edit, kept aside and re-attached by `toSlot`. Returned by
 *  `buildDraft` alongside the draft since `SlotDraft` itself is what `useEditorDraft`
 *  diffs/undoes and has no room for it. */
export function passthroughOf(
  slot: BuildParameterSlot | null | undefined,
): Partial<BuildParameterSlot> {
  const {
    id: _id,
    label: _label,
    section: _section,
    type: _type,
    paramType: _paramType,
    path: _path,
    quick: _quick,
    default: _default,
    options: _options,
    min: _min,
    max: _max,
    step: _step,
    presets: _presets,
    optionsFrom: _optionsFrom,
    allowEmpty: _allowEmpty,
    ...rest
  } = slot ?? ({} as Partial<BuildParameterSlot>);
  return rest;
}

export function buildDraft(
  slot: BuildParameterSlot | null | undefined,
): SlotDraft {
  const {
    label,
    section,
    paramType,
    path,
    quick,
    default: fallback,
    options,
    min,
    max,
    step,
    presets,
    optionsFrom,
    allowEmpty,
  } = slot ?? ({} as Partial<BuildParameterSlot>);
  return {
    label: label ?? "",
    section: section ?? "",
    paramType: paramType ?? "number",
    path: path ?? "",
    quick: quick ?? false,
    default: fallback == null ? "" : String(fallback),
    optionsSource: optionsFrom
      ? optionsFrom.tags?.length
        ? "tags"
        : "filter"
      : "inline",
    options: (options ?? []).map((option) => ({
      value: option.value,
      label: option.label,
    })),
    optionsFromTags: (optionsFrom?.tags ?? []).join(", "),
    optionsFromFilter: optionsFrom?.filter ?? "",
    allowEmpty: allowEmpty ?? false,
    min: min == null ? "" : String(min),
    max: max == null ? "" : String(max),
    step: step == null ? "" : String(step),
    presets: (presets ?? []).join(", "),
  };
}

export const isNumeric = (paramType: BuildParameterSlot["paramType"]) =>
  paramType === "number" || paramType === "percent";

/** `Number(raw)` when the string/number holds a real value, else `undefined`: like
 *  `numberOrUnset`, but a slot draft's numeric fields are `string | number`, never `null`,
 *  since they start as ordinary text fields rather than a cleared-to-null number input. */
const number = (raw: string | number): number | undefined =>
  numberOrUnset(raw === "" ? null : raw);

/** Resolved slot id, threaded the same way `item-draft.ts`'s `ItemDraftContext` is: the
 *  source's own once one exists, otherwise whatever the form's `computeId` worked out. */
export interface SlotDraftContext {
  id: string;
  passthrough: Partial<BuildParameterSlot>;
}

export function toSlot(
  local: SlotDraft,
  ctx: SlotDraftContext,
): BuildParameterSlot {
  const slot: BuildParameterSlot = {
    ...ctx.passthrough,
    id: ctx.id,
    label: local.label.trim(),
    section: local.section,
    type: "build_parameter",
    paramType: local.paramType,
    path: local.path.trim(),
  };
  if (local.quick) slot.quick = true;

  // `default` is typed by `paramType`, not by what the text field happens to hold: a boolean
  // param storing the string "true" would compare unequal to `true` everywhere downstream.
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
  } else {
    slot.default = String(local.default);
    if (local.optionsSource === "inline") {
      const options = local.options
        .filter((row) => row.label.trim())
        .map((row) => ({
          value: row.value,
          label: row.label.trim(),
        }));
      putIfSet(slot, "options", options);
    } else {
      slot.optionsFrom =
        local.optionsSource === "tags"
          ? {
              tags: local.optionsFromTags
                .split(",")
                .map((tag) => tag.trim())
                .filter(Boolean),
            }
          : { filter: local.optionsFromFilter.trim() };
      if (local.allowEmpty) slot.allowEmpty = true;
    }
  }
  return slot;
}

const CHECKS: DiffCheck<BuildParameterSlot>[] = [
  (old, nw) => (old.label !== nw.label ? `edit label to "${nw.label}"` : null),
  (old, nw) => (old.path !== nw.path ? `edit path to "${nw.path}"` : null),
  (old, nw) =>
    old.paramType !== nw.paramType ? `edit type to "${nw.paramType}"` : null,
  (old, nw) =>
    JSON.stringify(old.options) !== JSON.stringify(nw.options)
      ? "edit options"
      : null,
  (old, nw) => (old.default !== nw.default ? "edit default" : null),
];

export function diffLabel(oldJson: string, newJson: string): string {
  return fieldDiffLabel(CHECKS, oldJson, newJson, "edit parameter");
}

/** The other slot already sitting on this `path`, if any. Two slots sharing a path silently
 * fight over one value in `context`, so this blocks the save outright rather than leaving it
 * to the lint drawer to report after the damage is saved. */
export function findPathConflict(
  local: SlotDraft,
  db: Db,
  ownId: string,
): string | null {
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
