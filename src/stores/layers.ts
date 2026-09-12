// Layers: named catalog overlays that can be toggled on/off independently. The engine
// folds every enabled layer's overlay (plus the active build's catalog) on top of the
// base catalog. The list reads highest-priority first: the topmost layer wins.
//
// Creating, duplicating, deleting, moving, renaming and enabling layers each record one step
// on the nav undo stack (`navHistory.ts`); overlay edits stay on the layer's own content
// stack. A layer leaving the pool always goes through the trash, so undoing a create and
// undoing a delete are the same two primitives run in opposite directions: `trashLayer` and
// `restoreLayer`. Neither records anything.
import { computed, ref } from "vue";
import { useDebounceFn } from "@vueuse/core";
import { reorderIndex } from "../composables/useDragAndDrop";
import * as storage from "../storage/storage";
import * as history from "./history";
import * as navHistory from "./navHistory";
import type { NavStepOutcome } from "./navHistory";
import * as trash from "./trash";
import * as selection from "./selection";
import { layerOrder, persistMeta } from "./meta";
import { flagStorageFailed, showNotice, showUndoNotice } from "./notice";
import * as catalog from "../data/catalog";
import type { Layer, CatalogOverlay, SectionPreset } from "../types";

const SAVE_DEBOUNCE_MS = 250;

const _layers = ref<Map<string, Layer>>(new Map());

export const layers = computed(() =>
  layerOrder.value.map((id) => _layers.value.get(id)!).filter(Boolean),
);

/** Enabled layers in fold order, for the engine to fold over the base catalog. Reversed
 * against the displayed order: folding last is what wins, and the top layer has priority. */
export const enabledOverlays = computed(() =>
  layers.value
    .filter((l) => l.enabled)
    .map((l) => l.overlay)
    .reverse(),
);

/** The id of the last layer the user selected, for ensureTargetLayer. */
const _lastLayerId = ref<string | null>(null);

/** The layer an edit would be written to, or null when one would have to be created: the
 * last-selected one, else the top (highest-priority) one -- the top so the edit written there
 * is not shadowed by another layer. Side-effect free, so the UI can name it before the edit
 * commits to creating one. */
export const targetLayer = computed<Layer | null>(() => {
  const id = _lastLayerId.value;
  if (id && _layers.value.has(id)) return _layers.value.get(id)!;
  return layerOrder.value.length
    ? (_layers.value.get(layerOrder.value[0]) ?? null)
    : null;
});

/** `targetLayer`, guaranteed to exist: creates a "Layer 1" when there is nothing to target. */
export function ensureTargetLayer(): Layer {
  return targetLayer.value ?? createLayer();
}

/** Every id across base catalog, every layer (enabled or not), and the selected build's
 * per-build catalog. Used by catalog.nextId to avoid id collisions with a switched-off
 * layer. Consumed when allocating ids for new catalog entries. */
export function allocatableIds(): string[] {
  const ids: string[] = [];
  // Base catalog ids are known statically, collected from the shipped data.
  // Layers contribute all their item, bonus and section preset ids.
  for (const layer of _layers.value.values()) {
    ids.push(...Object.keys(layer.overlay.items ?? {}));
    ids.push(...Object.keys(layer.overlay.bonuses ?? {}));
    ids.push(...Object.keys(layer.overlay.sectionPresets ?? {}));
  }
  return ids;
}

// --- mutations --------------------------------------------------------------------------

/** Puts a layer into the pool at `index` in the fold order. */
function addLayer(layer: Layer, index: number) {
  _layers.value.set(layer.id, layer);
  layerOrder.value.splice(
    Math.max(0, Math.min(layerOrder.value.length, index)),
    0,
    layer.id,
  );
  markDirty(layer.id);
}

/** Moves a layer to the trash. Returns the index it had in the fold order, or null when there
 *  is no such layer. Selection moves on to the bottom layer when the trashed one was selected. */
function trashLayer(id: string): number | null {
  const layer = _layers.value.get(id);
  const index = layerOrder.value.indexOf(id);
  if (!layer || index === -1) return null;

  clearDirty(id);
  _layers.value.delete(id);
  layerOrder.value = layerOrder.value.filter((oid) => oid !== id);
  storage.deleteLayerRecord(id).catch(() => {});

  trash._add("layer", layer);

  if (
    selection.selection.value?.kind === "layer" &&
    selection.selection.value.id === id
  ) {
    const next = layerOrder.value[layerOrder.value.length - 1];
    if (next) selection.selectLayer(next);
    else _lastLayerId.value = null;
  }
  return index;
}

/** Takes a layer back out of the trash to `index`. False when nothing is left to restore. */
function restoreLayer(id: string, index: number): boolean {
  const item = trash.takeById("layer", id);
  if (!item) return false;
  addLayer(item, index);
  return true;
}

/** The nav step primitives. A trashed row is gone, so the row to focus after trashing is
 *  whatever layer the selection landed on. */
function trashStep(id: string): NavStepOutcome {
  if (trashLayer(id) === null) return false;
  const sel = selection.selection.value;
  return { focusId: sel?.kind === "layer" ? sel.id : null };
}

