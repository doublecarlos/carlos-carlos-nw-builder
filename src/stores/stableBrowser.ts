// Whether the stable browser is open, which end of the reference it is showing, and which
// group it applies to when it was opened from one. A view preference: never on the undo stack,
// never persisted. Holding the group is what makes the browser set the mount it was opened
// from; without one it is a reference table.
//
// The tab and the filter live here rather than inside StableBrowser.vue so the URL can mirror
// them (App.vue's `?stable=`) without reaching into a modal's local state.
import { ref } from "vue";

export type StableTab = "mount" | "bonus";

export const isOpen = ref(false);
export const group = ref<number | null>(null);
export const tab = ref<StableTab>("mount");
export const query = ref("");

/** Which end of the reference to open on, and which row to land on. */
export interface StableFocus {
  tab: StableTab;
  query: string;
}

const focusOn = (on: StableFocus | null) => {
  tab.value = on?.tab ?? "mount";
  query.value = on?.query ?? "";
};

export const openFor = (n: number, on: StableFocus | null = null) => {
  isOpen.value = true;
  group.value = n;
  focusOn(on);
};

/** No group, so nothing to set: which mounts reach which bonuses, on its own. */
export const openReference = (on: StableFocus | null = null) => {
  isOpen.value = true;
  group.value = null;
  focusOn(on);
};

export const close = () => {
  isOpen.value = false;
  group.value = null;
  focusOn(null);
};
