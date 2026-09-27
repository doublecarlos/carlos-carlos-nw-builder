// The engine's stat-source ledger (`ResolvedBuild.ledger`) has to account for every number
// the pipeline produced: replaying its entries per stage gives back that stage's vector.
// Checked on the golden fixture's full build against the shipped catalog.
import { describe, it, expect } from "vitest";
import fixtures from "./fixture.json";
import * as db from "../../src/data/db";
import * as engine from "../../src/engine/engine";
import type { Build, LedgerEntry, LedgerStage } from "../../src/types";

const shipped = db.fromData();
const build = (fixtures as unknown as { build: Build }[])[0].build;
const result = engine.resolveBuild(shipped, build);
const { ledger } = result;
const { schema } = shipped;
const multiplicative = new Set(schema.multiplicativeStats);

const STAGES: LedgerStage[] = [
  "sums",
  "afterCombinedRating",
  "afterRatingPct",
  "totals",
];

/** Every entry for `stat` up to and including `stage`. */
const entriesUpTo = (stat: string, stage: LedgerStage) => {
  const last = STAGES.indexOf(stage);
  return ledger.filter(
    (entry) => entry.stat === stat && STAGES.indexOf(entry.stage) <= last,
  );
};

const close = (a: number, b: number) =>
  Math.abs(a - b) <= 1e-9 * Math.max(Math.abs(a), Math.abs(b), 1);

/** Row entries add within a row, rows multiply; a later entry multiplies in on its own. */
function replayMultiplicative(entries: LedgerEntry[]) {
  const byRow = new Map<string, number>();
  let product = 1;
  for (const entry of entries) {
    if (entry.stage === "sums")
      byRow.set(entry.slotId!, (byRow.get(entry.slotId!) ?? 0) + entry.value);
    else product *= 1 + entry.value;
  }
  for (const rowSum of byRow.values()) product *= 1 + rowSum;
  return product - 1;
}

describe("engine stat-source ledger", () => {
  it("covers a real build", () => {
    const kinds = new Set(ledger.map((entry) => entry.kind));
    for (const kind of [
      "item",
      "assignment",
      "bonus",
      "combinedRating",
      "ratingConversion",
      "contribution",
    ])
      expect(kinds).toContain(kind);
  });

  it.each(STAGES)(
    "sums each additive stat's entries up to %s to that stage",
    (stage) => {
      const mismatched = schema.statKeys.filter((stat) => {
        if (multiplicative.has(stat)) return false;
        const sum = entriesUpTo(stat, stage).reduce(
          (total, entry) => total + entry.value,
          0,
        );
        return !close(sum, result.stages[stage][stat]);
      });
      expect(mismatched).toEqual([]);
    },
  );

  it("replays each multiplicative stat to its total", () => {
    expect(multiplicative.size).toBeGreaterThan(0);
    const mismatched = [...multiplicative].filter((stat) => {
      const entries = entriesUpTo(stat, "totals");
      return (
        entries.some((entry) => entry.combine !== "multiplicative") ||
        !close(replayMultiplicative(entries), result.stages.totals[stat])
      );
    });
    expect(mismatched).toEqual([]);
  });

  it("tags row entries with their slot and source", () => {
    const untagged = ledger.filter(
      (entry) =>
        entry.stage === "sums" &&
        !(
          entry.slotId &&
          (entry.kind === "bonus" ? entry.bonusId : entry.itemId)
        ),
    );
    expect(untagged).toEqual([]);
  });
});
