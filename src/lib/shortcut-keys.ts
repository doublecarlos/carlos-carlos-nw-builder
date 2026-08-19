// Turns the chord strings in data/shortcuts.json into the keys to render, one <kbd> per token.
//
// Chords are written platform-neutrally: `Mod` is whichever modifier this app actually binds
// for that shortcut -- ⌘ on a Mac, Ctrl everywhere else, matching `lib/platform`'s `isMac`
// switch in the handlers themselves. A chord that really does mean Ctrl on every platform
// (Ctrl+Y for redo, which useUndoRedoKeys binds without a meta variant) spells `Ctrl`, and is
// left alone here.

/** The token the JSON uses for "this app's own modifier for this shortcut". */
const MOD = "Mod";

/**
 * Splits one chord into its keys, with `Mod` resolved for the platform.
 *
 * `mac` is a parameter rather than read from `lib/platform` so the mapping stays a pure
 * function -- the caller passes `isMac`, and a test can ask for either platform without
 * faking a user agent.
 */
export function chordKeys(chord: string, mac: boolean): string[] {
  return chord
    .split("+")
    .map((key) => (key === MOD ? (mac ? "⌘" : "Ctrl") : key));
}
