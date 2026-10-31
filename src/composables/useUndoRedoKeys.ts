// Wire Ctrl+Z / ⌘Z (undo) and Ctrl+Shift+Z / ⌘Shift+Z / Ctrl+Y (redo) to the
// undo/redo composable.  Skips when a form control has focus so the browser's
// native undo in those fields is not hijacked, and while a modal is open so an
// overlay's own controls are not edited out from under it.
//
// Outside those, the app owns the keys and prevents the default. The browser's native undo
// would otherwise also replay the last typing into a field that has since lost focus.
// A plain `keydown` listener, since `useMagicKeys` listens passively and cannot prevent it.
import { useEventListener } from "@vueuse/core";
import { isFormControl } from "./focus";
import { useUndoRedo } from "./useUndoRedo";
import { isModalOpen } from "../stores/modals";

export function useUndoRedoKeys() {
  const { canUndo, canRedo, undoLabel, redoLabel, undo, redo } = useUndoRedo();

  useEventListener(window, "keydown", (event: KeyboardEvent) => {
    if (event.altKey) return;
    const key = event.key.toLowerCase();
    const mod = event.ctrlKey || event.metaKey;
    const isUndo = mod && !event.shiftKey && key === "z";
    const isRedo =
      (mod && event.shiftKey && key === "z") ||
      (event.ctrlKey && !event.shiftKey && key === "y");
    if (!isUndo && !isRedo) return;
    if (isModalOpen.value || isFormControl(document.activeElement)) return;

    event.preventDefault();
    // One step per press, not one per key repeat.
    if (event.repeat) return;
    if (isUndo && canUndo.value) undo();
    if (isRedo && canRedo.value) redo();
  });

  return { canUndo, canRedo, undoLabel, redoLabel, undo, redo };
}