function restoreStep(id: string, index: number): NavStepOutcome {
  if (!restoreLayer(id, index)) return false;
  selection.selectLayer(id);
  return { focusId: id };
}

/** Records a layer that `addLayer` just put in the pool: undoing sends it to the trash, the
 *  same way a delete does, so nothing edited into it is lost. */
function recordAdded(label: string, id: string) {
  const index = layerOrder.value.indexOf(id);
  navHistory.record({
    label,
    undo: () => trashStep(id),
    redo: () => restoreStep(id, index),
  });
}

/** Applies one layer field and lands the selection on the layer, for rename and enable. */
function setField<K extends "name" | "enabled">(
  id: string,
  key: K,
  value: Layer[K],
): NavStepOutcome {
  const layer = _layers.value.get(id);
  if (!layer) return false;
  layer[key] = value;
  markDirty(id);
  selection.selectLayer(id);
  return { focusId: id };
}

export function createLayer(name?: string): Layer {
  const n = _layers.value.size + 1;
  const layer = storage.defaultLayer(name ?? `Layer ${n}`);
  addLayer(layer, layerOrder.value.length);
  selection.selectLayer(layer.id);
  _lastLayerId.value = layer.id;
  showNotice(`Created “${layer.name}”`);
  recordAdded(`create layer "${layer.name}"`, layer.id);
  return layer;
}

export function renameLayer(id: string, name: string) {
  const layer = _layers.value.get(id);
  if (!layer || layer.name === name) return;
  const previous = layer.name;
  layer.name = name;
  markDirty(id);
  navHistory.record({
    label: `rename layer → "${name}"`,
    undo: () => setField(id, "name", previous),
    redo: () => setField(id, "name", name),
  });
}

export function duplicateLayer(id: string) {
  const source = _layers.value.get(id);
  if (!source) return;
  const copy = storage.normalizeLayer({
    ...source,
    id: storage.newId("l"),
    name: `${source.name} copy`,
  });
  addLayer(copy, layerOrder.value.length);
  selection.selectLayer(copy.id);
  showNotice(`Duplicated as “${copy.name}”`);
  recordAdded(`duplicate layer "${source.name}"`, copy.id);
}

export function deleteLayer(id: string) {
  const name = _layers.value.get(id)?.name;
  const index = trashLayer(id);
  if (index === null) return;
  showNotice(`Deleted "${name}"`);
  navHistory.record({
    label: `delete layer "${name}"`,
    undo: () => restoreStep(id, index),
    redo: () => trashStep(id),
  });
}

export function setLayerEnabled(id: string, on: boolean) {
  const layer = _layers.value.get(id);
  if (!layer || layer.enabled === on) return;
  layer.enabled = on;
  markDirty(id);
  navHistory.record({
    label: `${on ? "enable" : "disable"} layer "${layer.name}"`,
    undo: () => setField(id, "enabled", !on),
    redo: () => setField(id, "enabled", on),
  });
}

/** Puts a layer at an absolute index in the fold order. */
function setLayerIndex(id: string, index: number): NavStepOutcome {
  const from = layerOrder.value.indexOf(id);
  if (from === -1) return false;
  layerOrder.value.splice(from, 1);
  layerOrder.value.splice(
    Math.max(0, Math.min(layerOrder.value.length, index)),
    0,
    id,
  );
  persistMeta();
  selection.selectLayer(id);
  return { focusId: id };
}

/** See builds.ts's `moveBuildTo` -- same "index relative to the list before removal" contract. */
export async function moveLayerTo(id: string, toIndex: number) {
  const idx = layerOrder.value.indexOf(id);
  if (idx === -1) return;
  const clamped = Math.max(0, Math.min(layerOrder.value.length, toIndex));
  const insertAt = reorderIndex(idx, clamped);
  if (insertAt === idx) return;
  layerOrder.value.splice(idx, 1);
  layerOrder.value.splice(insertAt, 0, id);
  navHistory.record({
    label: "move layer",
    undo: () => setLayerIndex(id, idx),
    redo: () => setLayerIndex(id, insertAt),
  });
  await persistMeta();
}

export async function moveLayer(id: string, delta: number) {
  const idx = layerOrder.value.indexOf(id);
  if (idx === -1) return;
  await moveLayerTo(id, idx + delta + (delta > 0 ? 1 : 0));
}

/** The single write path the layer editor uses - replaces the layer's overlay wholesale. */
export function updateOverlay(id: string, overlay: CatalogOverlay) {
  const layer = _layers.value.get(id);
  if (layer) {
    layer.overlay = overlay;
    markDirty(id);
  }
}

/** The enabled layer whose overlay already defines this preset, highest priority first -- the
 * one the composed catalog actually took it from, and so the only one an edit can land in
 * and still be visible. Null for a shipped preset no layer has touched yet. */
function presetOwner(id: string): Layer | null {
  return (
    layers.value.find(
      (layer) => layer.enabled && layer.overlay.sectionPresets?.[id],
    ) ?? null
  );
}

