// Light/dark/system preference. Uses VueUse's useStorage for reactive localStorage sync
// (synchronous reads → no flash of wrong theme on first paint). Also reflects onto the DOM
// via a `.dark` class on <html> since theme.css's CSS vars key off it.
import { computed, ref } from "vue";
import { useStorage } from "@vueuse/core";
import type { ThemePreference } from "../storage/storage";

export const preference = useStorage<ThemePreference>("nw:theme", "system");
const media =
  typeof window !== "undefined"
    ? window.matchMedia("(prefers-color-scheme: dark)")
    : null;
const systemDark = ref(media?.matches ?? false);
export const isDark = computed(() =>
  preference.value === "system"
    ? systemDark.value
    : preference.value === "dark",
);

function apply() {
  document.documentElement.classList.toggle("dark", isDark.value);
}

export function setPreference(pref: ThemePreference) {
  preference.value = pref;
  apply();
}

/** System -> Light -> Dark -> System. One button, three states, no dropdown needed. */
export function cyclePreference() {
  const order: ThemePreference[] = ["system", "light", "dark"];
  setPreference(order[(order.indexOf(preference.value) + 1) % order.length]);
}

export function initTheme() {
  // useStorage already reads from localStorage synchronously during setup.
  media?.addEventListener("change", (event) => {
    systemDark.value = event.matches;
    if (preference.value === "system") apply();
  });
  apply();
}
