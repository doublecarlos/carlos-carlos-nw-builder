// Every mutation that writes the active build's *content* goes through here, and every one of
// them snapshots before mutating -- the history store owns the undo stack.
import { computed, watch } from "vue";
import * as storage from "../storage/storage";
import * as builds from "./builds";
import * as compare from "./compare";
import * as history from "./history";
import { db } from "./resolved";
import { getPath, setPath } from "../lib/build-path";
import { deepEqual } from "../lib/deep-equal";
import { repetitionRows } from "../lib/inline-repetition";
import type {
  Build,
  BuildParameterSlot,
  ItemPickerSlot,
  PointAssignmentSlot,
  SectionPreset,
  Slot,
} from "../types";

// Re-export computed accessors so BuildBar.vue etc. can keep importing from buildEditor.
export const canUndo = history.canUndo;
export const canRedo = history.canRedo;
export const undoLabel = history.undoLabel;
export const redoLabel = history.redoLabel;

// Keep the history store's activeKeyOverride in sync with the current build, so the
// undo/redo buttons work even before the selection is set (first load, fresh browser).
watch(
  () => builds.build.value?.id,
  (id) => {
    history.activeKeyOverride.value = id ? `build:${id}` : null;
  },
  { immediate: true },
);

function slotLabel(slotId: string) {
  return db.value.slotById.get(slotId)?.label ?? slotId;
}

export function undo() {
  const b = builds.build.value;
  if (!b) return;
  const json = history.undo("build", b.id, b);
  if (json != null) builds.replaceActive(JSON.parse(json));
}

export function redo() {
  const b = builds.build.value;
  if (!b) return;
  const json = history.redo("build", b.id, b);
  if (json != null) builds.replaceActive(JSON.parse(json));
}

// --- build content edits --------------------------------------------------------------------

export function setChoice(slotId: string, id: string) {
  const b = builds.build.value;
  if (!b) return;
  const slot = slotLabel(slotId);
  const item = id ? db.value.get(id) : undefined;
  const label = id ? (item?.name ?? id) : "";
  history.snapshot(
    "build",
    b.id,
    `choice:${slotId}`,
    id ? `${slot} → ${label}` : `clear ${slot}`,
    b,
  );
  if (id) {
    b.choices[slotId] = id;
    for (const [paramSlotId, value] of Object.entries(
      item?.defaultParams ?? {},
    )) {
      const paramSlot = db.value.slotById.get(paramSlotId);
      if (paramSlot?.type === "build_parameter")
        setPath(b.context, paramSlot.path, value);
    }
  } else {
    delete b.choices[slotId];
    delete b.values[slotId];
    // Same reasoning as `values`: an emptied slot keeps nothing of what was picked there.
    delete b.assignments[slotId];
  }
}

/** Sets one dynamic-stat value at one slot -- `key` is a `dynamicValueKey` (dynamic-stats.ts),
 *  since a slot can carry more than one (an item with several `dynamicStats` entries, or an
 *  item's own entry alongside a bonus's). Clearing the last key at a slot drops the slot's
 *  whole entry rather than leaving an empty object behind. */
export function setDynamicValue(slotId: string, key: string, raw: string) {
  const b = builds.build.value;
  if (!b) return;
  const shown = raw === "" || raw == null ? "(none)" : raw;
  history.snapshot(
    "build",
    b.id,
    `value:${slotId}:${key}`,
    `${slotLabel(slotId)} ${key} → ${shown}`,
    b,
  );
  if (raw === "" || raw == null) {
    if (!b.values[slotId]) return;
    const { [key]: _removed, ...rest } = b.values[slotId];
    if (Object.keys(rest).length) b.values[slotId] = rest;
    else delete b.values[slotId];
  } else {
    b.values[slotId] = { ...b.values[slotId], [key]: Number(raw) };
  }
}

