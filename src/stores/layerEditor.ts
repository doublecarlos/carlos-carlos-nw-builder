// Layer editing operations: undo/redo and mutation helpers. Mirrors the buildEditor pattern
// for consistency - the history store owns the undo stack, this store wraps it for layers.
import * as history from "./history";
import * as layers from "./layers";
import * as selection from "./selection";

// Re-export computed accessors so LayerEditor.vue and useUndoRedo can import from here.
export const canUndo = history.canUndo;
export const canRedo = history.canRedo;
export const undoLabel = history.undoLabel;
export const redoLabel = history.redoLabel;

/** The currently selected layer, or null. */
function activeLayer() {
  const sel = selection.selection.value;
  if (sel?.kind !== "layer") return null;
  return layers.layers.value.find((l) => l.id === sel.id) ?? null;
}

export function undo() {
  const layer = activeLayer();
  if (!layer) return;
  const json = history.undo("layer", layer.id, layer.overlay);
  if (json != null) layers.updateOverlay(layer.id, JSON.parse(json));
}

export function redo() {
  const layer = activeLayer();
  if (!layer) return;
  const json = history.redo("layer", layer.id, layer.overlay);
  if (json != null) layers.updateOverlay(layer.id, JSON.parse(json));
}
