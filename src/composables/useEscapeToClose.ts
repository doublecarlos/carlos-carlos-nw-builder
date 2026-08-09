import { useMagicKeys, whenever } from "@vueuse/core";

/** Calls `callback` whenever Escape is pressed, for dismissible overlays/popovers. */
export function useEscapeToClose(callback: () => void) {
  const { escape } = useMagicKeys();
  whenever(escape, callback);
}
