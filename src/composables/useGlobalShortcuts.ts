// App-wide shortcuts with no natural home in a single component:
//
//   Ctrl+/ (⌘+/ on Mac) focuses the slot filter box while a build is being edited.
//   Ctrl+K (⌘+K)        opens the "go to" palette.
//   ?                   opens the keyboard shortcut overlay.
//
// `/` and `?` are guarded the same way: typed while a slot filter or any other field has
// focus they should produce the character, not run a command, so the handler bails while a
// form control is active -- the same guard useUndoRedoKeys follows. Mod+K carries its own
// modifier and so types nothing; it is checked ahead of that guard on purpose.
//
// A plain `keydown` listener rather than `useMagicKeys`: VueUse registers that one passively,
// which makes `preventDefault` a no-op ("Unable to preventDefault inside passive event listener
// invocation") -- and preventing the default is the point for both of these. Firefox opens its
// quick-find on `/`, and `?` is Shift+/ on most layouts, so both reach that same feature.
import { useEventListener } from "@vueuse/core";
import { isFormControl } from "./focus";
import { isMac } from "../lib/platform";
import * as shortcutHelp from "../stores/shortcutHelp";
import * as goTo from "../stores/goTo";

export function useGlobalShortcuts() {
  useEventListener(window, "keydown", (event: KeyboardEvent) => {
    // Checked ahead of the form-control guard below, and so the only one of these that works
    // from inside a field: a palette you cannot reach while the cursor sits in the slot filter
    // is a palette you have to think about. K rather than G because Ctrl+G is find-next in
    // Firefox, while Mod+K is what every palette is bound to and is routinely overridden.
    if (
      event.key.toLowerCase() === "k" &&
      (isMac ? event.metaKey : event.ctrlKey)
    ) {
      event.preventDefault();
      goTo.toggle();
      return;
    }

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
