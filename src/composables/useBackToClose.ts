// Holds the browser's Back (lib/back-to-close.ts) for as long as `active` is true, so Back runs
// `onBack` instead of leaving the page. Going inactive any other way gives the entry back.
import { onBeforeUnmount, watch } from "vue";
import { holdBack } from "../lib/back-to-close";

/** `onBack` may answer `false`, or a promise of it, to stay open: Back is then held again, so
 *  a later press still lands here. Anything else counts as closed. */
export function useBackToClose(active: () => boolean, onBack: () => unknown) {
  let release: (() => Promise<void>) | null = null;

  const arm = () => {
    release = holdBack(() => void back());
  };

  async function back() {
    release = null;
    const result: unknown = await onBack();
    if (result === false && active() && !release) arm();
  }

  watch(
    active,
    (on) => {
      if (on) {
        if (!release) arm();
        return;
      }
      void release?.();
      release = null;
    },
    { immediate: true, flush: "sync" },
  );

  onBeforeUnmount(() => void release?.());
}