export function applyFromCompare(slotId: string) {
  const other = compare.compareBuild.value;
  if (!other) return;
  const b = builds.build.value;
  if (!b) return;
  const slot = slotLabel(slotId);
  const id = other.choices[slotId] || "";
  const label = id ? (db.value.get(id)?.name ?? id) : "";
  history.snapshot(
    "build",
    b.id,
    `choice:${slotId}`,
    id
      ? `${slot} → ${label} (from "${other.name}")`
      : `clear ${slot} (from "${other.name}")`,
    b,
  );
  if (id) {
    b.choices[slotId] = id;
    const value = other.values?.[slotId];
    if (value != null) b.values[slotId] = { ...value };
    else delete b.values[slotId];
  } else {
    delete b.choices[slotId];
    delete b.values[slotId];
  }
}

/** Copies one dynamic-stat value (`key`, a `dynamicValueKey`) from the compare build --
 *  per-key rather than whole-slot, since a slot can carry several independent values now
 *  (see `setDynamicValue`). */
export function applyValueFromCompare(slotId: string, key: string) {
  const other = compare.compareBuild.value;
  if (!other) return;
  const b = builds.build.value;
  if (!b) return;
  const slot = slotLabel(slotId);
  const value = other.values?.[slotId]?.[key];
  history.snapshot(
    "build",
    b.id,
    `value:${slotId}:${key}`,
    `${slot} ${key} → ${value ?? "(none)"} (from "${other.name}")`,
    b,
  );
  if (value != null) {
    b.values[slotId] = { ...b.values[slotId], [key]: value };
  } else if (b.values[slotId]) {
    const { [key]: _removed, ...rest } = b.values[slotId];
    if (Object.keys(rest).length) b.values[slotId] = rest;
    else delete b.values[slotId];
  }
}

export function setParam(
  slot: BuildParameterSlot,
  value: string | number | boolean,
) {
  const b = builds.build.value;
  if (!b) return;
  const shown =
    typeof value === "boolean"
      ? value
        ? "on"
        : "off"
      : (slot.options?.find((o) => o.value === value)?.label ??
        String(value || "none"));
  history.snapshot(
    "build",
    b.id,
    `param:${slot.id}`,
    `${slot.label} → ${shown}`,
    b,
  );
  setPath(b.context, slot.path, value);
}

export function resetParamToDefault(slot: BuildParameterSlot) {
  const b = builds.build.value;
  if (!b) return;
  history.snapshot(
    "build",
    b.id,
    `param:${slot.id}`,
    `${slot.label} → default`,
    b,
  );
  setPath(b.context, slot.path, slot.default);
}

export function applyParamFromCompare(slot: BuildParameterSlot) {
  const other = compare.compareBuild.value;
  if (!other) return;
  const b = builds.build.value;
  if (!b) return;
  const fromVal = getPath(other.context, slot.path);
  history.snapshot(
    "build",
    b.id,
    `param:${slot.id}`,
    `${slot.label} → ${fromVal ?? "(none)"} (from "${other.name}")`,
    b,
  );
  setPath(b.context, slot.path, fromVal);
}

/** One item's inline-repetition count at one slot. One function for both slot types, since
 *  `Build.assignments` stores them identically -- only their item lists differ. */
export function setAssignment(
  slot: PointAssignmentSlot | ItemPickerSlot,
  itemId: string,
  count: number,
) {
  const b = builds.build.value;
  if (!b) return;
  const item = db.value.get(itemId);
  const label = item?.inlineRepetition?.label ?? item?.name ?? itemId;
  history.snapshot(
    "build",
    b.id,
    `assignment:${slot.id}:${itemId}`,
    `${slot.label} ${label} → ${count}`,
    b,
  );
  b.assignments[slot.id] = { ...b.assignments[slot.id], [itemId]: count };
}

export function resetAssignmentsToDefault(
  slot: PointAssignmentSlot | ItemPickerSlot,
) {
  const b = builds.build.value;
  if (!b) return;
  history.snapshot(
    "build",
    b.id,
    `assignment:${slot.id}`,
    `${slot.label} → default`,
    b,
  );
  const reset: Record<string, number> = {};
  for (const item of repetitionRows(db.value, b, slot))
    reset[item.id] = item.inlineRepetition!.default;
  b.assignments[slot.id] = reset;
}

