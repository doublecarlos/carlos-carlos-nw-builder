// The race ability score pattern the catalog authors as data: each race item tags the ability
// score items it allows, and each ability score item flags itself when the race lacks that
// tag. A synthetic catalog in the same shape pins how the engine resolves it.
import { describe, it, expect } from "vitest";
import * as engine from "../../src/engine/engine";
import { picker, testBuild, testDb, testSchema } from "./engine-fixtures";
import type { Bonus, Item } from "../../src/types";

const RACE = "race.race";
const PICK_1 = "race.pick1";
const PICK_2 = "race.pick2";
const LABEL = "Race Ability Scores";

const problem = (message: string) => ({
  severity: "error" as const,
  message,
  label: LABEL,
  hideFromPicker: true,
});

/** Flags its pick unless the chosen race carries `race-ability:<key>`. */
const allowedCheck = (key: string): Bonus => ({
  id: `score-${key}`,
  grants: [
    {
      when: {
        equipped: { tag: "race" },
        not: { equipped: { tag: `race-ability:${key}` } },
      },
      problem: problem("Invalid for chosen race"),
    },
  ],
});

/** Shared by every pick, so a second pick on a one-pick race reports once. */
const countCheck: Bonus = {
  id: "score-count",
  grants: [
    {
      when: {
        equipped: { tag: "race-ability-score", atLeast: 2 },
        all: [{ equipped: { tag: "race" } }],
        not: { equipped: { tag: "race-ability:two-picks" } },
      },
      problem: problem("Too many ability scores for chosen race"),
    },
  ],
};

const score = (id: string, key: string): Item => ({
  id,
  name: id,
  filter: "race_score",
  tags: ["race-ability-score"],
  bonuses: [`score-${key}`, "score-count"],
});

const race = (id: string, allows: string[]): Item => ({
  id,
  name: id,
  filter: "race",
  tags: ["race", ...allows.map((key) => `race-ability:${key}`)],
});

const raceDb = testDb(
  testSchema([]),
  [
    race("race-one-pick", ["2-cha", "2-dex"]),
    race("race-two-picks", ["2-str", "2-wis", "2-cha", "two-picks"]),
    race("race-plus-three", ["3"]),
    race("race-str-wis", ["2-str", "2-wis"]),
    score("plus2-str", "2-str"),
    score("plus2-wis", "2-wis"),
    score("plus2-cha", "2-cha"),
    score("plus2-dex", "2-dex"),
    score("plus3-cha", "3"),
    score("plus3-dex", "3"),
  ],
  [...["2-str", "2-wis", "2-cha", "2-dex", "3"].map(allowedCheck), countCheck],
  [
    picker(RACE, "race"),
    picker(PICK_1, "race_score"),
    picker(PICK_2, "race_score"),
  ],
);

/** Slot ids of every race ability score error the build raises. */
function flaggedSlots(choices: Record<string, string>): string[] {
  return engine
    .resolveBuild(raceDb, testBuild({ choices }))
    .errors.filter((e) => e.label === LABEL)
    .map((e) => e.slotId)
    .sort();
}

describe("race ability scores", () => {
  it("accepts a choice the race allows", () => {
    expect(
      flaggedSlots({ [RACE]: "race-one-pick", [PICK_1]: "plus2-cha" }),
    ).toEqual([]);
  });

  it("flags a choice the race does not allow", () => {
    expect(
      flaggedSlots({ [RACE]: "race-one-pick", [PICK_1]: "plus2-str" }),
    ).toEqual([PICK_1]);
  });

  it("flags only the disallowed pick of a two-pick race", () => {
    expect(
      flaggedSlots({
        [RACE]: "race-two-picks",
        [PICK_1]: "plus2-str",
        [PICK_2]: "plus3-cha",
      }),
    ).toEqual([PICK_2]);
  });

  it("allows two picks only for a two-pick race", () => {
    const picks = { [PICK_1]: "plus2-str", [PICK_2]: "plus2-wis" };
    expect(flaggedSlots({ [RACE]: "race-two-picks", ...picks })).toEqual([]);
    // The count check is shared by both picks, so it reports once, on one of them.
    expect(flaggedSlots({ [RACE]: "race-str-wis", ...picks })).toHaveLength(1);
  });

  it("keeps the +3 choices to races that allow them", () => {
    expect(
      flaggedSlots({ [RACE]: "race-plus-three", [PICK_1]: "plus3-dex" }),
    ).toEqual([]);
    expect(
      flaggedSlots({ [RACE]: "race-plus-three", [PICK_1]: "plus2-dex" }),
    ).toEqual([PICK_1]);
  });

  it("raises nothing before a race is picked", () => {
    expect(
      flaggedSlots({ [PICK_1]: "plus2-str", [PICK_2]: "plus3-cha" }),
    ).toEqual([]);
  });
});
