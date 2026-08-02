// useKeyboardShortcuts.ts
import { useMagicKeys, UseMagicKeysOptions } from "@vueuse/core";

/**
 * Custom wrapper around useMagicKeys that automatically ignores
 * keyboard events originating from editable form inputs.
 */

export function useKeyboardShortcuts<Reactive extends boolean = true>(
  options: UseMagicKeysOptions<Reactive> = {},
) {
  return useMagicKeys({
    ...options,
    onEventFired(e) {
      const target = e.target as HTMLElement | null;

      // Ignore inputs, textareas, selects, and contenteditable elements
      if (
        target &&
        (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) ||
          target.isContentEditable)
      ) {
        return;
      }

      // Call original callback if provided
      options.onEventFired?.(e);
    },
  });
}
