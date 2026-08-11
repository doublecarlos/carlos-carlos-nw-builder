// Shared test harness. No DOM, no fetch -- pure comparison of an engine result against a
// golden fixture. tests/fixture.spec.ts drives this from Vitest.

import * as engine from "../../src/engine/engine";
import type { Db } from "../../src/types";

// Stats the sheet carried but the new schema deliberately drops (plan Part 3).
export const IGNORED_STATS = new Set([
  "dmg_enchant", // FIX #4: mapped to no db-items column, always 0
  "max_copies_computed", // never a stat; the sheet summed it as a diagnostic
]);

// Stages the sheet exposes and the engine reproduces, by name.
export const STAGES = [
  "sums",
  "afterWeaponMods",
  "afterCombinedRating",
  "afterRatingPct",
  "afterAbilityScores",
  "totals",
  "caps",
  "capped",
  "overcap",
];

const close = (a: number, b: number, tolerance: number) => {
  if (a === b) return true;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(a - b) <= tolerance * Math.max(Math.abs(a), Math.abs(b), 1);
};

/**
 * The sheet stores one signed number where the new engine keeps two fields: `overcap` is
 * now non-negative and `headroom` is separate (FIX #2). Recombine before comparing, so the
 * fix is verified rather than papered over.
 */
const sheetOvercap = (
  stages: Record<string, Record<string, number>>,
  key: string,
) => (stages.overcap[key] ?? 0) - (stages.headroom[key] ?? 0);

// Derived values can be nested (damage, ehp, healing are objects).
// Walk the fixture tree vs the engine result tree, comparing numeric leaves.
type DerivedValue = number | { [key: string]: DerivedValue };

export function compareFixture(
  db: Db,
  fixture: {
    name: string;
    note?: string;
    build: import("../../src/types").Build;
    expected: {
      stages: Record<string, Record<string, number>>;
      derived: DerivedValue;
    };
  },
  tolerance: number,
) {
  const failures: {
    field: string;
    expected: string | number | string[];
    actual: string | number;
  }[] = [];
  const result = engine.resolveBuild(db, fixture.build);

  for (const stage of STAGES) {
    const want = fixture.expected.stages[stage];
    if (!want) continue;
    for (const [stat, expected] of Object.entries(want)) {
      if (IGNORED_STATS.has(stat)) continue;
      const stagesTyped = result.stages as unknown as Record<
        string,
        Record<string, unknown>
      >;
      if (!(stat in stagesTyped[stage])) {
        failures.push({
          field: `stages.${stage}.${stat}`,
          expected,
          actual: "(absent)",
        });
        continue;
      }
      const actual =
        stage === "overcap"
          ? sheetOvercap(
              result.stages as Record<string, Record<string, number>>,
              stat,
            )
          : ((stagesTyped[stage] as Record<string, number>)?.[stat] as number);
      if (!close(Number(actual), Number(expected), tolerance)) {
        failures.push({ field: `stages.${stage}.${stat}`, expected, actual });
      }
    }
  }

  // Recursively compare derived values (which may be nested objects).
  // The fixture carries a tree of numbers and objects; the engine produces
  // DerivedOutputs which is the same shape.
  const walk = (
    prefix: string,
    want: DerivedValue,
    got: DerivObj | undefined,
  ): void => {
    if (typeof want === "number") {
      // leaf: compare the numeric values directly.
      const gotNum = (typeof got === "number" ? got : undefined) as
        number | undefined;
      if (typeof gotNum !== "number" || !close(gotNum, want, tolerance)) {
        failures.push({
          field: prefix,
          expected: want,
          actual: gotNum ?? (0 as unknown as string | number),
        });
      }
    } else {
      // object → recurse into each key.
      const gotObj =
        typeof got === "object" && got !== null ? (got as DerivObj) : {};
      const wantObj = want as Record<string, DerivedValue>;
      for (const key of Object.keys(wantObj)) {
        walk(
          `${prefix}.${key}`,
          wantObj[key],
          gotObj[key] as DerivObj | undefined,
        );
      }
    }
  };
  walk(
    "derived",
    fixture.expected.derived,
    result.derived as unknown as DerivObj,
  );

  return { name: fixture.name, note: fixture.note, failures, result };
}

// Narrow type for DerivedOutputs so we can index it with string keys.
type DerivObj = { [key: string]: unknown };

// Shape of individual case report; fixture.spec.ts supplies an additional `result` field.
type CaseReport = {
  name: string;
  note?: string;
  failures: {
    field: string;
    expected: string | number | string[];
    actual: string | number;
  }[];
  result?: unknown;
};

/** Compact plain-text report, handy for debugging a failing case by hand. */
export function format(
  report: {
    db: {
      items: number;
      bonuses: number;
      slots: number;
      duplicates: string[];
    };
    cases: CaseReport[];
    ok: boolean;
    tolerance: number;
    totalFailures: number;
  },
  limit = 30,
) {
  const lines = [
    `db: ${report.db.items} items, ${report.db.bonuses} bonuses, ` +
      `${report.db.slots} slots` +
      (report.db.duplicates.length
        ? `, DUPLICATES: ${report.db.duplicates}`
        : ""),
    "",
  ];
  for (const c of report.cases) {
    lines.push(
      `${c.failures.length ? "FAIL" : "OK  "} ${c.name} ` +
        `(${c.failures.length} mismatch${c.failures.length === 1 ? "" : "es"})`,
    );
    for (const f of c.failures.slice(0, limit)) {
      const delta = Number(f.actual) - Number(f.expected);
      lines.push(
        `       ${f.field}: sheet=${f.expected} engine=${f.actual}` +
          (Number.isFinite(delta) ? `  (Δ ${delta.toExponential(3)})` : ""),
      );
    }
    if (c.failures.length > limit) {
      lines.push(`       … and ${c.failures.length - limit} more`);
    }
  }
  lines.push("");
  lines.push(
    report.ok
      ? `all ${report.cases.length} fixture(s) reproduced (tolerance ${report.tolerance})`
      : `${report.totalFailures} mismatch(es)`,
  );
  return lines.join("\n");
}
