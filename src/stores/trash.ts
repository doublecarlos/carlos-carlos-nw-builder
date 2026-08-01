// Soft-delete for builds and layers: deleteBuild/deleteLayer move the item here with a
// timestamp rather than dropping it outright. On boot, entries older than 7 days are
// purged. Restore re-inserts the record and appends to the relevant order.
import { computed, ref } from "vue";
import * as history from "./history";
import * as storage from "../storage";
import type { Build, Layer, TrashEntry } from "../types";

const PURGE_MS = 7 * 24 * 60 * 60 * 1000;

const _trash = ref<TrashEntry[]>([]);

/** Newest first. */
export const trashed = computed(() =>
  [..._trash.value].sort((a, b) => b.deletedAt - a.deletedAt),
);

export function _add(kind: "build" | "layer", item: Build | Layer) {
  const entry: TrashEntry = { kind, item, deletedAt: Date.now() };
  _trash.value.push(entry);
  storage.putTrash(entry).catch(() => {
    // non-critical
  });
}

export function _init(entries: TrashEntry[]) {
  const now = Date.now();
  const cutoff = now - PURGE_MS;
  const keep: TrashEntry[] = [];
  const purge: TrashEntry[] = [];

  for (const entry of entries) {
    if (entry.deletedAt > cutoff) {
      keep.push(entry);
    } else {
      purge.push(entry);
    }
  }

  _trash.value = keep;

  // Purge old entries from IDB.
  for (const entry of purge) {
    storage
      .deleteTrash(`${entry.kind}_${entry.item.id}_${entry.deletedAt}`)
      .catch(() => {});
  }
}

/** Restore an item from trash, re-inserting it into the relevant store. Returns the
 * restored item, or null if the entry was not found. */
export function restore(entry: TrashEntry): Build | Layer | null {
  const idx = _trash.value.indexOf(entry);
  if (idx === -1) return null;
  _trash.value.splice(idx, 1);
  storage
    .deleteTrash(`${entry.kind}_${entry.item.id}_${entry.deletedAt}`)
    .catch(() => {});
  return entry.item;
}

/** Remove an entry from trash permanently. Also drops the item's undo history. */
export function purge(entry: TrashEntry) {
  const idx = _trash.value.indexOf(entry);
  if (idx === -1) return;
  _trash.value.splice(idx, 1);
  const trashKey = `${entry.kind}_${entry.item.id}_${entry.deletedAt}`;
  storage.deleteTrash(trashKey).catch(() => {});
  // Drop the history for this item.
  history._delete(`${entry.kind}:${entry.item.id}`);
}
