// Every mutation that writes the active build's *content* goes through here, and every one of
// them snapshots before mutating -- the history store owns the undo stack.
import { computed, watch } from "vue";
import * as storage from "../storage/storage";
import * as builds from "./builds";
import * as compare from "./compare";
import * as history from "./history";
import { db } from "./resolved";
import { getPath, setPath } from "../lib/build-path";
import type { BuildParameterSlot } from "../types";

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
  const label = id ? (db.value.get(id)?.name ?? id) : "";
  history.snapshot(
    "build",
    b.id,
    `choice:${slotId}`,
    id ? `${slot} → ${label}` : `clear ${slot}`,
    b,
  );
  if (id) {
    b.choices[slotId] = id;
  } else {
    delete b.choices[slotId];
    delete b.values[slotId];
  }
}

export function setValue(slotId: string, raw: string) {
  const b = builds.build.value;
  if (!b) return;
  const shown = raw === "" || raw == null ? "(none)" : raw;
  history.snapshot(
    "build",
    b.id,
    `value:${slotId}`,
    `${slotLabel(slotId)} value → ${shown}`,
    b,
  );
  if (raw === "" || raw == null) delete b.values[slotId];
  else b.values[slotId] = Number(raw);
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
    if (value != null) b.values[slotId] = value;
    else delete b.values[slotId];
  } else {
    delete b.choices[slotId];
    delete b.values[slotId];
  }
}

export function applyValueFromCompare(slotId: string) {
  const other = compare.compareBuild.value;
  if (!other) return;
  const b = builds.build.value;
  if (!b) return;
  const slot = slotLabel(slotId);
  const value = other.values?.[slotId];
  history.snapshot(
    "build",
    b.id,
    `value:${slotId}`,
    `${slot} value → ${value ?? "(none)"} (from "${other.name}")`,
    b,
  );
  if (value != null) b.values[slotId] = value;
  else delete b.values[slotId];
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
  b.choices = {};
  b.values = {};
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

    const choice = source.choices[slot.id];
    if (choice) b.choices[slot.id] = choice;
    else delete b.choices[slot.id];

    const value = source.values[slot.id];
    if (value != null) b.values[slot.id] = value;
    else delete b.values[slot.id];
  }
}
