// Narrow-viewport shell state: whether the nav drawer is open and which pane a phone shows.
//
// Held in memory only. It describes the current visit on a small screen, so it is never
// persisted and never touches the desktop rail preferences in `rails.ts`.
import { ref } from "vue";
import type { PhonePane } from "../lib/shell-layout";

export const navDrawerOpen = ref(false);

export const phonePane = ref<PhonePane>("editor");

export function openNavDrawer() {
  navDrawerOpen.value = true;
}

export function closeNavDrawer() {
  navDrawerOpen.value = false;
}
