// A shared slot gets a row of its own in the Shared inputs section only while the build uses
// it, so the section lists what matters to this build and nothing else.
import { describe, expect, it } from "vitest";
import { leftOutOfSection, visibleRows } from "../../src/lib/row-visibility";
import {
  sharedReaderRows,
  sharedRowIds,
  sharedTooltip,
  usedByLinks,
} from "../../src/lib/shared-inputs";
import type { InputEntry } from "../../src/engine/inputs";
import type { Build, BuildParameterSlot, Db, Slot } from "../../src/types";

const song: BuildParameterSlot = {
  id: "shared.song",
  label: "Played a song",
  section: "shared",
  type: "build_parameter",
  paramType: "boolean",
  path: "shared.song",
  default: false,
  sharedInput: true,
};
const note: Slot = {
  id: "shared.note",
  section: "shared",
  type: "text",
  text: "Set once here",
};
const build = { choices: {}, context: {} } as unknown as Build;

const labels: Record<string, string> = { a: "Ring", b: "Neck", c: "Belt" };
const db = {
  slotFor: (id: string) => (labels[id] ? { label: labels[id] } : undefined),
  slotById: new Map([[song.id, song]]),
  sections: [{ id: "shared", label: "Shared inputs", slotIds: [] }],
} as unknown as Db;

const reader = (source: string, slotId: string): InputEntry =>
  ({
    source,
    slotId,
    bonusInput: { bonusId: source, name: "song" },
  }) as InputEntry;

describe("shared rows", () => {
  it("shows a param's row only while an equipped bonus reads it", () => {
    expect(sharedRowIds([song], build, new Map())).toEqual(new Set());
    expect(sharedRowIds([song], build, new Map([[song.id, ["a"]]]))).toEqual(
      new Set([song.id]),
    );
  });

  // The player knows rows, not bonuses: two readers on one row are one place to look.
  it("names each reading row once, in build order", () => {
    const rows = sharedReaderRows(
      new Map([
        [
          song.id,
          [reader("Ballad", "a"), reader("Chorus", "b"), reader("Solo", "a")],
        ],
      ]),
    );
    expect(rows.get(song.id)).toEqual(["a", "b"]);
    expect(usedByLinks(db, rows.get(song.id))).toEqual([
      { key: "a", label: "Ring" },
      { key: "b", label: "Neck" },
    ]);
    expect(usedByLinks(db, undefined)).toEqual([]);
  });

  // The tooltip tells the player that editing this control also changes the other places.
  it("names the other reader rows in a reader's tooltip", () => {
    expect(sharedTooltip(db, "a", ["a", "b", "c"])).toBe(
      "Shared input, also on Neck and Belt",
    );
    expect(sharedTooltip(db, "a", ["a"])).toBe("Shared input");
  });

  it("hides the section's text row along with an unused shared row", () => {
    const rows = [note, song];
    const shown = (used: ReadonlySet<string>) =>
      visibleRows(rows, (row) => !leftOutOfSection(row, used));
    expect(shown(new Set())).toEqual([]);
    expect(shown(new Set([song.id]))).toEqual([note, song]);
  });
});
