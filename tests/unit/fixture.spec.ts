// Golden-fixture comparison: every stage of the pipeline and every derived value, reproduced
// against the source spreadsheet at 1e-6 tolerance.

import { describe, it, expect } from "vitest";
import fixtures from "./fixture.json";
import * as db from "../../src/data/db";
import * as engine from "../../src/engine/engine";
import type { Build } from "../../src/types";
import { compareFixture, format } from "./harness";

// fixture.json is loaded as `any` by JSON import; we cast it to the shape
// `compareFixture` expects without claiming full `Build` compatibility.
type Fixture = {
  name: string;
  note?: string;
  build: Record<string, unknown>;
  expected: {
    stages: Record<string, Record<string, number>>;
    derived: Record<string, number>;
  };
};

const TOLERANCE = 1e-6;

describe("golden fixtures", () => {
  const built = db.fromData();

  it(`db loads with no duplicate items (${built.items.length} items, ${built.bonuses.length} bonuses, ${built.slots.length} slots)`, () => {
    expect(built.duplicates).toEqual([]);
  });

  for (const fixture of fixtures as unknown as Fixture[]) {
    it(`${fixture.name} reproduces the sheet`, () => {
      const result = compareFixture(
        built,
        fixture as unknown as Parameters<typeof compareFixture>[1],
        TOLERANCE,
      );
      if (result.failures.length > 0) {
        const report = {
          ok: false,
          tolerance: TOLERANCE,
          totalFailures: result.failures.length,
          db: {
            items: built.items.length,
            bonuses: built.bonuses.length,
            slots: built.slots.length,
            duplicates: built.duplicates,
          },
          cases: [result],
        };
        throw new Error(`\n${format(report)}`);
      }
      expect(result.failures).toEqual([]);
    });
  }
});

// EHP offers the same crit and deflect cases as damage, so a tank build can read its worst and
// best hit the way a damage build does.
describe("ehp variants", () => {
  const built = db.fromData();
  const build = (fixtures as unknown as Fixture[])[0].build as unknown as Build;
  const { derived } = engine.resolveBuild(built, build);
  const { ehp } = derived;

  it("has the same cases as damage", () => {
    expect(Object.keys(ehp).sort()).toEqual(Object.keys(derived.damage).sort());
  });

  it("is lowest on an undeflected crit and highest on a deflected non-crit", () => {
    expect(ehp.critNoDeflect).toBeLessThan(ehp.critDeflect);
    expect(ehp.critNoDeflect).toBeLessThan(ehp.noCritNoDeflect);
    expect(ehp.critDeflect).toBeLessThan(ehp.noCritDeflect);
    expect(ehp.noCritNoDeflect).toBeLessThan(ehp.noCritDeflect);
    expect(ehp.average).toBeGreaterThanOrEqual(ehp.critNoDeflect);
    expect(ehp.average).toBeLessThanOrEqual(ehp.noCritDeflect);
  });
});
