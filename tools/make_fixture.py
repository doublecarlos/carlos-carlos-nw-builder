"""Capture a `test-dev` state -- inputs *and* computed outputs -- as a golden fixture.

Fixtures are the evidence that the port is faithful. Capture several by toggling options in
the sheet (Party off, Role: Healer, Location: Thay, Duration: 10s, ...) so the bonus tiering is
exercised rather than one frozen state (plan §5.2).

Usage:
    ./venv/Scripts/python.exe tools/make_fixture.py --name default
    ./venv/Scripts/python.exe tools/make_fixture.py --name healer --sheet test-heal
"""

import argparse
import datetime
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from nwtools import repo_path      # noqa: E402
from nwtools import sheets         # noqa: E402

FIRST_SLOT_ROW, LAST_SLOT_ROW = 13, 234
STAT_HEADER_ROW = 11
STAT_FIRST_COL, STAT_LAST_COL = 'Z', 'CR'

# Pipeline row -> the stage name used by both engines.
STAGE_ROWS = {
    236: 'sums',
    238: 'afterWeaponMods',
    240: 'afterCombinedRating',
    244: 'afterRatingPct',
    246: 'afterAbilityScores',
    250: 'totals',
    251: 'caps',
    252: 'capped',
    253: 'overcap',
}

# Rows 70-79 of the calculations block.
DERIVED_ROWS = [
    (70, ('damage', 'average')),
    (71, ('damage', 'critNoDeflect')),
    (72, ('damage', 'critDeflect')),
    (73, ('damage', 'noCritNoDeflect')),
    (74, ('damage', 'noCritDeflect')),
    (75, ('healing', 'average')),
    (76, ('healing', 'crit')),
    (77, ('healing', 'noCrit')),
    (78, ('ehp', 'critNoDeflect')),
    (79, ('ehp', 'average')),
]


def number(value):
    if isinstance(value, bool) or value is None or value == '':
        return 0.0
    if isinstance(value, (int, float)):
        return float(value)
    return 0.0


def capture(svc, sheet):
    ranges = [
        f'{sheet}!I{FIRST_SLOT_ROW}:N{LAST_SLOT_ROW}',
        f'{sheet}!{STAT_FIRST_COL}{STAT_HEADER_ROW}:{STAT_LAST_COL}{STAT_HEADER_ROW}',
        f'{sheet}!{STAT_FIRST_COL}236:{STAT_LAST_COL}253',
        f'{sheet}!C15:C17',
        f'{sheet}!C70:C79',
        f'{sheet}!I2:J9',
    ]
    data = sheets.read(svc, ranges)
    slot_block, header_block, stage_block, top_block, calc_block, control_block = (
        data[r] for r in ranges
    )

    headers = [str(h).strip() for h in (header_block[0] if header_block else [])]

    # --- inputs -------------------------------------------------------------------------
    choices, mod_value = {}, 0.0
    for offset, row_values in enumerate(slot_block):
        row = FIRST_SLOT_ROW + offset
        choice = row_values[2] if len(row_values) > 2 else ''      # column K
        if choice != '':
            choices[row] = choice
        if row == 40 and len(row_values) > 5:                      # column N
            mod_value = number(row_values[5])

    state = {
        'choices': choices,
        'offhandModValue': mod_value,
        'magnitude': number(choices.get(20, 0)),
        'm32Forte': bool(choices.get(30, False)),
        'damageType': choices.get(19, 'Magical'),
    }

    controls = {}
    for offset, row_values in enumerate(control_block):
        row = 2 + offset
        label = str(row_values[0]).strip() if row_values else ''
        if not label:
            continue
        controls[row] = {
            'label': label,
            'value': row_values[1] if len(row_values) > 1 and row_values[1] != '' else label,
        }
    state['controls'] = controls

    # --- expected outputs ----------------------------------------------------------------
    stages = {}
    for row, name in STAGE_ROWS.items():
        row_values = stage_block[row - 236] if row - 236 < len(stage_block) else []
        stage = {}
        for idx, header in enumerate(headers):
            if not header or not re.match(r'^[a-z][a-z0-9_]*$', header):
                continue
            stage[header] = number(row_values[idx] if idx < len(row_values) else 0)
        stages[name] = stage

    def top(row):
        cell = top_block[row - 15] if row - 15 < len(top_block) else []
        return number(cell[0] if cell else 0)

    derived = {
        'itemLevel': top(15),
        'hp': top(16),
        'baseDamage': top(17),
        'damage': {}, 'healing': {}, 'ehp': {},
    }
    for row, (group, key) in DERIVED_ROWS:
        cell = calc_block[row - 70] if row - 70 < len(calc_block) else []
        derived[group][key] = number(cell[0] if cell else 0)

    return state, {'stages': stages, 'derived': derived}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--name', required=True, help='fixture name, e.g. "default"')
    ap.add_argument('--sheet', default='test-dev')
    ap.add_argument('--note', default='', help='what makes this state interesting')
    ap.add_argument('--creds', default=None)
    args = ap.parse_args()

    svc = sheets.connect(args.creds)
    state, expected = capture(svc, args.sheet)

    payload = {
        'name': args.name,
        'sheet': args.sheet,
        'note': args.note,
        'capturedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds'),
        'state': state,
        'expected': expected,
    }

    out_dir = repo_path('tests', 'fixtures')
    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, f'{args.name}.json')
    with open(out, 'w', encoding='utf-8', newline='\n') as fh:
        json.dump(payload, fh, indent=1, ensure_ascii=False)
        fh.write('\n')

    print(f'wrote {out}')
    print(f"  {len(state['choices'])} choices, offhand mod {state['offhandModValue']}")
    print(f"  item level {expected['derived']['itemLevel']:,.0f}"
          f"  hp {expected['derived']['hp']:,.0f}"
          f"  damage {expected['derived']['damage']['average']:,.0f}")


if __name__ == '__main__':
    main()
