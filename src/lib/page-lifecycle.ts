// Hooks for the moment the page may stop running: hidden (tab switch, app switch on mobile)
// or unloaded. Either can be the last chance to run code, so pending writes go out here.
import { defaultDocument, defaultWindow, useEventListener } from "@vueuse/core";

/** Runs `callback` whenever the page is hidden or unloaded. A no-op without a DOM. */
export function onPageHide(callback: () => void) {
  useEventListener(defaultDocument, "visibilitychange", () => {
    if (defaultDocument?.visibilityState === "hidden") callback();
  });
  useEventListener(defaultWindow, "pagehide", callback);
}
