// A shared slot gets a row of its own in the Shared inputs section only while the build uses
// it, so the section lists what matters to this build and nothing else.
import { describe, expect, it } from "vitest";
import { leftOutOfSection, visibleRows } from "../../src/lib/row-visibility";
import {
  sharedRowIds,
  sharedUsers,
  usedByNote,
} from "../../src/lib/shared-inputs";
import type { InputEntry } from "../../src/engine/inputs";
import type { Build, BuildParameterSlot, Slot } from "../../src/types";

const song: BuildParameterSlot = {
  id: "globals.song",
  label: "Played a song",
  section: "globals",
  type: "build_parameter",
  paramType: "boolean",
  path: "globals.song",
  default: false,
  globalInput: true,
};
const note: Slot = {
  id: "globals.note",
  section: "globals",
  type: "text",
  text: "Set once here",
};
const build = { choices: {}, context: {} } as unknown as Build;

const reader = (source: string, slotId: string): InputEntry =>
  ({
    source,
    slotId,
    bonusInput: { bonusId: source, name: "song" },
  }) as InputEntry;

describe("shared rows", () => {
  it("shows a param's row only while an equipped bonus reads it", () => {
    expect(sharedRowIds([song], build, new Map())).toEqual(new Set());
    expect(
      sharedRowIds([song], build, new Map([[song.id, ["Ballad"]]])),
    ).toEqual(new Set([song.id]));
  });

  // Two items carrying one bonus are one reader to the player.
  it("names each reading bonus once, in build order", () => {
    const users = sharedUsers(
      new Map([
        [
          song.id,
          [reader("Ballad", "a"), reader("Chorus", "b"), reader("Ballad", "c")],
        ],
      ]),
    );
    expect(users.get(song.id)).toEqual(["Ballad", "Chorus"]);
    expect(usedByNote(users.get(song.id))).toBe("Used by Ballad, Chorus");
    expect(usedByNote(undefined)).toBeUndefined();
  });

  it("hides the section's text row along with an unused shared row", () => {
    const rows = [note, song];
    const shown = (used: ReadonlySet<string>) =>
      visibleRows(rows, (row) => !leftOutOfSection(row, used));
    expect(shown(new Set())).toEqual([]);
    expect(shown(new Set([song.id]))).toEqual([note, song]);
  });
});
