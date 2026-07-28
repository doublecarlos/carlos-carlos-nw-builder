// Golden-fixture comparison: every stage of the pipeline and every derived value, reproduced
// against the source spreadsheet at 1e-6 tolerance.

import { describe, it, expect } from 'vitest';
import fixtures from './fixture.json';
import * as db from '../src/db';
import { compareFixture, format } from './harness';

const TOLERANCE = 1e-6;

describe('golden fixtures', () => {
  const built = db.fromData();

  it(`db loads with no duplicate items (${built.items.length} items, ${built.bonusSets.length} bonus sets, ${built.slots.length} slots)`, () => {
    expect(built.duplicates).toEqual([]);
  });

  for (const fixture of fixtures as any[]) {
    it(`${fixture.name} reproduces the sheet`, () => {
      const result = compareFixture(built, fixture, TOLERANCE);
      if (result.failures.length > 0) {
        const report = {
          ok: false,
          tolerance: TOLERANCE,
          totalFailures: result.failures.length,
          db: {
            items: built.items.length,
            bonusSets: built.bonusSets.length,
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