/**
 * Writes a section preset into the layer that already defines it, falling back to
 * `ensureTargetLayer()` for a shipped one -- where it becomes an overlay edit over the shipped
 * entry, exactly what the layer editor's own Presets tab would produce. Returns the layer it
 * landed in, which the notice names: the write is invisible from the build editor otherwise.
 *
 * Snapshotted on that layer's undo stack, since that is the stack it belongs to -- the build
 * editor's own undo button drives the *build's*, so taking this back means selecting the layer
 * first. That asymmetry is why the control invoking this confirms before firing.
 */
export function updatePreset(preset: SectionPreset): Layer {
  const name = preset.label || preset.id;
  const selected = selection.selection.value;
  const layer = presetOwner(preset.id) ?? ensureTargetLayer();
  // `ensureTargetLayer` creates *and selects* a layer when there is none. Called from the
  // build editor, where being thrown into a brand-new layer is not what was asked for, so
  // whatever was selected goes back.
  if (selected && selection.selection.value?.id !== selected.id) {
    if (selected.kind === "build") selection.selectBuild(selected.id);
    else selection.selectLayer(selected.id);
  }

  history.snapshot(
    "layer",
    layer.id,
    null,
    `update preset "${name}"`,
    layer.overlay,
  );
  updateOverlay(
    layer.id,
    catalog.upsert(layer.overlay, "sectionPresets", preset.id, preset),
  );
  showUndoNotice(`Updated “${name}” in “${layer.name}”`, () =>
    undoOverlayFor(layer.id),
  );
  return layer;
}

export function revertToDownloaded(id: string) {
  const layer = _layers.value.get(id);
  if (!layer?.downloaded?.snapshot) return;
  history.snapshot("layer", id, "revert", "Revert to downloaded", layer);
  const restored = storage.revertToDownloaded(layer) as Layer;
  _layers.value.set(id, restored);
  markDirty(id);
  showUndoNotice(`Reverted “${layer.name}” to the last downloaded copy`, () =>
    undoLayerFor(id),
  );
}

/** Undo a whole-layer snapshot (revert). Overlay snapshots share this stack and need
 *  `undoOverlayFor` instead, so each caller undoes with the shape it recorded. */
export function undoLayerFor(id: string) {
  const layer = _layers.value.get(id);
  if (!layer) return;
  const json = history.undo("layer", id, layer);
  if (json != null) {
    _layers.value.set(id, JSON.parse(json) as Layer);
    markDirty(id);
  }
}

/** Undo an overlay snapshot (a catalog edit, a preset update) on one layer's own stack. */
export function undoOverlayFor(id: string) {
  const layer = _layers.value.get(id);
  if (!layer) return;
  const json = history.undo("layer", id, layer.overlay);
  if (json != null) updateOverlay(id, JSON.parse(json) as CatalogOverlay);
}

export function downloadLayer(id: string) {
  const layer = _layers.value.get(id);
  if (!layer) return;
  const json = storage.toLayerJson(layer);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${layer.name.replace(/[^\w.-]+/g, "-") || "layer"}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

export function importLayerText(text: string) {
  try {
    const { layer, catalogStale } = storage.parseLayerJson(text);
    addLayer(layer, layerOrder.value.length);
    selection.selectLayer(layer.id);
    const stale = catalogStale
      ? ". Made against an older item catalog; some items may no longer resolve"
      : "";
    showNotice(`Imported “${layer.name}”${stale}`);
  } catch (error: unknown) {
    showNotice(
      `That file could not be read: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** Writes one imported layer into the pool. `replacing` takes over the fold position of the
 *  layer whose id it carries, which goes to the trash; anything else is appended at the
 *  bottom. `importFile.ts` decides which of the two an entry is. */
export function upsertImported(layer: Layer, replacing: boolean) {
  const existing = _layers.value.get(layer.id);
  if (replacing && existing) trash._add("layer", existing);
  else if (!existing) layerOrder.value.push(layer.id);
  _layers.value.set(layer.id, layer);
  markDirty(layer.id);
}

/** Selects an imported layer, once the whole file has been written. */
export function selectImported(id: string) {
  if (_layers.value.has(id)) selection.selectLayer(id);
}

// --- bootstrap --------------------------------------------------------------------------

export function _init(layersMap: Map<string, Layer>, order: string[]) {
  _layers.value = layersMap;
  layerOrder.value = order;
}

// --- persistence (incremental - only dirty ids are written) -----------------------------

const _dirtyIds = new Set<string>();
let _loading = true;

async function flushSave() {
  const ids = [..._dirtyIds];
  _dirtyIds.clear();
  for (const id of ids) {
    const layer = _layers.value.get(id);
    if (layer) {
      try {
        await storage.putLayer(layer);
      } catch {
        flagStorageFailed(
          "Could not save to storage; export your layers to keep them.",
        );
      }
    }
  }
}

const flushSaveDebounced = useDebounceFn(flushSave, SAVE_DEBOUNCE_MS);

function markDirty(id: string) {
  if (_loading) return;
  _dirtyIds.add(id);
  flushSaveDebounced();
}

function clearDirty(id: string) {
  _dirtyIds.delete(id);
}

/** Called by bootstrap once hydration finishes so persistence can start. */
export function _setLoading(value: boolean) {
  _loading = value;
}
