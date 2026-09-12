// Undo/redo bindings over the app's histories. Two stacks exist: the nav stack of workspace
// operations (`stores/navHistory.ts`) and the selected item's content stack (`stores/history.ts`,
// reached through `buildEditor` or `layerEditor` depending on what is selected). A form draft
// with its own history (a new item being authored) sits in front of either: while it has steps,
// undo takes those back first.
//
// `useItemUndoRedo` is the item stack alone, for the editor's own buttons; `useUndoRedo` picks
// the stack by the active undo scope, for the keyboard.
import { computed, type ComputedRef } from "vue";
import * as buildEditor from "../stores/buildEditor";
import * as layerEditor from "../stores/layerEditor";
import * as formUndo from "../stores/formUndo";
import * as navHistory from "../stores/navHistory";
import * as selection from "../stores/selection";
import { undoScope } from "./useUndoScope";

export interface UndoRedoBinding {
  canUndo: ComputedRef<boolean>;
  canRedo: ComputedRef<boolean>;
  undoLabel: ComputedRef<string>;
  redoLabel: ComputedRef<string>;
  undo: () => void;
  redo: () => void;
}

/** `buildEditor` and `layerEditor` read the same per-item history, keyed by the selection, so
 *  the state is shared and only the apply step differs by kind. */
const itemStack: UndoRedoBinding = {
  canUndo: buildEditor.canUndo,
  canRedo: buildEditor.canRedo,
  undoLabel: buildEditor.undoLabel,
  redoLabel: buildEditor.redoLabel,
  undo: () =>
    selection.selection.value?.kind === "layer"
      ? layerEditor.undo()
      : buildEditor.undo(),
  redo: () =>
    selection.selection.value?.kind === "layer"
      ? layerEditor.redo()
      : buildEditor.redo(),
};

const navStack: UndoRedoBinding = {
  canUndo: navHistory.canUndo,
  canRedo: navHistory.canRedo,
  undoLabel: navHistory.undoLabel,
  redoLabel: navHistory.redoLabel,
  undo: () => void navHistory.undo(),
  redo: () => void navHistory.redo(),
};

/** The form draft's history in front of whichever stack `pick` names at the time. */
function withFormDraft(pick: () => UndoRedoBinding): UndoRedoBinding {
  return {
    canUndo: computed(() => formUndo.canUndo.value || pick().canUndo.value),
    canRedo: computed(() => formUndo.canRedo.value || pick().canRedo.value),
    undoLabel: computed(() =>
      formUndo.canUndo.value
        ? formUndo.undoLabel.value
        : pick().undoLabel.value,
    ),
    redoLabel: computed(() =>
      formUndo.canRedo.value
        ? formUndo.redoLabel.value
        : pick().redoLabel.value,
    ),
    undo: () => {
      if (!formUndo.undo()) pick().undo();
    },
    redo: () => {
      if (!formUndo.redo()) pick().redo();
    },
  };
}

/** The selected build's or layer's content history, whatever has focus. */
export function useItemUndoRedo(): UndoRedoBinding {
  return withFormDraft(() => itemStack);
}

/** Whichever history the active undo scope points at: the nav stack with the sidebar focused,
 *  the selected item's stack otherwise. */
export function useUndoRedo(): UndoRedoBinding {
  return withFormDraft(() =>
    undoScope.value === "nav" ? navStack : itemStack,
  );
}
