// Whether the stable browser is open, and which group it applies to when it was opened from
// one. A view preference: never on the undo stack, never persisted. Holding the group is what
// makes the browser set the mount it was opened from; without one it is a reference table.
import { ref } from "vue";

/** Which end of the reference to open on, and which row to land on. */
export interface StableFocus {
  tab: "mount" | "bonus";
  query: string;
}

export const isOpen = ref(false);
export const group = ref<number | null>(null);
export const focus = ref<StableFocus | null>(null);

export const openFor = (n: number, on: StableFocus | null = null) => {
  isOpen.value = true;
  group.value = n;
  focus.value = on;
};

/** No group, so nothing to set: which mounts reach which bonuses, on its own. */
export const openReference = () => {
  isOpen.value = true;
  group.value = null;
  focus.value = null;
};

export const close = () => {
  isOpen.value = false;
  group.value = null;
  focus.value = null;
};
