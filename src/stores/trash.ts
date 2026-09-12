// Soft-delete for builds and layers: deleteBuild/deleteLayer move the item here with a
// timestamp rather than dropping it outright. On boot, entries older than 7 days are
// purged. Restoring hands the item back to its store, which decides where it lands.
import { computed, ref } from "vue";
import * as history from "./history";
import * as storage from "../storage/storage";
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
    storage.deleteTrash(trashKey(entry)).catch(() => {});
  }
}

function trashKey(entry: TrashEntry) {
  return `${entry.kind}_${entry.item.id}_${entry.deletedAt}`;
}

/** Drops the entry at `idx` and hands its item back to the caller, who re-inserts it. */
function take(idx: number): Build | Layer {
  const [entry] = _trash.value.splice(idx, 1);
  storage.deleteTrash(trashKey(entry)).catch(() => {});
  return entry.item;
}

/** Takes an item back out of the trash for the trash UI's Restore. Returns the item, or null
 * if the entry was not found. */
export function restore(entry: TrashEntry): Build | Layer | null {
  const idx = _trash.value.indexOf(entry);
  return idx === -1 ? null : take(idx);
}

/** Takes the newest trashed copy of `id` back out, for a nav undo that puts a deleted item
 * back. Null when nothing is left to restore: the entry was purged, or already restored
 * from the trash UI. */
export function takeById(kind: "build", id: string): Build | null;
export function takeById(kind: "layer", id: string): Layer | null;
export function takeById(kind: "build" | "layer", id: string) {
  let idx = -1;
  _trash.value.forEach((entry, i) => {
    if (entry.kind !== kind || entry.item.id !== id) return;
    if (idx === -1 || entry.deletedAt > _trash.value[idx].deletedAt) idx = i;
  });
  return idx === -1 ? null : take(idx);
}

/** Remove an entry from trash permanently. Also drops the item's undo history. */
export function purge(entry: TrashEntry) {
  const idx = _trash.value.indexOf(entry);
  if (idx === -1) return;
  _trash.value.splice(idx, 1);
  storage.deleteTrash(trashKey(entry)).catch(() => {});
  // Drop the history for this item.
  history._delete(`${entry.kind}:${entry.item.id}`);
}
