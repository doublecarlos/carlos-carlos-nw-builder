// Narrow-viewport shell state: whether the nav drawer is open and which pane a phone shows.
//
// Held in memory only. It describes the current visit on a small screen, so it is never
// persisted and never touches the desktop rail preferences in `rails.ts`.
import { computed, ref, shallowRef } from "vue";
import type { PhonePane } from "../lib/shell-layout";

export const navDrawerOpen = ref(false);

export const phonePane = ref<PhonePane>("editor");

const _paneBack = shallowRef<(() => void) | null>(null);

/** What Back does while the pane a jump brought up is still showing: return to where the jump
 *  started. App.vue holds Back for it on the phone layout. */
export const paneBack = computed(() => _paneBack.value);

/** Brings `pane` up on a phone. Called by the stores whose requests land in one pane, so an
 *  action taken from the other pane follows its result there. Wider layouts show both panes,
 *  and the value only decides where a later phone layout opens.
 *
 *  `back` makes the jump one that Back undoes. Any later pane change, the pane switch included,
 *  drops it: by then the user has moved on from the jump. */
export function showPane(pane: PhonePane, back?: () => void) {
  phonePane.value = pane;
  _paneBack.value = back ?? null;
}

export function openNavDrawer() {
  navDrawerOpen.value = true;
}

export function closeNavDrawer() {
  navDrawerOpen.value = false;
}
