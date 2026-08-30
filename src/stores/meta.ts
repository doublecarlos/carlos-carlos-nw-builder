// Shared order refs so builds.ts, folders.ts, layers.ts, and selection.ts can each write a
// complete AppMeta record without importing each other. All of them read/write their own
// field on these refs; selection.ts is the single writer of the IDB meta record.
import { ref } from "vue";
import * as storage from "../storage/storage";
import type { BuildFolder, Selection } from "../types";

/** Top-level sidebar order under Builds -- build ids and folder ids interleaved. See
 *  `AppMeta.buildOrder`; folders.ts owns every mutation of this and of `folders`. */
export const buildOrder = ref<string[]>([]);
export const folders = ref<BuildFolder[]>([]);
export const layerOrder = ref<string[]>([]);

/** Persist the current order and optional selection to IDB. Returns the promise for callers
 * that need to await the write (e.g. before a page reload in tests). */
export function persistMeta(lastSelection: Selection | null = null) {
  return storage
    .putMeta({
      buildOrder: buildOrder.value,
      folders: folders.value,
      layerOrder: layerOrder.value,
      lastSelection,
    })
    .catch((e) => {
      console.error("persistMeta failed:", e);
      // non-critical - meta is a convenience for the next fresh tab
    });
}
