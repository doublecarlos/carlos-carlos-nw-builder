// Shared test harness. No DOM, no fetch -- pure comparison of an engine result against a
// golden fixture. tests/fixture.spec.ts drives this from Vitest.

import * as engine from '../../src/engine';

// Stats the sheet carried but the new schema deliberately drops (plan Part 3).
export const IGNORED_STATS = new Set([
  'dmg_enchant',          // FIX #4: mapped to no db-items column, always 0
  'max_copies_computed',  // never a stat; the sheet summed it as a diagnostic
]);

// Stages the sheet exposes and the engine reproduces, by name.
export const STAGES = [
  'sums', 'afterWeaponMods', 'afterCombinedRating', 'afterRatingPct',
  'afterAbilityScores', 'totals', 'caps', 'capped', 'overcap',
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
const sheetOvercap = (stages: any, key: string) => (stages.overcap[key] ?? 0) - (stages.headroom[key] ?? 0);

export function compareFixture(db: any, fixture: any, tolerance: number) {
  const failures: any[] = [];
  const result = engine.resolveBuild(db, fixture.build);

  for (const stage of STAGES) {
    const want = fixture.expected.stages[stage];
    if (!want) continue;
    for (const [stat, expected] of Object.entries(want)) {
      if (IGNORED_STATS.has(stat)) continue;
      if (!(stat in result.stages[stage as keyof typeof result.stages])) {
        failures.push({ field: `stages.${stage}.${stat}`, expected, actual: '(absent)' });
        continue;
      }
      const actual = stage === 'overcap'
        ? sheetOvercap(result.stages, stat)
        : (result.stages as any)[stage][stat];
      if (!close(actual, expected as number, tolerance)) {
        failures.push({ field: `stages.${stage}.${stat}`, expected, actual });
      }
    }
  }

  const walk = (prefix: string, want: any, got: any) => {
    if (want !== null && typeof want === 'object') {
      for (const [key, sub] of Object.entries(want)) walk(`${prefix}.${key}`, sub, got?.[key]);
    } else if (!close(Number(got), Number(want), tolerance)) {
      failures.push({ field: prefix, expected: want, actual: got });
    }
  };
  walk('derived', fixture.expected.derived, result.derived);

  return { name: fixture.name, note: fixture.note, failures, result };
}

/** Compact plain-text report, handy for debugging a failing case by hand. */
export function format(report: { db: any; cases: any[]; ok: boolean; tolerance: number; totalFailures: number }, limit = 30) {
  const lines = [
    `db: ${report.db.items} items, ${report.db.bonusSets} bonus sets, `
    + `${report.db.slots} slots`
    + (report.db.duplicates.length ? `, DUPLICATES: ${report.db.duplicates}` : ''),
    '',
  ];
  for (const c of report.cases) {
    lines.push(`${c.failures.length ? 'FAIL' : 'OK  '} ${c.name} `
      + `(${c.failures.length} mismatch${c.failures.length === 1 ? '' : 'es'})`);
    for (const f of c.failures.slice(0, limit)) {
      const delta = Number(f.actual) - Number(f.expected);
      lines.push(`       ${f.field}: sheet=${f.expected} engine=${f.actual}`
        + (Number.isFinite(delta) ? `  (Δ ${delta.toExponential(3)})` : ''));
    }
    if (c.failures.length > limit) {
      lines.push(`       … and ${c.failures.length - limit} more`);
    }
  }
  lines.push('');
  lines.push(report.ok
    ? `all ${report.cases.length} fixture(s) reproduced (tolerance ${report.tolerance})`
    : `${report.totalFailures} mismatch(es)`);
  return lines.join('\n');
}
