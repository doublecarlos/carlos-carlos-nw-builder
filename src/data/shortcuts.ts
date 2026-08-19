// The one list of keyboard shortcuts the app advertises, statically imported the same way
// the game data is.
//
// It lives in data/ rather than inline in the overlay so there is a single place to edit when
// a binding changes -- the overlay renders this, and nothing else states the bindings in prose
// any more (the nav and toolbar used to, and drifted).
import raw from "../../data/shortcuts.json";

export interface ShortcutBinding {
  /** Alternative chords for the same action, rendered "A or B". Tokens are `+`-joined; see
   *  lib/shortcut-keys.ts for how `Mod` resolves per platform. */
  keys: string[];
  description: string;
}

export interface ShortcutGroup {
  id: string;
  /** Where these apply -- the overlay's section heading. */
  label: string;
  shortcuts: ShortcutBinding[];
}

export const SHORTCUT_GROUPS: ShortcutGroup[] = raw.groups;
