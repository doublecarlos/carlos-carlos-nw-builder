// Which side rails are collapsed.
//
// A view preference, not a build edit: shared across every build, never on the undo stack, and
// persisted alongside the BuildEditor's section-expanded state under the same key (see
// storage.ts's `UiState`, whose write merges so the two owners don't clobber each other).
import { computed, reactive, watch } from "vue";
import * as storage from "../storage/storage";

/** The rails that can collapse. Ids are persisted, so they are part of the stored format. */
export const RAILS = {
  /** The left sidebar: builds, layers, trash. */
  nav: "nav",
  /** The right stats/bonuses panel. */
  details: "details",
  /** The layer editor's own list of entries. */
  layerEntries: "layerEntries",
} as const;

export type RailId = (typeof RAILS)[keyof typeof RAILS];

const stored = storage.loadUiState().collapsed ?? {};

/** Everything starts open: a rail the user has never touched should show its content. */
const state = reactive<Record<RailId, boolean>>({
  nav: stored.nav ?? false,
  details: stored.details ?? false,
  layerEntries: stored.layerEntries ?? false,
});

watch(state, () => {
  storage.saveUiState({ collapsed: { ...state } });
});

export const collapsed = (rail: RailId) => computed(() => state[rail]);

export const isCollapsed = (rail: RailId) => state[rail];

export function toggle(rail: RailId) {
  state[rail] = !state[rail];
}

/** Test seam: drops every collapse back to open. */
export function _reset() {
  for (const rail of Object.keys(state) as RailId[]) state[rail] = false;
}
