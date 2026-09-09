// The draft <-> SectionPreset conversion for PresetForm.vue, the same pattern bonus-draft.ts
// and item-draft.ts already carry for their own entities (see bonus-draft.ts's header comment).
//
// `occurrences` is the one field with no row list of its own: it is keyed by item, not by slot
// (see `SectionPreset.occurrences`), so it is authored inline on whichever row put that item on
// screen (an item row's own pick, or a point_assignment row's items) into one draft-wide map.
// `authoredItemIdsOf` needs `Db.forSlot` to resolve that, so both it and `toPreset` (which
// calls it) take a `Db` in their context rather than reading `props.db` directly.
import {
  entriesToRows,
  rowsToEntries,
  putIfSet,
  numberOrUnset,
  fieldDiffLabel,
  type DiffCheck,
} from "./draft-fields";
import type { SectionPreset, Db } from "../types";

interface ParamRow {
  slotId: string;
  value: string | number | boolean;
}
interface ItemRow {
  slotId: string;
  choice: string;
  /** One entry per dynamic-stat config the chosen item declares, keyed by `dynamicValueKey`,
   *  same shape `Build.values[slotId]` stores, since a preset just seeds that. */
  values: Record<string, number | string | null>;
}
interface AssignmentRow {
  slotId: string;
  counts: Record<string, number>;
}
interface ClearRow {
  slotId: string;
}

export interface PresetDraft {
  label: string;
  section: string;
  paramRows: ParamRow[];
  itemRows: ItemRow[];
  assignmentRows: AssignmentRow[];
  clearRows: ClearRow[];
  /** Item id to bonus id to count, draft-wide rather than per row, mirroring the field it
   *  writes (see the module comment). */
  occurrences: Record<string, Record<string, number>>;
}

export function buildDraft(
  preset: SectionPreset | null | undefined,
): PresetDraft {
  const source = preset ?? ({} as Partial<SectionPreset>);
  return {
    label: source.label ?? "",
    section: source.section ?? "",
    paramRows: entriesToRows(source.params, (slotId, value) => ({
      slotId,
      value,
    })),
    itemRows: entriesToRows(source.choices, (slotId, choice) => ({
      slotId,
      choice,
      values: { ...(source.values?.[slotId] ?? {}) },
    })),
    assignmentRows: entriesToRows(source.assignments, (slotId, counts) => ({
      slotId,
      counts: { ...counts },
    })),
    clearRows: (source.clears ?? []).map((slotId) => ({ slotId })),
    occurrences: Object.fromEntries(
      Object.entries(source.occurrences ?? {}).map(([itemId, counts]) => [
        itemId,
        { ...counts },
      ]),
    ),
  };
}

/** Every item the form currently offers occurrence inputs for: each item row's own pick, plus
 *  every item a point_assignment row lists (that row renders a set of inputs per item, the same
 *  as the build editor's own). What `toPreset` keeps `occurrences` entries for. */
function authoredItemIdsOf(local: PresetDraft, db: Db): Set<string> {
  const ids = new Set<string>();
  for (const row of local.itemRows) if (row.choice) ids.add(row.choice);
  for (const row of local.assignmentRows) {
    if (!row.slotId) continue;
    for (const item of db.forSlot(row.slotId)) ids.add(item.id);
  }
  return ids;
}

/** Resolved preset id, threaded in the same way `item-draft.ts`'s `ItemDraftContext` is: the
 *  source's own once one exists, otherwise whatever the form's `computeId` worked out. `db` is
 *  needed only for `authoredItemIdsOf`'s slot lookup. */
export interface PresetDraftContext {
  id: string;
  db: Db;
}

export function toPreset(
  local: PresetDraft,
  ctx: PresetDraftContext,
): SectionPreset {
  const preset: SectionPreset = {
    id: ctx.id,
    label: local.label.trim(),
    section: local.section,
  };

  putIfSet(
    preset,
    "params",
    rowsToEntries(
      local.paramRows,
      (row) => row.slotId,
      (row) => row.value,
    ),
  );

  // Two fields at once per row (`choices`/`values`), so this stays a plain loop rather than
  // `rowsToEntries`, which is for one record per row list, not two filtered together.
  const choices: Record<string, string> = {};
  const values: Record<string, Record<string, number>> = {};
  for (const row of local.itemRows) {
    if (!row.slotId || !row.choice) continue;
    choices[row.slotId] = row.choice;
    const rowValues: Record<string, number> = {};
    for (const [key, raw] of Object.entries(row.values)) {
      const number = numberOrUnset(raw);
      if (number !== undefined) rowValues[key] = number;
    }
    if (Object.keys(rowValues).length) values[row.slotId] = rowValues;
  }
  putIfSet(preset, "choices", choices);
  putIfSet(preset, "values", values);

  const assignments: Record<string, Record<string, number>> = {};
  for (const row of local.assignmentRows) {
    if (!row.slotId || !Object.keys(row.counts).length) continue;
    assignments[row.slotId] = { ...row.counts };
  }
  putIfSet(preset, "assignments", assignments);

  const occurrences: Record<string, Record<string, number>> = {};
  for (const itemId of authoredItemIdsOf(local, ctx.db)) {
    const counts = local.occurrences[itemId];
    if (!counts) continue;
    const kept = Object.fromEntries(
      Object.entries(counts).filter(([, count]) => Number.isFinite(count)),
    );
    if (Object.keys(kept).length) occurrences[itemId] = kept;
  }
  putIfSet(preset, "occurrences", occurrences);

  putIfSet(preset, "clears", [
    ...new Set(local.clearRows.map((row) => row.slotId).filter(Boolean)),
  ]);

  return preset;
}

const CHECKS: DiffCheck<SectionPreset>[] = [
  (old, nw) => (old.label !== nw.label ? `edit label → "${nw.label}"` : null),
  (old, nw) =>
    old.section !== nw.section ? `edit section → "${nw.section}"` : null,
  (old, nw) =>
    JSON.stringify(old.params) !== JSON.stringify(nw.params)
      ? "edit params"
      : null,
  (old, nw) =>
    JSON.stringify(old.choices) !== JSON.stringify(nw.choices) ||
    JSON.stringify(old.values) !== JSON.stringify(nw.values)
      ? "edit item choices"
      : null,
  (old, nw) =>
    JSON.stringify(old.assignments) !== JSON.stringify(nw.assignments)
      ? "edit point assignments"
      : null,
  (old, nw) =>
    JSON.stringify(old.occurrences) !== JSON.stringify(nw.occurrences)
      ? "edit bonus occurrences"
      : null,
  (old, nw) =>
    JSON.stringify(old.clears) !== JSON.stringify(nw.clears)
      ? "edit cleared slots"
      : null,
];

export function diffLabel(oldJson: string, newJson: string): string {
  return fieldDiffLabel(CHECKS, oldJson, newJson, "edit preset");
}
