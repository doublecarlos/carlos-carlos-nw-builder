// The race ability score rules, authored as data: each race item tags the ability score
// items it allows, and each ability score item flags itself when the race lacks that tag.
import { describe, it, expect } from "vitest";
import * as db from "../../src/data/db";
import * as engine from "../../src/engine/engine";
import { storedListRows } from "../../src/lib/item-picker-list";
import type { Build } from "../../src/types";

const built = db.fromData();

const RACE = "raceLeveling.race";
const PICK_1 = "raceLeveling.raceAttributes1";
const PICK_2 = "raceLeveling.raceAttributes2";

/** Slot ids of every race ability score error the build raises. */
function flaggedSlots(choices: Record<string, string>): string[] {
  const build = {
    choices,
    values: {},
    context: { class: "warlock", role: "dps", toggles: {} },
    listRows: storedListRows({
      choices,
      values: {},
      assignments: {},
      disabledSlots: {},
    }),
  } as unknown as Build;
  return engine
    .resolveBuild(built, build)
    .errors.filter((e) => e.label === "Race Ability Scores")
    .map((e) => e.slotId)
    .sort();
}

describe("race ability scores", () => {
  it("accepts a choice the race allows", () => {
    expect(
      flaggedSlots({
        [RACE]: "race-moon-elf",
        [PICK_1]: "race-attributes-2-cha",
      }),
    ).toEqual([]);
  });

  it("flags a choice the race does not allow", () => {
    expect(
      flaggedSlots({
        [RACE]: "race-moon-elf",
        [PICK_1]: "race-attributes-2-str",
      }),
    ).toEqual([PICK_1]);
  });

  it("flags only the disallowed pick of a two-pick race", () => {
    expect(
      flaggedSlots({
        [RACE]: "race-aasimar",
        [PICK_1]: "race-attributes-2-str",
        [PICK_2]: "race-attributes-3-cha",
      }),
    ).toEqual([PICK_2]);
  });

  it("allows two picks only for a two-pick race", () => {
    const picks = {
      [PICK_1]: "race-attributes-2-str",
      [PICK_2]: "race-attributes-2-wis",
    };
    expect(flaggedSlots({ [RACE]: "race-dragonborn", ...picks })).toEqual([]);
    // A bonus shared by both picks reports once, on one of them.
    expect(flaggedSlots({ [RACE]: "race-dwarf", ...picks })).toHaveLength(1);
  });

  it("restricts the +3 choices to humans", () => {
    expect(
      flaggedSlots({ [RACE]: "race-human", [PICK_1]: "race-attributes-3-dex" }),
    ).toEqual([]);
    expect(
      flaggedSlots({ [RACE]: "race-human", [PICK_1]: "race-attributes-2-dex" }),
    ).toEqual([PICK_1]);
  });

  it("raises nothing before a race is picked", () => {
    expect(
      flaggedSlots({
        [PICK_1]: "race-attributes-2-str",
        [PICK_2]: "race-attributes-3-cha",
      }),
    ).toEqual([]);
  });
});
