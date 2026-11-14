// Per-layer UI state for LayerEditor.vue: which tab, search and selection were active.
//
// Switching to the build editor swaps the whole LayerEditor instance out (App.vue's
// v-if/v-else), so its local refs are lost on unmount. LayerEditor.vue itself still owns the
// URL (its own corner of the query string, cleared on unmount to keep a build's URL clean),
// but a fresh mount needs *something* to fall back on once that URL is gone. Field names
// mirror the route params so either can be the source. Only one of `slot`/`preset`/`sectionId`
// is set at a time; `lastGroup` is the group each multi-group tab last showed. `view` is the phone's
// master-detail half last shown, which the route itself decides while the editor is mounted;
// like the rest of this record it lasts the session.
import { reactive, readonly, shallowRef } from "vue";
import * as layers from "./layers";
import * as selection from "./selection";
import type { Item, SectionPreset } from "../types";
import type { LayerEditorView } from "../lib/layer-editor-layout";
import {
  defaultItemListFilter,
  type ItemListFilter,
} from "../lib/item-list-filter";

export interface LayerEditorUiState {
  section: string;
  item: string;
  bonus: string;
  preset: string;
  slot: string;
  sectionId: string;
  /** The group last shown, by tab, for the tabs that host several. */
  lastGroup: Record<string, string>;
  filter: string;
  tag: string;
  status: string;
  q: string;
  /** The Items tab's quality, category and retired filters, never in the URL. */
  itemFilter: ItemListFilter;
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
    lastGroup: {},
    filter: "",
    tag: "",
    status: "",
    q: "",
    itemFilter: defaultItemListFilter(),
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
  seedNewItem(seed);
}

/** The layer whose next mounting editor should show its open entry in the list. */
let pendingReveal: string | null = null;

/** Opens item `itemId` in the target layer's editor, showing it in the list. The layer's memory
 *  is set first, since a mounting editor restores from it. */
export function openItem(itemId: string) {
  const layer = layers.ensureTargetLayer();
  Object.assign(getState(layer.id), {
    section: "items",
    item: itemId,
    view: "detail",
  });
  pendingReveal = layer.id;
  selection.selectLayer(layer.id);
}

/** Whether `layerId`'s editor was opened by a jump to show, cleared as it is read. */
export function takeReveal(layerId: string): boolean {
  const asked = pendingReveal === layerId;
  pendingReveal = null;
  return asked;
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
