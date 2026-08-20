// Open/closed state for the keyboard shortcut overlay.
//
// A store rather than local component state because two unrelated places open it: the header's
// own button, and the `?` handler in composables/useGlobalShortcuts.ts, which has no component
// to hold a ref for it. Same split GameImport's wizard already uses.
import { readonly, ref } from "vue";

const _isOpen = ref(false);

export const isOpen = readonly(_isOpen);

export function open() {
  _isOpen.value = true;
}

// Focus (both trapping it and handing it back) belongs to BaseModal.
export function close() {
  _isOpen.value = false;
}

export function toggle() {
  if (_isOpen.value) close();
  else open();
}
