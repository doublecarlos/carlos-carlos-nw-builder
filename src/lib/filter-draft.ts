// The draft <-> FilterDef conversion for FilterForm.vue (see bonus-draft.ts for the pattern).
//
// Fields are edited as whole `FIELD_GROUPS` entries, the unit the item form shows and hides. A
// field no group covers is kept in `otherFields` so it survives a round trip.
import {
  putIfSet,
  hasValue,
  numberOrUnset,
  arrayDiffLabel,
  fieldDiffLabel,
  type DiffCheck,
} from "./draft-fields";
import { FIELD_GROUPS, type FieldGroup } from "./item-draft";
import type { FilterDef } from "../types";

export interface FilterDraft {
  /** The typed name of a new declaration, turned into an id by `nextFilterId`. Empty for an
   *  existing entry. */
  name: string;
  maxCopies: number | string | null;
  /** Checked `FIELD_GROUPS` entries, as plain strings for the checkbox binding. */
  groups: string[];
  /** Claimed fields no group covers, kept as-is. */
  otherFields: string[];
}

/** One checkbox per `FIELD_GROUPS` entry, ordered and labeled as in the item form. */
export const FIELD_GROUP_OPTIONS: { value: FieldGroup; label: string }[] = [
  { value: "tags", label: "Tags" },
  { value: "gameIds", label: "Internal game IDs" },
  { value: "description", label: "Description" },
  { value: "allowedClass", label: "Class restrictions" },
  { value: "inlineRepetition", label: "Inline repetition" },
  { value: "insignia", label: "Insignia" },
  { value: "insigniaSlots", label: "Insignia slots" },
  { value: "insigniaRecipe", label: "Insignia bonus" },
  { value: "dynamicStats", label: "Dynamic stats" },
  { value: "bonuses", label: "Bonuses" },
  { value: "defaultParams", label: "Default build parameters" },
  { value: "publishes", label: "Published build parameters" },
  { value: "retirement", label: "Retirement" },
];

const GROUP_NAMES = FIELD_GROUP_OPTIONS.map((option) => option.value);

export function buildDraft(filter: FilterDef | null | undefined): FilterDraft {
  const claimed = new Set(filter?.fields ?? []);
  const groups: string[] = [];
  for (const group of GROUP_NAMES) {
    const fields = FIELD_GROUPS[group];
    // A partially claimed group stays unchecked; its fields go to `otherFields`.
    if (!fields.every((field) => claimed.has(field))) continue;
    groups.push(group);
    for (const field of fields) claimed.delete(field);
  }
  return {
    name: "",
    maxCopies: filter?.maxCopies ?? null,
    groups,
    otherFields: [...claimed],
  };
}

/** Whether a brand-new declaration holds anything worth saving. */
export function hasContent(local: FilterDraft): boolean {
  return Boolean(
    local.name.trim() ||
    local.groups.length ||
    local.otherFields.length ||
    hasValue(local.maxCopies),
  );
}

/** The resolved filter id, like `item-draft.ts`'s `ItemDraftContext`. */
export interface FilterDraftContext {
  id: string;
}

export function toFilter(
  local: FilterDraft,
  ctx: FilterDraftContext,
): FilterDef {
  const filter: FilterDef = { id: ctx.id };
  // A typed 0 means uncapped, so only an empty value omits the cap.
  putIfSet(filter, "maxCopies", numberOrUnset(local.maxCopies));
  const checked = new Set(local.groups);
  const fields = [
    ...GROUP_NAMES.filter((group) => checked.has(group)).flatMap(
      (group) => FIELD_GROUPS[group],
    ),
    ...local.otherFields,
  ];
  putIfSet(filter, "fields", [...new Set<string>(fields)]);
  return filter;
}

const CHECKS: DiffCheck<FilterDef>[] = [
  (old, nw) =>
    old.maxCopies !== nw.maxCopies
      ? `edit max copies → ${nw.maxCopies ?? "(none)"}`
      : null,
  (old, nw) =>
    JSON.stringify(old.fields) !== JSON.stringify(nw.fields)
      ? arrayDiffLabel("field", old.fields ?? [], nw.fields ?? [])
      : null,
];

export function diffLabel(oldJson: string, newJson: string): string {
  return fieldDiffLabel(CHECKS, oldJson, newJson, "edit filter");
}