export function applyAssignmentsFromCompare(
  slot: PointAssignmentSlot | ItemPickerSlot,
) {
  const other = compare.compareBuild.value;
  if (!other) return;
  const b = builds.build.value;
  if (!b) return;
  history.snapshot(
    "build",
    b.id,
    `assignment:${slot.id}`,
    `${slot.label} → values from "${other.name}"`,
    b,
  );
  const applied: Record<string, number> = {};
  // Rows come from *this* build: an item_picker's counts only apply while both builds hold
  // the same pick (`assignmentDiffers`), so every row here exists on the other side too.
  for (const item of repetitionRows(db.value, b, slot)) {
    applied[item.id] =
      other.assignments?.[slot.id]?.[item.id] ?? item.inlineRepetition!.default;
  }
  b.assignments[slot.id] = applied;
}

/**
 * Sets one item's typed occurrence count for one BonusOccurrenceConfig attachment -- `label`
 * is the row's own description of what it's setting (already resolved by the caller, which has
 * the bonus name this store doesn't).
 */
export function setOccurrenceInput(
  itemId: string,
  bonusId: string,
  count: number,
  label: string,
) {
  const b = builds.build.value;
  if (!b) return;
  history.snapshot(
    "build",
    b.id,
    `occurrence:${itemId}:${bonusId}`,
    `${label} → ${count}`,
    b,
  );
  b.occurrenceInputs = {
    ...b.occurrenceInputs,
    [itemId]: { ...b.occurrenceInputs[itemId], [bonusId]: count },
  };
}

/** Copies every one of this item's BonusOccurrenceConfig counts from the compare build --
 *  the occurrence counterpart to `applyAssignmentsFromCompare`. */
export function applyOccurrenceFromCompare(itemId: string) {
  const other = compare.compareBuild.value;
  if (!other) return;
  const b = builds.build.value;
  if (!b) return;
  const item = db.value.get(itemId);
  if (!item) return;
  const there = other.occurrenceInputs?.[itemId] ?? {};
  const applied: Record<string, number> = {};
  for (const attachment of item.bonuses ?? []) {
    if (typeof attachment === "string" || attachment.min === attachment.max)
      continue;
    applied[attachment.bonus] = there[attachment.bonus] ?? attachment.default;
  }
  history.snapshot(
    "build",
    b.id,
    `occurrence:${itemId}`,
    `${item.name} occurrences → values from "${other.name}"`,
    b,
  );
  b.occurrenceInputs = { ...b.occurrenceInputs, [itemId]: applied };
}

export function renameBuild(name: string) {
  const b = builds.build.value;
  if (!b) return;
  history.snapshot("build", b.id, "name", `rename build → "${name}"`, b);
  b.name = name;
}

export const filledSlots = computed(() => {
  const b = builds.build.value;
  return b ? Object.values(b.choices).filter(Boolean).length : 0;
});

export function clearSlots() {
  const b = builds.build.value;
  if (!b) return;
  history.snapshot(
    "build",
    b.id,
    null,
    `clear all ${filledSlots.value} slots`,
    b,
  );
  const fresh = storage.defaultBuild();
  // Not `{}`: a slot with a `default` is "cleared" back to that default, exactly as a
  // build_parameter is.
  b.choices = fresh.choices;
  b.values = {};
  b.assignments = fresh.assignments;
}

export function resetAll() {
  const b = builds.build.value;
  if (!b) return;
  history.snapshot("build", b.id, null, "reset build", b);
  const fresh = storage.defaultBuild(b.name);
  fresh.id = b.id;
  builds.replaceActive(fresh);
}

