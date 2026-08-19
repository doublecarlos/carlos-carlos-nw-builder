// Chord rendering, plus a shape check on the data the overlay reads -- the list is the one
// place bindings are stated, so a malformed entry would silently show a blank row.
import { describe, it, expect } from "vitest";
import { chordKeys } from "../../src/lib/shortcut-keys";
import { SHORTCUT_GROUPS } from "../../src/data/shortcuts";

describe("chordKeys", () => {
  it("splits a chord into one key per token", () => {
    expect(chordKeys("Mod+Shift+Z", false)).toEqual(["Ctrl", "Shift", "Z"]);
  });

  it("resolves Mod per platform", () => {
    expect(chordKeys("Mod+Z", false)).toEqual(["Ctrl", "Z"]);
    expect(chordKeys("Mod+Z", true)).toEqual(["⌘", "Z"]);
  });

  it("leaves a literal Ctrl alone on a Mac", () => {
    // Ctrl+Y is bound as Ctrl on every platform (useUndoRedoKeys has no meta variant for it),
    // which is exactly why the data distinguishes `Ctrl` from `Mod`.
    expect(chordKeys("Ctrl+Y", true)).toEqual(["Ctrl", "Y"]);
  });

  it("passes a single key through", () => {
    expect(chordKeys("F2", false)).toEqual(["F2"]);
    expect(chordKeys("?", false)).toEqual(["?"]);
  });
});

describe("SHORTCUT_GROUPS", () => {
  it("has groups with unique ids", () => {
    const ids = SHORTCUT_GROUPS.map((group) => group.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every shortcut a description and at least one chord", () => {
    // Collected rather than asserted in place: a failure then names every malformed entry at
    // once, and reads as the offending data instead of "expected true to be truthy".
    const problems: string[] = [];
    for (const group of SHORTCUT_GROUPS) {
      if (!group.label) problems.push(`${group.id}: no label`);
      if (!group.shortcuts.length) problems.push(`${group.id}: no shortcuts`);
      for (const shortcut of group.shortcuts) {
        const where = `${group.id}/${shortcut.description || "(no description)"}`;
        if (!shortcut.description) problems.push(`${where}: no description`);
        if (!shortcut.keys.length) problems.push(`${where}: no chords`);
        for (const chord of shortcut.keys) {
          if (!chord || chord.trim() !== chord) {
            problems.push(`${where}: malformed chord ${JSON.stringify(chord)}`);
          }
        }
      }
    }

    expect(problems).toEqual([]);
  });

  it("advertises the shortcut that opens the list itself", () => {
    const chords = SHORTCUT_GROUPS.flatMap((group) =>
      group.shortcuts.flatMap((shortcut) => shortcut.keys),
    );
    expect(chords).toContain("?");
  });
});
