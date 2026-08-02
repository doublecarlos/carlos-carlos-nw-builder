// Shared order refs so builds.ts, layers.ts, and selection.ts can each write a complete
// AppMeta record without importing each other. All three stores read/write their own field
// on these refs; selection.ts is the single writer of the IDB meta record.
import { ref } from "vue";
import * as storage from "../storage/storage";
import type { Selection } from "../types";

export const buildOrder = ref<string[]>([]);
export const layerOrder = ref<string[]>([]);

/** Persist the current order and optional selection to IDB. Returns the promise for callers
 * that need to await the write (e.g. before a page reload in tests). */
export function persistMeta(lastSelection: Selection | null = null) {
  return storage
    .putMeta({
      buildOrder: buildOrder.value,
      layerOrder: layerOrder.value,
      lastSelection,
    })
    .catch((e) => {
      console.error("persistMeta failed:", e);
      // non-critical — meta is a convenience for the next fresh tab
    });
}
