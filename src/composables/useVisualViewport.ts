// The visible box (lib/visual-viewport.ts), kept current as the on-screen keyboard opens and
// closes or the page pans under a pinch zoom.
import { shallowRef } from "vue";
import { useEventListener } from "@vueuse/core";
import { visibleBox, type ViewportBox } from "../lib/visual-viewport";

export function useVisualViewport() {
  const read = () => visibleBox(window.visualViewport, window);
  const box = shallowRef<ViewportBox>(read());
  const update = () => {
    box.value = read();
  };
  const visual = window.visualViewport;
  if (visual) useEventListener(visual, ["resize", "scroll"], update);
  useEventListener(window, "resize", update);
  return box;
}
