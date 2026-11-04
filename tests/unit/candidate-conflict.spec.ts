// The picker resolves only candidates that `canConflict` before listing them, so a gap between
// it and the full preview's own conflict rule would list an item that should be withheld.
import { describe, it, expect } from "vitest";
import { canConflict, candidatePreview } from "../../src/lib/candidate-preview";
import type { Bonus, Build, Item } from "../../src/types";
import { picker, testBuild, testDb, testSchema } from "./engine-fixtures";

const ring = (id: string, bonuses: string[] = []): Item => ({
  id,
  name: id,
  filter: "ring",
  bonuses,
});

const bonuses: Bonus[] = [
  { id: "b-stat", grants: [{ stats: { power: 10 } }] },
  { id: "b-tier", grants: [{ tiers: [{ atLeast: 1, stats: { power: 5 } }] }] },
  {
    id: "b-clash",
    grants: [
      {
        when: { equipped: { item: "marker", atLeast: 1 } },
        problem: {
          severity: "error",
          message: "clashes with the marker",
          hideFromPicker: true,
        },
      },
    ],
  },
  {
    // Fires on every pick, but only flags the row: nothing is withheld.
    id: "b-warn",
    grants: [{ problem: { severity: "warning", message: "heads up" } }],
  },
  {
    // A set bonus: a tier ladder plus a problem once a second piece is on.
    id: "b-set",
    grants: [
      { tiers: [{ atLeast: 2, stats: { power: 20 } }] },
      {
        when: { bonusOccurrences: { atLeast: 2 } },
        problem: {
          severity: "error",
          message: "one piece only",
          hideFromPicker: true,
        },
      },
    ],
  },
];

const items = [
  ring("plain"),
  ring("marker"),
  ring("stat", ["b-stat"]),
  ring("tiered", ["b-tier"]),
  ring("clash", ["b-clash"]),
  ring("warn", ["b-warn"]),
  ring("set-a", ["b-set"]),
  ring("set-b", ["b-set"]),
];

const db = testDb(testSchema(["power"]), items, bonuses, [
  picker("ring.r1", "ring"),
  picker("ring.r2", "ring"),
  picker("ring.r3", "ring"),
]);

/** Each candidate's `canConflict`, and whether its full preview reports a conflict. */
const verdicts = (build: Build) =>
  Object.fromEntries(
    items.map((item) => [
      item.id,
      {
        can: canConflict(db, item),
        fires:
          candidatePreview({ db, build, slotId: "ring.r3" }, item)?.conflict !=
          null,
      },
    ]),
  );

describe("canConflict", () => {
  it("names exactly the candidates whose conflict fires once every problem's condition holds", () => {
    const build = testBuild({
      choices: { "ring.r1": "marker", "ring.r2": "set-a" },
    });
    const all = Object.entries(verdicts(build));
    const can = all.filter(([, verdict]) => verdict.can).map(([id]) => id);
    const fires = all.filter(([, verdict]) => verdict.fires).map(([id]) => id);
    expect(can).toEqual(fires);
    expect(fires).toEqual(["clash", "set-a", "set-b"]);
  });

  it("never misses a conflict in a build where none fires", () => {
    const missed = Object.entries(verdicts(testBuild()))
      .filter(([, verdict]) => verdict.fires && !verdict.can)
      .map(([id]) => id);
    expect(missed).toEqual([]);
  });

  it("follows a bonus the catalog adds later", () => {
    const layered = testDb(
      testSchema(["power"]),
      items,
      bonuses.map((bonus) =>
        bonus.id === "b-stat"
          ? {
              ...bonus,
              grants: [
                ...bonus.grants!,
                {
                  problem: {
                    severity: "error",
                    message: "never",
                    hideFromPicker: true,
                  },
                },
              ],
            }
          : bonus,
      ),
      [picker("ring.r1", "ring")],
    );
    const stat = items.find((i) => i.id === "stat")!;
    expect(canConflict(db, stat)).toBe(false);
    expect(canConflict(layered, stat)).toBe(true);
  });
});
