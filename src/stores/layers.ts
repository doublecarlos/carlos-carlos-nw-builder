// Layers: named catalogue overlays that can be toggled on/off independently. The engine
// folds every enabled layer's overlay (plus the active build's catalog) on top of the
// base catalogue.
import { computed, ref } from "vue";
import { useDebounceFn } from "@vueuse/core";
import * as storage from "../storage/storage";
import * as history from "./history";
import * as trash from "./trash";
import * as selection from "./selection";
import { layerOrder, persistMeta } from "./meta";
import { flagStorageFailed, showNotice } from "./notice";
import * as builds from "./builds";
import type { Layer, CatalogOverlay } from "../types";

const SAVE_DEBOUNCE_MS = 250;

const _layers = ref<Map<string, Layer>>(new Map());

export const layers = computed(() =>
  layerOrder.value.map((id) => _layers.value.get(id)!).filter(Boolean),
);

/** Enabled layers in order, for the engine to fold over the base catalogue. */
export const enabledOverlays = computed(() =>
  layers.value.filter((l) => l.enabled).map((l) => l.overlay),
);

/** The id of the last layer the user selected, for ensureTargetLayer. */
let _lastLayerId: string | null = null;

/** Returns a layer guaranteed to exist: the last-selected one, the last in the list,
 * or a freshly-created "Layer 1". Used by Ctrl/Cmd-click to target a layer. */
export function ensureTargetLayer(): Layer {
  if (_lastLayerId && _layers.value.has(_lastLayerId)) {
    return _layers.value.get(_lastLayerId)!;
  }
  if (layerOrder.value.length) {
    return _layers.value.get(layerOrder.value[layerOrder.value.length - 1])!;
  }
  return createLayer();
}

/** Every id across base catalogue, every layer (enabled or not), and the selected build's
 * per-build catalog. Used by catalog.nextId to avoid id collisions with a switched-off
 * layer. Consumed when allocating ids for new catalogue entries. */
export function allocatableIds(): string[] {
  const ids: string[] = [];
  // Base catalogue ids are known statically, collected from the shipped data.
  // Layers contribute all their item and bonus set ids.
  for (const layer of _layers.value.values()) {
    ids.push(...Object.keys(layer.overlay.items ?? {}));
    ids.push(...Object.keys(layer.overlay.bonusSets ?? {}));
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
  if (_layers.value.size < 2) return;

  clearDirty(id);
  _layers.value.delete(id);
  layerOrder.value = layerOrder.value.filter((oid) => oid !== id);
  storage.deleteLayerRecord(id).catch(() => {});

  trash._add("layer", layer);
  showNotice(`Deleted “${layer.name}”`);

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

export async function moveLayer(id: string, delta: number) {
  const idx = layerOrder.value.indexOf(id);
  if (idx === -1) return;
  const newIdx = Math.max(
    0,
    Math.min(layerOrder.value.length - 1, idx + delta),
  );
  if (newIdx === idx) return;
  layerOrder.value.splice(idx, 1);
  layerOrder.value.splice(newIdx, 0, id);
  await persistMeta();
}

/** The single write path the layer editor uses — replaces the layer's overlay wholesale. */
export function updateOverlay(id: string, overlay: CatalogOverlay) {
  const layer = _layers.value.get(id);
  if (layer) {
    layer.overlay = overlay;
    markDirty(id);
  }
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
      ? " — made against an older item catalogue; some items may no longer resolve"
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
      ? " — made against an older item catalogue; some items may no longer resolve"
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

// --- persistence (incremental — only dirty ids are written) -----------------------------

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
          "Could not save to storage — export your layers to keep them.",
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
