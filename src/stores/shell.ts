// Narrow-viewport shell state: whether the nav drawer is open and which pane a phone shows.
//
// The drawer is held in memory only, and the pane in the URL on a phone. Neither is persisted
// or touches the desktop rail preferences in `rails.ts`.
import { computed, ref, shallowRef } from "vue";
import { navigation } from "../lib/navigation";
import type { PhonePane } from "../lib/shell-layout";
import * as viewport from "./viewport";

export const navDrawerOpen = ref(false);

/** The pane a wider layout last asked for. Only a phone shows one pane at a time, and there
 *  the route holds it. */
const widePane = ref<PhonePane>("editor");

export const phonePane = computed<PhonePane>(() => {
  if (!viewport.isPhone.value) return widePane.value;
  return navigation.route.value.pane === "stats" ? "stats" : "editor";
});

/** What Back does on top of returning to the editor pane, while the pane a jump brought up is
 *  still showing: return to where the jump started. */
const paneBack = shallowRef<(() => void) | null>(null);

/** Brings `pane` up. Called by the stores whose requests land in one pane, so an action taken
 *  from the other pane follows its result there. On a phone the pane is a place in the URL,
 *  so Back returns to the pane before; wider layouts show both panes and keep the URL as is.
 *
 *  `back` runs when Back undoes this jump. Any later pane change, the pane switch included,
 *  drops it: by then the user has moved on from the jump. */
export function showPane(pane: PhonePane, back?: () => void) {
  widePane.value = pane;
  paneBack.value = back ?? null;
  if (viewport.isPhone.value)
    navigation.write({ pane: pane === "stats" ? "stats" : null });
}

// Back off the pane a jump brought up returns to where the jump started.
navigation.onTraverse((to, from) => {
  const back = paneBack.value;
  paneBack.value = null;
  if (back && from.pane === "stats" && to.pane !== "stats") back();
});

export function openNavDrawer() {
  navDrawerOpen.value = true;
}

export function closeNavDrawer() {
  navDrawerOpen.value = false;
}
