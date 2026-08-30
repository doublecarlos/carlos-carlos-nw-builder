// Layers: named catalogue overlays that can be toggled on/off independently. The engine
// folds every enabled layer's overlay (plus the active build's catalog) on top of the
// base catalogue. The list reads highest-priority first: the topmost layer wins.
import { computed, ref } from "vue";
import { useDebounceFn } from "@vueuse/core";
import { reorderIndex } from "../composables/useDragAndDrop";
import * as storage from "../storage/storage";
import * as history from "./history";
import * as trash from "./trash";
import * as selection from "./selection";
import { layerOrder, persistMeta } from "./meta";
import { flagStorageFailed, showNotice } from "./notice";
import * as builds from "./builds";
import * as catalog from "../data/catalog";
import type { Layer, CatalogOverlay, SectionPreset } from "../types";

const SAVE_DEBOUNCE_MS = 250;

const _layers = ref<Map<string, Layer>>(new Map());

export const layers = computed(() =>
  layerOrder.value.map((id) => _layers.value.get(id)!).filter(Boolean),
);

/** Enabled layers in fold order, for the engine to fold over the base catalogue. Reversed
 * against the displayed order: folding last is what wins, and the top layer has priority. */
export const enabledOverlays = computed(() =>
  layers.value
    .filter((l) => l.enabled)
    .map((l) => l.overlay)
    .reverse(),
);

/** The id of the last layer the user selected, for ensureTargetLayer. */
let _lastLayerId: string | null = null;

/** Returns a layer guaranteed to exist: the last-selected one, the top (highest-priority)
 * one, or a freshly-created "Layer 1". Used by Ctrl/Cmd-click to target a layer -- the top
 * one so the edit written there is not shadowed by another layer. */
export function ensureTargetLayer(): Layer {
  if (_lastLayerId && _layers.value.has(_lastLayerId)) {
    return _layers.value.get(_lastLayerId)!;
  }
  if (layerOrder.value.length) {
    return _layers.value.get(layerOrder.value[0])!;
  }
  return createLayer();
}

/** Every id across base catalogue, every layer (enabled or not), and the selected build's
 * per-build catalog. Used by catalog.nextId to avoid id collisions with a switched-off
 * layer. Consumed when allocating ids for new catalogue entries. */
export function allocatableIds(): string[] {
  const ids: string[] = [];
  // Base catalogue ids are known statically, collected from the shipped data.
  // Layers contribute all their item, bonus and section preset ids.
  for (const layer of _layers.value.values()) {
    ids.push(...Object.keys(layer.overlay.items ?? {}));
    ids.push(...Object.keys(layer.overlay.bonuses ?? {}));
    ids.push(...Object.keys(layer.overlay.sectionPresets ?? {}));
  }
  return ids;
}

// --- mutations --------------------------------------------------------------------------

export function createLayer(name?: string): Layer {
  const n = _layers.value.size + 1;
  const layer = storage.defaultLayer(name ?? `Layer ${n}`);
  _layers.value.set(layer.id, layer);
  layerOrder.value.push(layer.id);
  markDirty(layer.id);
  selection.selectLayer(layer.id);
  _lastLayerId = layer.id;
  showNotice(`Created “${layer.name}”`);
  return layer;
}

export function renameLayer(id: string, name: string) {
  const layer = _layers.value.get(id);
  if (layer) {
    history.snapshot("layer", id, "name", `rename layer → "${name}"`, layer);
    layer.name = name;
    markDirty(id);
  }
}

export function duplicateLayer(id: string) {
  const source = _layers.value.get(id);
  if (!source) return;
  const copy = storage.normaliseLayer({
    ...source,
    id: storage.newId("l"),
    name: `${source.name} copy`,
  });
  _layers.value.set(copy.id, copy);
  layerOrder.value.push(copy.id);
  markDirty(copy.id);
  selection.selectLayer(copy.id);
  showNotice(`Duplicated as “${copy.name}”`);
}

export function deleteLayer(id: string) {
  const layer = _layers.value.get(id);
  if (!layer) return;

  clearDirty(id);
  _layers.value.delete(id);
  layerOrder.value = layerOrder.value.filter((oid) => oid !== id);
  storage.deleteLayerRecord(id).catch(() => {});

  trash._add("layer", layer);
  showNotice(`Deleted "${layer.name}"`);

  if (
    selection.selection.value?.kind === "layer" &&
    selection.selection.value.id === id
  ) {
    const next = layerOrder.value[layerOrder.value.length - 1];
    if (next) selection.selectLayer(next);
    else _lastLayerId = null;
  }
}

export function setLayerEnabled(id: string, on: boolean) {
  const layer = _layers.value.get(id);
  if (layer) {
    history.snapshot(
      "layer",
      id,
      `enabled:${id}`,
      on ? "Enable layer" : "Disable layer",
      layer,
    );
    layer.enabled = on;
    markDirty(id);
  }
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
 * one the composed catalogue actually took it from, and so the only one an edit can land in
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
  showNotice(`Updated “${name}” in “${layer.name}”`);
  return layer;
}

export function revertToDownloaded(id: string) {
  const layer = _layers.value.get(id);
  if (!layer?.downloaded?.snapshot) return;
  history.snapshot("layer", id, "revert", "Revert to downloaded", layer);
  const restored = storage.revertToDownloaded(layer) as Layer;
  _layers.value.set(id, restored);
  markDirty(id);
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
    _layers.value.set(layer.id, layer);
    layerOrder.value.push(layer.id);
    markDirty(layer.id);
    selection.selectLayer(layer.id);
    const stale = catalogStale
      ? " - made against an older item catalogue; some items may no longer resolve"
      : "";
    showNotice(`Imported “${layer.name}”${stale}`);
  } catch (error: unknown) {
    showNotice(
      `That file could not be read: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function importBundleText(text: string) {
  try {
    const { bundle, catalogStale } = storage.parseBundleJson(text);
    const { builds: newBuilds, layers: newLayers } = bundle;

    // Import builds first
    for (const b of newBuilds) {
      builds.importBuilds([b], catalogStale);
    }

    // Then import layers
    for (const layer of newLayers) {
      _layers.value.set(layer.id, layer);
      layerOrder.value.push(layer.id);
      markDirty(layer.id);
    }

    if (newLayers.length) {
      selection.selectLayer(newLayers[newLayers.length - 1].id);
    }

    const stale = catalogStale
      ? " - made against an older item catalogue; some items may no longer resolve"
      : "";
    showNotice(
      `Imported ${newBuilds.length} build(s) and ${newLayers.length} layer(s)${stale}`,
    );
  } catch (error: unknown) {
    showNotice(
      `That file could not be read: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
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
          "Could not save to storage - export your layers to keep them.",
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
