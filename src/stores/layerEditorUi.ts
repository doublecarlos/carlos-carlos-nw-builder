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
