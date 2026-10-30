// Per-layer UI state for LayerEditor.vue: which tab, search and selection were active.
//
// Switching to the build editor swaps the whole LayerEditor instance out (App.vue's
// v-if/v-else), so its local refs are lost on unmount. LayerEditor.vue itself still owns the
// URL (its own corner of the query string, cleared on unmount to keep a build's URL clean),
// but a fresh mount needs *something* to fall back on once that URL is gone. Field names
// mirror the router params so either can be the source. Only one of `slot`/`preset`/`sectionId`
// is set at a time; `slotsGroup` is the Slots tab group last shown. `view` is the phone's
// master-detail half, never in the URL; like the rest of this record it lasts the session.
import { reactive, readonly, shallowRef } from "vue";
import * as router from "../lib/router";
import * as layers from "./layers";
import * as selection from "./selection";
import type { Item, SectionPreset } from "../types";
import type { LayerEditorView } from "../lib/layer-editor-layout";

export interface LayerEditorUiState {
  section: string;
  item: string;
  bonus: string;
  preset: string;
  slot: string;
  sectionId: string;
  slotsGroup: string;
  filter: string;
  status: string;
  q: string;
  view: LayerEditorView;
}

function defaults(): LayerEditorUiState {
  return {
    section: "",
    item: "",
    bonus: "",
    preset: "",
    slot: "",
    sectionId: "",
    slotsGroup: "",
    filter: "",
    status: "",
    q: "",
    view: "list",
  };
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
// Not per-layer state like the record above: a one-shot handoff to the next LayerEditor to
// show it. BuildEditor.vue leaves a blank item here when Ctrl/Cmd+click lands on an empty slot
// row (`newItemSeedFor`), so the item form's very first render already knows what that row can
// hold. A mounting editor takes it during setup; one already showing watches `newItemSeed`.

const pendingNewItem = shallowRef<Item | null>(null);

/** The seed waiting for an editor, for one already mounted to pick up. */
export const newItemSeed = readonly(pendingNewItem);

/** Hands the next mounting LayerEditor an item to build a brand-new draft from. */
export function seedNewItem(seed: Item) {
  pendingNewItem.value = seed;
}

/** Reads the pending seed and clears it in the same call: a seed belongs to exactly the mount
 * it was set up for, and must not resurrect on a later visit to the same layer. */
export function takeNewItemSeed(): Item | null {
  const seed = pendingNewItem.value;
  pendingNewItem.value = null;
  return seed;
}

/** Opens the target layer's editor on a new item draft built from `seed`, whether or not an
 * editor is already showing. Seeded only once the selection lands, so a cancelled discard
 * leaves nothing pending. */
export async function openNewItem(seed: Item) {
  const layer = layers.ensureTargetLayer();
  const selected = selection.selectLayer(layer.id);
  if (!(selected instanceof Promise ? await selected : selected)) return;
  router.apply({ item: null });
  seedNewItem(seed);
}

// --- pending new-preset seed ---------------------------------------------------------------
// The same one-shot handoff for BuildSection's "Create new from current": the build editor
// snapshots a section into a preset shape, and whichever LayerEditor mounts next opens the
// Slots tab on an unsaved preset draft already holding it.

let pendingNewPreset: SectionPreset | null = null;

/** Hands the next mounting LayerEditor a preset to build a brand-new draft from. */
export function seedNewPreset(seed: SectionPreset) {
  pendingNewPreset = seed;
}

/** Reads the pending preset seed and clears it -- same one-mount contract as
 * `takeNewItemSeed`. */
export function takeNewPresetSeed(): SectionPreset | null {
  const seed = pendingNewPreset;
  pendingNewPreset = null;
  return seed;
}
