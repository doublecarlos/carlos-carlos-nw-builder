// Unified undo/redo composable: delegates to the appropriate undo system based on
// context. Priority: form draft undo > build/layer committed undo.
import { computed } from "vue";
import * as buildEditor from "../stores/buildEditor";
import * as layerEditor from "../stores/layerEditor";
import * as formUndo from "../stores/formUndo";
import * as selection from "../stores/selection";

export function useUndoRedo() {
  const canUndo = computed(
    () => formUndo.canUndo.value || buildEditor.canUndo.value,
  );
  const canRedo = computed(
    () => formUndo.canRedo.value || buildEditor.canRedo.value,
  );

  const undoLabel = computed(() => {
    if (formUndo.canUndo.value) return formUndo.undoLabel.value;
    return buildEditor.undoLabel.value;
  });

  const redoLabel = computed(() => {
    if (formUndo.canRedo.value) return formUndo.redoLabel.value;
    return buildEditor.redoLabel.value;
  });

  function undo() {
    if (formUndo.undo()) return;
    if (selection.selection.value?.kind === "layer") {
      layerEditor.undo();
    } else {
      buildEditor.undo();
    }
  }

  function redo() {
    if (formUndo.redo()) return;
    if (selection.selection.value?.kind === "layer") {
      layerEditor.redo();
    } else {
      buildEditor.redo();
    }
  }

  return { canUndo, canRedo, undoLabel, redoLabel, undo, redo };
}
