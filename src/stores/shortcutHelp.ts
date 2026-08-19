// Open/closed state for the keyboard shortcut overlay, plus the focus it borrowed.
//
// A store rather than local component state because two unrelated places open it: the header's
// own button, and the `?` handler in composables/useGlobalShortcuts.ts, which has no component
// to hold a ref for it. Same split GameImport's wizard already uses.
import { readonly, ref } from "vue";

const _isOpen = ref(false);

/** Whatever had focus when the overlay opened, so closing can hand it back rather than
 *  dropping the user at the top of the document. */
let restoreFocusTo: HTMLElement | null = null;

export const isOpen = readonly(_isOpen);

export function open() {
  if (_isOpen.value) return;
  restoreFocusTo = document.activeElement as HTMLElement | null;
  _isOpen.value = true;
}

export function close() {
  if (!_isOpen.value) return;
  _isOpen.value = false;
  restoreFocusTo?.focus?.();
  restoreFocusTo = null;
}

export function toggle() {
  if (_isOpen.value) close();
  else open();
}
