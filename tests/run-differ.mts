// Differential regression scan: `tests/differ-cases.json` (500 randomised builds, each run
// through tools/legacy_engine.py's oracle by tools/gen_differ_cases.py) replayed through the
// current src/engine.ts and diffed field-by-field. Every divergence is a migration bug unless
// it is an intended Part-3 fix (see `oracleDropped` below).
//
// A regression *scan* with a human-readable report, not a pass/fail unit assertion -- run via
// `npm run test:differ`, deliberately separate from `npm test` (Vitest). NOTE: as of 2026-07-28
// this reports 206 pre-existing unexplained regressions on `main` itself, confirmed unrelated
// to the npm/Vite migration (see memory `differ-baseline-206-regressions` / this repo's
// llm/plans/) -- treat "still ~206" as the current baseline, not zero, until that separate,
// pre-existing issue is investigated.

import * as db from '../src/db';
import * as engine from '../src/engine';
import cases from './differ-cases.json';

const TOLERANCE = 1e-6;

const close = (a: number, b: number) => {
  if (a === b) return true;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(a - b) <= TOLERANCE * Math.max(Math.abs(a), Math.abs(b), 1);
};

const flatten = (obj: any, prefix: string, out: Record<string, any>): Record<string, any> => {
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object') flatten(value, path, out);
    else out[path] = value;
  }
  return out;
};

function main() {
  const started = performance.now();
  const built = db.fromData();

  const byField = new Map<string, { cases: number; maxAbsDelta: number; example: any }>();
  const explainedBy = new Map<string, number>();
  let comparisons = 0;
  let explainedCases = 0;
  const regressions: { id: number; fields: string[] }[] = [];

  for (const testCase of cases as any[]) {
    // `explain: false` skips the per-leaf breakdown -- thousands of builds don't need it.
    const result = engine.resolveBuild(built, testCase.build, { explain: false });
    const actual = { capped: result.stages.capped, derived: flatten(result.derived, '', {}) };
    const expected = { capped: testCase.expected.capped,
                       derived: flatten(testCase.expected.derived, '', {}) };

    const fields: string[] = [];
    for (const group of ['capped', 'derived'] as const) {
      for (const [field, want] of Object.entries((expected as any)[group])) {
        comparisons += 1;
        const got = (actual as any)[group][field];
        if (close(Number(got), Number(want))) continue;
        const path = `${group}.${field}`;
        const delta = Number(got) - Number(want);
        fields.push(path);
        const entry = byField.get(path) ?? { cases: 0, maxAbsDelta: 0, example: null };
        entry.cases += 1;
        if (Math.abs(delta) > entry.maxAbsDelta) {
          entry.maxAbsDelta = Math.abs(delta);
          entry.example = { id: testCase.id, oracle: want, engine: got };
        }
        byField.set(path, entry);
      }
    }
    if (!fields.length) continue;

    // Classify. A divergence is *explained* when the oracle failed to resolve a payload row
    // for a bonus that the new engine has active -- i.e. the sheet silently dropped it, which
    // is precisely the failure mode the redesign removes. Anything else is a regression.
    const dropped = new Set(testCase.oracleDropped ?? []);
    const culprits = result.bonuses
      .filter((b: any) => b.active && dropped.has(b.id))
      .map((b: any) => b.id);

    if (culprits.length) {
      explainedCases += 1;
      for (const id of culprits) explainedBy.set(id, (explainedBy.get(id) ?? 0) + 1);
    } else {
      regressions.push({ id: testCase.id, fields: fields.slice(0, 6) });
    }
  }

  const elapsed = performance.now() - started;
  const ok = regressions.length === 0;

  const lines: string[] = [
    `${(cases as any[]).length} randomised builds, ${comparisons.toLocaleString()} comparisons`,
    `${(elapsed / 1000).toFixed(2)}s (${(elapsed / Math.max((cases as any[]).length, 1)).toFixed(1)} ms/build)`,
    '',
    `regressions            ${regressions.length}`,
    `explained divergences  ${explainedCases}  (sheet silently dropped a bonus)`,
    '',
  ];

  if (explainedBy.size) {
    lines.push('Bonuses the sheet drops but the new engine resolves:');
    for (const [id, n] of [...explainedBy].sort((a, b) => b[1] - a[1])) {
      lines.push(`  ${id}  — ${n} build(s)`);
    }
    lines.push('');
  }

  if (regressions.length) {
    lines.push('REGRESSIONS (unexplained -- see header note re: known pre-existing baseline):');
    for (const r of regressions.slice(0, 20)) {
      lines.push(`  case ${r.id}: ${r.fields.join(', ')}`);
    }
    lines.push('');
    const sorted = [...byField.entries()].sort((a, b) => b[1].cases - a[1].cases);
    for (const [field, info] of sorted.slice(0, 20)) {
      lines.push(`  ${field}: ${info.cases} case(s), max |Δ| `
        + `${info.maxAbsDelta.toExponential(3)}`);
      lines.push(`      e.g. case ${info.example.id}: `
        + `oracle=${info.example.oracle} engine=${info.example.engine}`);
    }
  } else {
    lines.push(`no unexplained divergences at tolerance ${TOLERANCE}`);
  }

  console.log(lines.join('\n'));
  console.log(ok
    ? `\n✓ ${(cases as any[]).length} builds, ${comparisons.toLocaleString()} comparisons, 0 regressions (${explainedCases} explained)`
    : `\n✗ ${regressions.length} unexplained divergence(s) -- compare against the known baseline before treating this as a new bug`);

  process.exit(ok ? 0 : 1);
}

main();
