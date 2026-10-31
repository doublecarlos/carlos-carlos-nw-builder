// Narrow-viewport shell state: whether the nav drawer is open and which pane a phone shows.
//
// Held in memory only. It describes the current visit on a small screen, so it is never
// persisted and never touches the desktop rail preferences in `rails.ts`.
import { ref } from "vue";
import type { PhonePane } from "../lib/shell-layout";

export const navDrawerOpen = ref(false);

export const phonePane = ref<PhonePane>("editor");

/** Brings `pane` up on a phone. Called by the stores whose requests land in one pane, so an
 *  action taken from the other pane follows its result there. Wider layouts show both panes,
 *  and the value only decides where a later phone layout opens. */
export function showPane(pane: PhonePane) {
  phonePane.value = pane;
}

export function openNavDrawer() {
  navDrawerOpen.value = true;
}

export function closeNavDrawer() {
  navDrawerOpen.value = false;
}
