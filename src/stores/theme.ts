// Light/dark/system preference. Same shape as ui.ts's view state -- a small reactive slice
// with its own persistence -- but this one also has to reflect onto the DOM itself, since
// `theme.css`'s `@custom-variant dark` (and every `dark:`-free color utility, which reads the
// `.dark`-swapped CSS vars instead) key off a `.dark` class on <html>, not a Vue-owned element.
import { computed, ref } from "vue";
import * as storage from "../storage";
import type { ThemePreference } from "../storage";

const _preference = ref<ThemePreference>("system");
const media =
  typeof window !== "undefined"
    ? window.matchMedia("(prefers-color-scheme: dark)")
    : null;
const systemDark = ref(media?.matches ?? false);

export const preference = computed(() => _preference.value);
export const isDark = computed(() =>
  _preference.value === "system"
    ? systemDark.value
    : _preference.value === "dark",
);

function apply() {
  document.documentElement.classList.toggle("dark", isDark.value);
}

export function setPreference(pref: ThemePreference) {
  _preference.value = pref;
  storage.saveThemePreference(pref);
  apply();
}

/** System -> Light -> Dark -> System. One button, three states, no dropdown needed. */
export function cyclePreference() {
  const order: ThemePreference[] = ["system", "light", "dark"];
  setPreference(order[(order.indexOf(_preference.value) + 1) % order.length]);
}

export function initTheme() {
  _preference.value = storage.loadThemePreference();
  media?.addEventListener("change", (event) => {
    systemDark.value = event.matches;
    if (_preference.value === "system") apply();
  });
  apply();
}
