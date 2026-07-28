"""Translate captured sheet fixtures into the new build format, as `tests/fixture.json`.

`tools/make_fixture.py` captures the sheet verbatim -- choices keyed by row number, options as
pseudo-items like `Role: DPS`. The new engine speaks slot ids and a context object, so this
does the translation once (via `nwtools.translate`, shared with the differ) and the Vitest
suite (tests/fixture.spec.ts) just imports the result.

Plain JSON (not a `window.NW_FIXTURES = [...]` JS global, as this used to emit): nobody hand-
edits a generated golden fixture, and Vitest/Vite import JSON natively, so the
`nwtools.jsemit` hand-editable-JS-literal format buys nothing here.

Usage:
    ./venv/Scripts/python.exe tools/gen_fixture_js.py
"""

import glob
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from nwtools import repo_path      # noqa: E402
from nwtools import translate      # noqa: E402


def main():
    row_to_slot = translate.load_row_to_slot()
    paths = sorted(glob.glob(repo_path('tests', 'fixtures', '*.json')))
    if not paths:
        raise SystemExit('no fixtures -- run tools/make_fixture.py first')

    out = []
    for path in paths:
        fixture = json.load(open(path, encoding='utf-8'))
        build, missing = translate.to_build(fixture['state'], row_to_slot)
        out.append({
            'name': fixture['name'],
            'note': fixture.get('note', ''),
            'build': build,
            'expected': fixture['expected'],
        })
        ctx = build['context']
        print(f'  {fixture["name"]:<16} {len(build["choices"]):>3} choices  '
              f'{ctx["class"]}/{ctx["role"]}/{ctx["combatType"]}/'
              f'{ctx["duration"]}s/{ctx["location"]}')
        if missing:
            print(f'    WARNING unresolved context fields: {missing}')

    target = repo_path('tests', 'fixture.json')
    os.makedirs(os.path.dirname(target), exist_ok=True)
    with open(target, 'w', encoding='utf-8', newline='\n') as fh:
        json.dump(out, fh, indent=2, sort_keys=True)
        fh.write('\n')
    print(f'\nwrote {target} ({len(out)} fixture(s))')


if __name__ == '__main__':
    main()
