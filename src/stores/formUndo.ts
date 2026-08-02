// Form-level undo: tracks the active form's draft undo/redo state. Forms register
// themselves when they have draft history (new items only), and unregister on unmount.
// The AppHeader buttons delegate here when a form is active with draft changes.
import { computed, ref } from "vue";

export interface FormUndoState {
  canUndo: boolean;
  canRedo: boolean;
  undo: () => boolean;
  redo: () => boolean;
  /** Label for the top of the undo stack, or empty string. */
  undoLabel: string;
  /** Label for the top of the redo stack, or empty string. */
  redoLabel: string;
}

/** The currently active form's undo state, or null. */
const _active = ref<FormUndoState | null>(null);

export const canUndo = computed(() => _active.value?.canUndo ?? false);
export const canRedo = computed(() => _active.value?.canRedo ?? false);
export const undoLabel = computed(() => _active.value?.undoLabel ?? "");
export const redoLabel = computed(() => _active.value?.redoLabel ?? "");

export function undo(): boolean {
  return _active.value?.undo() ?? false;
}

export function redo(): boolean {
  return _active.value?.redo() ?? false;
}

/** Register a form's undo state. Returns an unregister function. */
export function register(state: FormUndoState): () => void {
  _active.value = state;
  return () => {
    if (_active.value === state) _active.value = null;
  };
}