export function copySection(fromId: string, sectionIds: string[]) {
  const source = builds.builds.value.find((item) => item.id === fromId);
  if (!source) return;

  const b = builds.build.value;
  if (!b) return;

  history.snapshot(
    "build",
    b.id,
    null,
    `copy ${sectionIds.length} section(s) from "${source.name}"`,
    b,
  );
  const wanted = new Set(sectionIds);
  for (const slot of db.value.slots) {
    if (!wanted.has(slot.section)) continue;

    if (slot.type === "build_parameter") {
      setPath(b.context, slot.path, getPath(source.context, slot.path));
      continue;
    }

    if (slot.type === "point_assignment") {
      const rows: Record<string, number> = {};
      for (const item of db.value.forSlot(slot.id)) {
        rows[item.id] =
          source.assignments?.[slot.id]?.[item.id] ??
          item.inlineRepetition!.default;
      }
      b.assignments[slot.id] = rows;
      continue;
    }

    const choice = source.choices[slot.id];
    if (choice) b.choices[slot.id] = choice;
    else delete b.choices[slot.id];

    const value = source.values[slot.id];
    if (value != null) b.values[slot.id] = { ...value };
    else delete b.values[slot.id];

    const repetitions = source.assignments?.[slot.id];
    if (repetitions != null) b.assignments[slot.id] = { ...repetitions };
    else delete b.assignments[slot.id];
  }
}

/** Resets one slot to `defaultBuild()`'s value -- same per-type handling as `copySection`,
 *  just sourced from the built-in defaults instead of another build. `fresh` is passed in so a
 *  caller clearing several slots pays for one `defaultBuild()` rather than one per slot. */
function clearSlot(b: Build, slot: Slot, fresh: Build) {
  if (slot.type === "build_parameter") {
    setPath(b.context, slot.path, getPath(fresh.context, slot.path));
    return;
  }

  if (slot.type === "point_assignment") {
    b.assignments[slot.id] = fresh.assignments[slot.id];
    return;
  }

  const seeded = fresh.choices[slot.id];
  if (seeded) b.choices[slot.id] = seeded;
  else delete b.choices[slot.id];
  delete b.values[slot.id];
  delete b.assignments[slot.id];
}

/** Resets every slot in a section to `defaultBuild()`'s value. */
export function clearSection(sectionId: string, label: string) {
  const b = builds.build.value;
  if (!b) return;

  history.snapshot("build", b.id, null, `clear section "${label}"`, b);
  const fresh = storage.defaultBuild();
  for (const slot of db.value.slots) {
    if (slot.section === sectionId) clearSlot(b, slot, fresh);
  }
}

/**
 * Writes a `SectionPreset`'s defaults into the active build -- a merge, not `copySection`'s
 * full-section replace: only the slots/items a field mentions are written, everything else in
 * the section (and, within a `point_assignment` row, every item the preset doesn't name) is
 * left exactly as it was. One `history.snapshot` covers the whole apply as a single undo step.
 */
export function applyPreset(preset: SectionPreset) {
  const b = builds.build.value;
  if (!b) return;

  history.snapshot("build", b.id, null, `apply preset "${preset.label}"`, b);

  // First, so a slot named by both `clears` and a writing field below still ends up written.
  if (preset.clears?.length) {
    const fresh = storage.defaultBuild();
    for (const slotId of preset.clears) {
      const slot = db.value.slotById.get(slotId);
      if (slot) clearSlot(b, slot, fresh);
    }
  }

  for (const [slotId, value] of Object.entries(preset.params ?? {})) {
    const slot = db.value.slotById.get(slotId);
    if (slot?.type === "build_parameter") setPath(b.context, slot.path, value);
  }

  for (const [slotId, itemId] of Object.entries(preset.choices ?? {})) {
    b.choices[slotId] = itemId;
  }

  for (const [slotId, value] of Object.entries(preset.values ?? {})) {
    b.values[slotId] = { ...b.values[slotId], ...value };
  }

  for (const [slotId, rows] of Object.entries(preset.assignments ?? {})) {
    b.assignments[slotId] = { ...b.assignments[slotId], ...rows };
  }

  // Per-item, not per-slot (see `SectionPreset.occurrences`), and merged per item so a preset
  // naming one of an item's several occurrence configs leaves the others at their current
  // counts -- same per-key merge `values`/`assignments` above already do.
  for (const [itemId, counts] of Object.entries(preset.occurrences ?? {})) {
    b.occurrenceInputs[itemId] = { ...b.occurrenceInputs[itemId], ...counts };
  }
}

