// Per-layer UI state for LayerEditor.vue -- which section/filter/selection was active.
//
// Switching to the build editor swaps the whole LayerEditor instance out (App.vue's
// v-if/v-else), so its local refs are lost on unmount. LayerEditor.vue itself still owns the
// URL (its own corner of the query string, cleared on unmount to keep a build's URL clean),
// but a fresh mount needs *something* to fall back on once that URL is gone -- this is that
// something. Field names mirror the router params (`item`/`bonus`/`preset`/`section`/`status`/
// `q`) so a mounting component can treat "the URL" and "the stored state" as interchangeable
// sources.
import { reactive } from "vue";
import type { Item } from "../types";

export interface LayerEditorUiState {
  section: string;
  item: string;
  bonus: string;
  preset: string;
  status: string;
  q: string;
}

function defaults(): LayerEditorUiState {
  return { section: "", item: "", bonus: "", preset: "", status: "", q: "" };
}

const states = new Map<string, LayerEditorUiState>();

/** The reactive state record for a layer, created empty on first use and reused after. */
export function getState(layerId: string): LayerEditorUiState {
  let state = states.get(layerId);
  if (!state) {
    state = reactive(defaults()) as LayerEditorUiState;
    states.set(layerId, state);
  }
  return state;
}

// --- pending new-item seed ----------------------------------------------------------------
// Not per-layer state like the record above: a one-shot handoff to whichever LayerEditor mounts
// next. BuildEditor.vue leaves a blank item here when Ctrl/Cmd+click lands on an empty slot row
// (`newItemSeedFor`), so the item form's very first render already knows what that row can
// hold. Deliberately not reactive -- it is read once, during the mounting component's setup,
// and never rendered from.

let pendingNewItem: Item | null = null;

/** Hands the next mounting LayerEditor an item to build a brand-new draft from. */
export function seedNewItem(seed: Item) {
  pendingNewItem = seed;
}

/** Reads the pending seed and clears it in the same call: a seed belongs to exactly the mount
 * it was set up for, and must not resurrect on a later visit to the same layer. */
export function takeNewItemSeed(): Item | null {
  const seed = pendingNewItem;
  pendingNewItem = null;
  return seed;
}
