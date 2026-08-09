// App-wide shortcut with no natural home in a single component: Ctrl+/ (⌘+/ on Mac) focuses
// the slot filter box while a build is being edited. Plain `/` isn't used -- typing it while a
// slot filter or other field already has focus should just type the character, not steal focus
// -- so the guard below skips both the preventDefault and the focus jump while a form control
// is active, following the same guard as useUndoRedoKeys.
import { computed } from "vue";
import { useMagicKeys, whenever } from "@vueuse/core";
import { isFormControl } from "./focus";
import { isMac } from "../lib/platform";

export function useGlobalShortcuts() {
  const keys = useMagicKeys({
    onEventFired(event) {
      if (event.type !== "keydown" || isFormControl(document.activeElement))
        return;
      const isSlotFilterCombo =
        event.key === "/" && (isMac ? event.metaKey : event.ctrlKey);
      if (isSlotFilterCombo) event.preventDefault();
    },
  });

  const slotFilterPressed = computed(() =>
    isMac ? keys["meta_/"].value : keys["ctrl_/"].value,
  );

  whenever(slotFilterPressed, () => {
    if (isFormControl(document.activeElement)) return;
    document
      .querySelector<HTMLInputElement>('[data-testid="slot-filter-text"]')
      ?.focus();
  });
}