/**
 * The inverse of `applyPreset`: snapshots one section of the active build into a
 * `SectionPreset` shape, for BuildSection's "Create new from current" to hand the layer editor
 * as an unsaved draft. Faithful rather than additive -- a slot sitting at its built-in default
 * lands in `clears` instead of being left out, so applying the result reproduces the section as
 * it stands now rather than merging into whatever happened to be there.
 *
 * `id` is left blank: the layer editor allocates one off the label the user finally types.
 */
export function presetFromSection(
  sectionId: string,
  label = "",
): SectionPreset {
  const preset: SectionPreset = { id: "", label, section: sectionId };
  const b = builds.build.value;
  if (!b) return preset;

  const fresh = storage.defaultBuild();
  const params: Record<string, string | number | boolean> = {};
  const choices: Record<string, string> = {};
  const values: Record<string, Record<string, number>> = {};
  const assignments: Record<string, Record<string, number>> = {};
  const occurrences: Record<string, Record<string, number>> = {};
  const clears: string[] = [];

  /** An item the snapshot references carries its own occurrence counts along -- those are
   *  per-item state (see `SectionPreset.occurrences`), so they'd otherwise be lost. */
  function carryOccurrences(itemId: string) {
    const counts = b!.occurrenceInputs[itemId];
    if (counts && Object.keys(counts).length)
      occurrences[itemId] = { ...counts };
  }

  for (const slot of db.value.slots) {
    if (slot.section !== sectionId) continue;

    if (slot.type === "build_parameter") {
      const value = getPath(b.context, slot.path);
      if (value === undefined || value === "") clears.push(slot.id);
      else if (deepEqual(value, getPath(fresh.context, slot.path)))
        clears.push(slot.id);
      else params[slot.id] = value as string | number | boolean;
      continue;
    }

    if (slot.type === "point_assignment") {
      const row = b.assignments[slot.id];
      if (!row || deepEqual(row, fresh.assignments[slot.id])) {
        clears.push(slot.id);
        continue;
      }
      assignments[slot.id] = { ...row };
      for (const itemId of Object.keys(row)) carryOccurrences(itemId);
      continue;
    }

    if (slot.type !== "item_picker") continue;

    const choice = b.choices[slot.id];
    const value = b.values[slot.id];
    const repetitions = b.assignments[slot.id];
    const atDefault =
      choice === (fresh.choices[slot.id] ?? "") &&
      !Object.keys(value ?? {}).length &&
      !Object.keys(repetitions ?? {}).length;
    // Only when nothing hangs off the pick: `clears` would drop a magnitude or repetition
    // count the player did set.
    if (atDefault) {
      clears.push(slot.id);
      continue;
    }
    if (!choice) {
      clears.push(slot.id);
      continue;
    }
    choices[slot.id] = choice;
    carryOccurrences(choice);
    if (value && Object.keys(value).length) values[slot.id] = { ...value };
    // An `item_picker` pick that repeats inline carries its count the same way a
    // point_assignment row does -- same field, same shape.
    if (repetitions && Object.keys(repetitions).length)
      assignments[slot.id] = { ...repetitions };
  }

  if (Object.keys(params).length) preset.params = params;
  if (Object.keys(choices).length) preset.choices = choices;
  if (Object.keys(values).length) preset.values = values;
  if (Object.keys(assignments).length) preset.assignments = assignments;
  if (Object.keys(occurrences).length) preset.occurrences = occurrences;
  if (clears.length) preset.clears = clears;

  return preset;
}

/** `presetFromSection` re-taken into an existing preset's identity: same id, label and section,
 *  contents replaced wholesale by the section as it stands now. What the preset menu's
 *  per-preset "Update from current" writes back. */
export function presetUpdatedFromSection(preset: SectionPreset): SectionPreset {
  return { ...presetFromSection(preset.section, preset.label), id: preset.id };
}
