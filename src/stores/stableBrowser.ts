// Which stable group, if any, has the stable browser open over it. A view preference: never on
// the undo stack, never persisted. Holding the group rather than a boolean is what makes the
// browser apply to the mount it was opened from.
import { ref } from "vue";

/** Which end of the reference to open on, and which row to land on. */
export interface StableFocus {
  tab: "mount" | "bonus";
  query: string;
}

export const group = ref<number | null>(null);
export const focus = ref<StableFocus | null>(null);

export const openFor = (n: number, on: StableFocus | null = null) => {
  group.value = n;
  focus.value = on;
};

export const close = () => {
  group.value = null;
  focus.value = null;
};
