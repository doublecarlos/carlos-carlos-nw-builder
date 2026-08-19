// App-wide shortcuts with no natural home in a single component:
//
//   Ctrl+/ (⌘+/ on Mac) focuses the slot filter box while a build is being edited.
//   ?                   opens the keyboard shortcut overlay.
//
// Both are guarded the same way: typing `/` or `?` while a slot filter or any other field has
// focus should produce the character, not run a command, so the handler bails while a form
// control is active -- the same guard useUndoRedoKeys follows.
//
// A plain `keydown` listener rather than `useMagicKeys`: VueUse registers that one passively,
// which makes `preventDefault` a no-op ("Unable to preventDefault inside passive event listener
// invocation") -- and preventing the default is the point for both of these. Firefox opens its
// quick-find on `/`, and `?` is Shift+/ on most layouts, so both reach that same feature.
import { useEventListener } from "@vueuse/core";
import { isFormControl } from "./focus";
import { isMac } from "../lib/platform";
import * as shortcutHelp from "../stores/shortcutHelp";

export function useGlobalShortcuts() {
  useEventListener(window, "keydown", (event: KeyboardEvent) => {
    if (isFormControl(document.activeElement)) return;

    if (event.key === "/" && (isMac ? event.metaKey : event.ctrlKey)) {
      event.preventDefault();
      document
        .querySelector<HTMLInputElement>('[data-testid="slot-filter-text"]')
        ?.focus();
      return;
    }

    // Matched on the character rather than Shift plus a key, so layouts that put `?` somewhere
    // other than Shift+/ still reach it.
    if (event.key === "?") {
      event.preventDefault();
      shortcutHelp.open();
    }
  });
}
