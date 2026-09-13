// Wire Ctrl+Z / ⌘Z (undo) and Ctrl+Shift+Z / ⌘Shift+Z / Ctrl+Y (redo) to the
// undo/redo composable.  Skips when a form control has focus so the browser's
// native undo in those fields is not hijacked, and while a modal is open so an
// overlay's own controls are not edited out from under it.
import { computed } from "vue";
import { useMagicKeys, whenever } from "@vueuse/core";
import { isFormControl } from "./focus";
import { useUndoRedo } from "./useUndoRedo";
import { isModalOpen } from "../stores/modals";

export function useUndoRedoKeys() {
  const { canUndo, canRedo, undoLabel, redoLabel, undo, redo } = useUndoRedo();
  const keys = useMagicKeys();

  const undoPressed = computed(
    () => !keys.shift.value && (keys.ctrl_z.value || keys.meta_z.value),
  );
  const redoPressed = computed(
    () =>
      keys.ctrl_shift_z.value || keys.meta_shift_z.value || keys.ctrl_y.value,
  );

  whenever(undoPressed, () => {
    if (
      !isModalOpen.value &&
      !isFormControl(document.activeElement) &&
      canUndo.value
    )
      undo();
  });

  whenever(redoPressed, () => {
    if (
      !isModalOpen.value &&
      !isFormControl(document.activeElement) &&
      canRedo.value
    )
      redo();
  });

  return { canUndo, canRedo, undoLabel, redoLabel, undo, redo };
}
