// App-wide shortcuts with no natural home in a single component: Ctrl+N/⌘N for "New build",
// and `/` to focus whichever filter box is relevant to the current view -- the slot filter
// while editing a build, the builds list filter otherwise. Skips both while a form control
// has focus, following the same guard as useUndoRedoKeys, so typing in a field is never
// hijacked.
import { computed } from "vue";
import { useMagicKeys, whenever } from "@vueuse/core";
import { isFormControl } from "./focus";
import { isMac } from "../lib/platform";
import * as builds from "../stores/builds";
import * as selection from "../stores/selection";

export function useGlobalShortcuts() {
  const keys = useMagicKeys({
    onEventFired(event) {
      if (event.type !== "keydown" || isFormControl(document.activeElement))
        return;
      const isNewBuildCombo =
        event.key.toLowerCase() === "n" &&
        (isMac ? event.metaKey : event.ctrlKey);
      if (event.key === "/" || isNewBuildCombo) event.preventDefault();
    },
  });

  const newBuildPressed = computed(() =>
    isMac ? keys.meta_n.value : keys.ctrl_n.value,
  );

  whenever(newBuildPressed, () => {
    if (!isFormControl(document.activeElement)) builds.createBuild();
  });

  whenever(keys["/"], () => {
    if (isFormControl(document.activeElement)) return;
    // Mirrors App.vue's own routing: it shows BuildEditor whenever the selection isn't a
    // layer -- including a null selection, which `builds.build` transparently falls back
    // to the first build for -- so "not a layer" is what actually determines which filter
    // is on screen, not "is a build".
    const testId =
      selection.selection.value?.kind === "layer"
        ? "nav-builds-filter"
        : "slot-filter-text";
    document
      .querySelector<HTMLInputElement>(`[data-testid="${testId}"]`)
      ?.focus();
  });
}
