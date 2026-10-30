// Shared order refs so builds.ts, folders.ts, layers.ts, and selection.ts can each write a
// complete AppMeta record without importing each other. Each store owns its own field on these
// refs; any of them may write the record, and every write carries the current selection.
import { ref } from "vue";
import * as storage from "../storage/storage";
import type { BuildFolder, Selection } from "../types";

/** Top-level sidebar order under Builds -- build ids and folder ids interleaved. See
 *  `AppMeta.buildOrder`; folders.ts owns every mutation of this and of `folders`. */
export const buildOrder = ref<string[]>([]);
export const folders = ref<BuildFolder[]>([]);
export const layerOrder = ref<string[]>([]);

let selectionSource: () => Selection | null = () => null;

/** Registered by selection.ts, so an order write keeps the stored selection without this
 *  module importing the selection store. */
export function setSelectionSource(source: () => Selection | null) {
  selectionSource = source;
}

/** Persist the current order and selection to IDB. Returns the promise for callers that need
 * to await the write (e.g. before a page reload in tests). */
export function persistMeta() {
  return storage
    .putMeta({
      buildOrder: buildOrder.value,
      folders: folders.value,
      layerOrder: layerOrder.value,
      lastSelection: selectionSource(),
    })
    .catch((e) => {
      console.error("persistMeta failed:", e);
      // non-critical - meta is a convenience for the next fresh tab
    });
}
