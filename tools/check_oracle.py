"""Verify the legacy oracle reproduces every number captured in the fixtures.

This must be green before the migration is trusted: it is what makes `legacy_engine.py` a
credible reference for the differential test in plan §5.2. Throwaway alongside the oracle.

Usage:
    ./venv/Scripts/python.exe tools/check_oracle.py [--tolerance 1e-6] [--verbose]
"""

import argparse
import glob
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from nwtools import repo_path      # noqa: E402
import legacy_engine               # noqa: E402

# Stats the sheet displays but never computes into a stage row, or that exist only as legacy
# dead weight. Compared anyway unless listed here.
IGNORED_STATS = {
    'dmg_enchant',          # plan §3 fix #4: maps to no db-items column, always 0
    'max_copies_computed',  # not a stat; the sheet sums it as a diagnostic
}


def close(a, b, tolerance):
    if a == b:
        return True
    scale = max(abs(a), abs(b), 1.0)
    return abs(a - b) <= tolerance * scale


def compare(fixture, result, tolerance):
    failures = []
    expected = fixture['expected']

    for stage, values in expected['stages'].items():
        got_stage = result['stages'].get(stage)
        if got_stage is None:
            failures.append((f'stages.{stage}', 'missing', None, None))
            continue
        for stat, want in values.items():
            if stat in IGNORED_STATS:
                continue
            got = got_stage.get(stat, 0.0)
            if not close(got, want, tolerance):
                failures.append((f'stages.{stage}.{stat}', 'value', want, got))

    def walk(prefix, want, got):
        if isinstance(want, dict):
            for key, sub in want.items():
                walk(f'{prefix}.{key}', sub, (got or {}).get(key))
        else:
            if not close(float(got or 0.0), float(want), tolerance):
                failures.append((prefix, 'value', want, got))

    walk('derived', expected['derived'], result['derived'])
    return failures


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--tolerance', type=float, default=1e-6)
    ap.add_argument('--verbose', action='store_true')
    ap.add_argument('--fixtures', default=repo_path('tests', 'fixtures', '*.json'))
    args = ap.parse_args()

    paths = sorted(glob.glob(args.fixtures))
    if not paths:
        raise SystemExit(f'no fixtures matched {args.fixtures} -- run tools/make_fixture.py')

    db = legacy_engine.LegacyDb.load()
    total_failures = 0

    for path in paths:
        fixture = json.load(open(path, encoding='utf-8'))
        result = legacy_engine.evaluate(db, fixture['state'])
        failures = compare(fixture, result, args.tolerance)
        total_failures += len(failures)

        name = fixture.get('name', os.path.basename(path))
        status = 'OK  ' if not failures else 'FAIL'
        print(f'{status} {name:<16} {len(failures)} mismatch(es)')
        if fixture.get('note'):
            print(f'       {fixture["note"]}')

        for field, kind, want, got in failures[:40]:
            if kind == 'missing':
                print(f'       {field}: missing from oracle output')
            else:
                delta = (got - want) if isinstance(got, (int, float)) else None
                extra = f'  (delta {delta:+.6g})' if delta is not None else ''
                print(f'       {field}: sheet={want!r} oracle={got!r}{extra}')
        if len(failures) > 40:
            print(f'       ... and {len(failures) - 40} more')

        if args.verbose:
            missing = [b for b in result['bonuses'] if not b['found']]
            print(f'       bonuses: {len(result["bonuses"]) - len(missing)}'
                  f'/{len(result["bonuses"])} matched a payload row')
            for entry in missing:
                print(f'         no payload: {entry["key"]}')

    print()
    if total_failures:
        print(f'{total_failures} mismatch(es) across {len(paths)} fixture(s)')
        return 1
    print(f'all {len(paths)} fixture(s) reproduced exactly (tolerance {args.tolerance:g})')
    return 0


if __name__ == '__main__':
    sys.exit(main())
