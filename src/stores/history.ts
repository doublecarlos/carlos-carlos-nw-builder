// Per-item persisted undo stack, one per build or layer, keyed `<kind>:<id>`. Persisted to
// IndexedDB on the same 250 ms debounce as the items themselves. Undo/redo always operate on
// the **selected** item's stack, and restore selects the item if it is not already selected.
//
// ## What is undoable
// Every edit in `stores/buildEditor.ts` that changes one item's content, every committed
// overlay change in the layer editor, `renameBuild`, `renameLayer`, `setLayerEnabled`, and
// `revertToDownloaded`.
//
// ## What is not undoable
// `createBuild`, `deleteBuild`, `createLayer`, `deleteLayer`, `moveBuild`, `moveLayer`,
// import, download, and selection changes. Delete is covered by the trash (phase 2b §4).
//
// ## Coalescing
// Consecutive calls to `snapshot` with the same `key` inside a 700 ms window collapse into
// one undo step. Pass `null` to force a distinct step.
import { computed, ref } from "vue";
import { useDebounceFn } from "@vueuse/core";
import * as idb from "../storage/idb";
import * as selection from "./selection";

const UNDO_LIMIT = 50;
const COALESCE_MS = 700;

export interface HistoryEntry {
  json: string;
  label: string;
}

export interface ItemHistory {
  past: HistoryEntry[];
  future: HistoryEntry[];
  lastKey: string | null;
  lastAt: number;
}

/** The map of all histories, keyed `<kind>:<id>`. */
const _histories = ref<Map<string, ItemHistory>>(new Map());

/** True while hydration is still loading. During hydration, `snapshot` is a no-op. */
let _loading = true;

/** The dirty set for IDB persistence, same pattern as builds.ts/layers.ts. */
const _dirtyIds = new Set<string>();
const SAVE_DEBOUNCE_MS = 250;

async function flushSave() {
  const keys = [..._dirtyIds];
  _dirtyIds.clear();
  for (const key of keys) {
    const h = _histories.value.get(key);
    if (h) {
      try {
        // Store the key inside the value so it's recoverable via getAll.
        await idb.put("history", key, { id: key, data: h });
      } catch {
        // non-critical — next save will retry
      }
    }
  }
}

const flushSaveDebounced = useDebounceFn(flushSave, SAVE_DEBOUNCE_MS);

function markDirty(key: string) {
  if (_loading) return;
  _dirtyIds.add(key);
  flushSaveDebounced();
}

// --- key helpers --------------------------------------------------------------------------

function keyFor(kind: "build" | "layer", id: string): string {
  return `${kind}:${id}`;
}

function historyFor(key: string): ItemHistory {
  let h = _histories.value.get(key);
  if (!h) {
    h = { past: [], future: [], lastKey: null, lastAt: 0 };
    _histories.value.set(key, h);
  }
  return h;
}

// --- computed accessors (always against the selected item) ---------------------------------

// A ref that higher-level modules (buildEditor.ts) can set to the active item's key when
// no selection is available (e.g. first load before the user has clicked anything).
// The computed accessors below try the selection first, then fall back to this ref.
export const activeKeyOverride = ref<string | null>(null);

function activeKeyOrFallback(): string | null {
  const sel = selection.selection.value;
  if (sel) return keyFor(sel.kind, sel.id);
  return activeKeyOverride.value;
}

export const canUndo = computed(() => {
  const key = activeKeyOrFallback();
  if (!key) return false;
  const h = _histories.value.get(key);
  return (h?.past.length ?? 0) > 0;
});

export const canRedo = computed(() => {
  const key = activeKeyOrFallback();
  if (!key) return false;
  const h = _histories.value.get(key);
  return (h?.future.length ?? 0) > 0;
});

export const undoLabel = computed(() => {
  const key = activeKeyOrFallback();
  if (!key) return "";
  const h = _histories.value.get(key);
  const past = h?.past;
  return past?.length ? past[past.length - 1].label : "";
});

export const redoLabel = computed(() => {
  const key = activeKeyOrFallback();
  if (!key) return "";
  const h = _histories.value.get(key);
  const future = h?.future;
  return future?.length ? future[future.length - 1].label : "";
});

// --- snapshot / undo / redo ----------------------------------------------------------------

/**
 * Records the current state **before** a change. `key` drives coalescing (700 ms window,
 * unchanged key collapses); `null` forces a distinct step. Clears `future`.
 *
 * `current` is the state to serialize — for builds the full build object, for layers the
 * overlay. The caller passes it in so this module doesn't need to import builds/layers.
 */
export function snapshot(
  kind: "build" | "layer",
  id: string,
  key: string | null,
  label: string,
  current: unknown,
) {
  if (_loading) return;
  const sk = keyFor(kind, id);
  const h = historyFor(sk);
  const now = Date.now();
  const coalesce =
    key != null &&
    key === h.lastKey &&
    now - h.lastAt < COALESCE_MS &&
    h.past.length > 0;

  if (!coalesce) {
    h.past.push({ json: JSON.stringify(current), label });
    if (h.past.length > UNDO_LIMIT) h.past.shift();
  }
  h.lastKey = key;
  h.lastAt = now;
  h.future.length = 0;
  markDirty(sk);
}

/**
 * Undo on the given item's stack. Returns the JSON to restore, or null if nothing to undo.
 * `kind` and `id` identify the stack; `current` is the current state (saved to the future
 * stack for redo). Also selects the item if it is not already selected (decision 47).
 */
export function undo(
  kind: "build" | "layer",
  id: string,
  current: unknown,
): string | null {
  const sk = keyFor(kind, id);
  const h = _histories.value.get(sk);
  if (!h || !h.past.length) return null;

  const entry = h.past.pop()!;
  h.future.push({ json: JSON.stringify(current), label: entry.label });
  h.lastKey = null;
  markDirty(sk);

  selectForKey(sk);
  return entry.json;
}

/**
 * Redo on the given item's stack. Returns the JSON to restore, or null if nothing to redo.
 * `kind` and `id` identify the stack; `current` is the current state (saved to the past
 * stack for undo). Also selects the item if it is not already selected (decision 47).
 */
export function redo(
  kind: "build" | "layer",
  id: string,
  current: unknown,
): string | null {
  const sk = keyFor(kind, id);
  const h = _histories.value.get(sk);
  if (!h || !h.future.length) return null;

  const entry = h.future.pop()!;
  h.past.push({ json: JSON.stringify(current), label: entry.label });
  h.lastKey = null;
  markDirty(sk);

  selectForKey(sk);
  return entry.json;
}

function selectForKey(key: string) {
  const sel = selection.selection.value;
  if (sel && keyFor(sel.kind, sel.id) === key) return;
  const [kind, id] = key.split(":") as ["build" | "layer", string];
  if (kind === "build") selection.selectBuild(id);
  else selection.selectLayer(id);
}

// --- lifecycle / hydration ----------------------------------------------------------------

/** Hydrate histories from IDB. Called by bootstrap. */
export function _init(histories: Map<string, ItemHistory>) {
  _histories.value = histories;
}

/** Called by bootstrap once hydration finishes so persistence can start. */
export function _setLoading(value: boolean) {
  _loading = value;
}

/** Delete a history entry (when an item is purged from the trash). */
export function _delete(key: string) {
  _histories.value.delete(key);
  _dirtyIds.delete(key);
  idb.remove("history", key).catch(() => {});
}

/** Get all history keys for the current set. */
export function _keys(): string[] {
  return [..._histories.value.keys()];
}
