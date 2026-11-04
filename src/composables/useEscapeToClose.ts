// A plain `keydown` listener rather than `useMagicKeys`, which adds four window listeners and
// a key-state map per caller to watch a single key.
import { useEventListener } from "@vueuse/core";

/** Calls `callback` whenever Escape is pressed, for dismissible overlays/popovers. Once per
 *  press: holding the key does not repeat it. */
export function useEscapeToClose(callback: () => void) {
  useEventListener(window, "keydown", (event: KeyboardEvent) => {
    if (event.key === "Escape" && !event.repeat) callback();
  });
}
