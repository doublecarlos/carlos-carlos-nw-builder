"""Translate captured sheet fixtures into the new build format, as `tests/fixture.js`.

`tools/make_fixture.py` captures the sheet verbatim -- choices keyed by row number, options as
pseudo-items like `Role: DPS`. The new engine speaks slot ids and a context object, so this
does the translation once, in one place, and the browser test suite just loads the result.

Emits a plain JS global (not JSON) so `tests.html` needs no fetch and still works from file://.

Usage:
    ./venv/Scripts/python.exe tools/gen_fixture_js.py
"""

import glob
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from nwtools import repo_path      # noqa: E402
from nwtools import jsemit         # noqa: E402

# Legacy duration buckets -> seconds on the numeric axis (plan §2.1).
# Verified equivalent: at 60 the legacy option qualified `-combat_long-`, `-combat_*_plus-`
# and nothing else; `{atLeast: 60}` / `{atLeast: 30}` / `{atLeast: 10}` / `{}` reproduce that
# exactly, and the same holds for 0, 10 and 30.
DURATIONS = {
    'Duration: > 0s': 0, 'Duration: > 10s': 10,
    'Duration: > 30s': 30, 'Duration: > 60s': 60,
}
COMBAT_TYPES = {
    'Type: Single Target': 'single', 'Type: AoE': 'aoe', 'Type: Mixed Boss': 'mixed',
}
TOGGLE_ROWS = {
    25: 'consumables', 26: 'party', 27: 'combat', 28: 'procs', 29: 'artifactCall',
}
FORTE_ROWS = {15: 'primary', 16: 'secondaryA', 17: 'secondaryB'}


def strip_prefix(value, prefix):
    text = str(value or '')
    return text[len(prefix):].strip() if text.startswith(prefix) else text.strip()


def build_context(choices):
    """Turn the sheet's option pseudo-items into a build context object."""
    context = {
        'class': strip_prefix(choices.get(14), 'Class: ').lower() or None,
        'role': strip_prefix(choices.get(18), 'Role: ').lower() or None,
        'combatType': COMBAT_TYPES.get(str(choices.get(22, '')).strip()),
        'duration': DURATIONS.get(str(choices.get(23, '')).strip()),
        'location': strip_prefix(choices.get(24), 'Location: ').lower() or None,
        'damageType': str(choices.get(19, 'Magical')).strip().lower(),
        'magnitude': choices.get(20, 0),
        'm32Forte': bool(choices.get(30, False)),
        'forte': {},
        'toggles': {},
    }

    for row, key in FORTE_ROWS.items():
        stat = strip_prefix(choices.get(row), 'Forte: ')
        if stat:
            context['forte'][key] = stat

    for row, key in TOGGLE_ROWS.items():
        raw = str(choices.get(row, '')).strip()
        # The sheet writes "<label>: Enabled" / "<label>: Disabled".
        context['toggles'][key] = raw.endswith(': Enabled')

    missing = [k for k in ('class', 'role', 'combatType', 'duration', 'location')
               if context.get(k) is None]
    return context, missing


def translate(fixture, row_to_slot):
    choices_by_row = {int(k): v for k, v in fixture['state']['choices'].items()}
    context, missing = build_context(choices_by_row)

    choices, unmapped = {}, []
    for row, value in sorted(choices_by_row.items()):
        slot_id = row_to_slot.get(row)
        if slot_id is None:
            continue          # context rows and section headers have no slot
        if value in ('', '-', True, None):
            continue
        choices[slot_id] = value

    values = {}
    mod_slot = row_to_slot.get(40)
    if mod_slot and fixture['state'].get('offhandModValue'):
        values[mod_slot] = fixture['state']['offhandModValue']

    return {
        'name': fixture['name'],
        'note': fixture.get('note', ''),
        'build': {'choices': choices, 'values': values, 'context': context},
        'expected': fixture['expected'],
    }, missing, unmapped


def main():
    slots_raw = json.load(open(repo_path('data', 'raw', 'slots.json'), encoding='utf-8'))
    row_to_slot = {}
    gen_slots_path = repo_path('data', 'slots.js')
    slots_js = open(gen_slots_path, encoding='utf-8').read()
    for match in re.finditer(r'\{id:"([^"]+)".*?row:(\d+)\}', slots_js):
        row_to_slot[int(match.group(2))] = match.group(1)

    paths = sorted(glob.glob(repo_path('tests', 'fixtures', '*.json')))
    if not paths:
        raise SystemExit('no fixtures -- run tools/make_fixture.py first')

    out = []
    for path in paths:
        fixture = json.load(open(path, encoding='utf-8'))
        translated, missing, unmapped = translate(fixture, row_to_slot)
        out.append(translated)
        label = translated['name']
        print(f'  {label:<16} {len(translated["build"]["choices"]):>3} choices'
              f'  context: {translated["build"]["context"]["class"]}/'
              f'{translated["build"]["context"]["role"]}/'
              f'{translated["build"]["context"]["combatType"]}/'
              f'{translated["build"]["context"]["duration"]}s/'
              f'{translated["build"]["context"]["location"]}')
        if missing:
            print(f'    WARNING unresolved context fields: {missing}')

    target = repo_path('tests', 'fixture.js')
    lines = [
        '// GENERATED by tools/gen_fixture_js.py from tests/fixtures/*.json.',
        '// Golden values captured from the source spreadsheet, translated into the new build',
        '// format. Emitted as a JS global rather than JSON so the test page needs no fetch',
        '// and still runs from file://.',
        '',
        'window.NW_FIXTURES = [',
    ]
    lines.append(',\n'.join('  ' + jsemit.value(entry, 2, width=110) for entry in out))
    lines += ['];', '']

    os.makedirs(os.path.dirname(target), exist_ok=True)
    with open(target, 'w', encoding='utf-8', newline='\n') as fh:
        fh.write('\n'.join(lines))
    print(f'\nwrote {target} ({len(out)} fixture(s))')


if __name__ == '__main__':
    main()
