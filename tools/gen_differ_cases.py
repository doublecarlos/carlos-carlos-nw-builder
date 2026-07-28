"""Generate randomised builds, run them through the legacy oracle, emit `tests/differ-cases.json`.

This is the heart of plan §5.2. One matching fixture proves the engine works in *one* state;
this proves the migration changed nothing unintended across thousands of them.

Each case carries the build in the new format plus the legacy oracle's `capped` stage and
derived values. `capped` is downstream of every pipeline stage, so a bug anywhere upstream
surfaces there -- which keeps the emitted file small.

Cases touching an item listed in `tools/corrections.py` are flagged `corrected: true`. Those
are *expected* to diverge -- that is the whole point of the corrections -- and the differ
reports them separately from genuine regressions.

Plain JSON (not a `window.NW_DIFFER_CASES = [...]` JS global, as this used to emit): nobody
hand-edits a generated 500-case file, and tests/run-differ.mjs imports it directly.

Usage:
    ./venv/Scripts/python.exe tools/gen_differ_cases.py [--count 500] [--seed 7]
"""

import argparse
import json
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from nwtools import repo_path      # noqa: E402
from nwtools import translate      # noqa: E402
import corrections                 # noqa: E402
import legacy_engine               # noqa: E402
from migrate_bonuses import slug, parse_suffix   # noqa: E402


def new_model_id(legacy_bonus_id):
    """Legacy bonus id -> the id `migrate_bonuses.py` gives the same bonus in the new model."""
    owner, label, tags = parse_suffix(legacy_bonus_id)
    return slug(owner + '-' + (label or 'bonus') + '-' + '-'.join(tags))

# Slot rows that hold build context rather than an item; the generator writes these itself.
CONTEXT_ROWS = set(translate.FORTE_ROWS) | set(translate.TOGGLE_ROWS) | {
    translate.ROW_CLASS, translate.ROW_ROLE, translate.ROW_DAMAGE_TYPE,
    translate.ROW_MAGNITUDE, translate.ROW_COMBAT_TYPE, translate.ROW_DURATION,
    translate.ROW_LOCATION, translate.ROW_M32_FORTE,
}

FORTE_STATS = [
    'power_p', 'acc_p', 'ca_p', 'strike_p', 'sev_p',
    'defense_p', 'awareness_p', 'crit_avoid_p', 'deflect_p', 'deflect_sev_p',
]
CLASSES = ['barbarian', 'bard', 'cleric', 'fighter', 'paladin', 'ranger', 'rogue',
           'warlock', 'wizard']


def load_slot_rows():
    """[(row, filter)] for every real item slot, from the generated slot list."""
    raw = json.load(open(repo_path('data', 'raw', 'slots.json'), encoding='utf-8'))
    return [(e['row'], e['filter']) for e in raw['slots']
            if e['kind'] == 'item' and e.get('filter') and e['row'] not in CONTEXT_ROWS]


def items_by_filter(db, exclude=()):
    """Selectable items per filter -- payload rows and invisible rows excluded.

    Items fixed in `tools/corrections.py` are excluded too. They are *supposed* to diverge
    from the oracle, so leaving them in would drown the regression signal (they appear in ~85%
    of random builds, since some filters hold only a handful of items). The corrections have
    their own targeted behavioural test instead.
    """
    buckets = {}
    for name, record in db.items.items():
        if '::' in name or ':_Bonus_' in name or name in exclude:
            continue
        buckets.setdefault(record.get('filter'), []).append(name)
    for names in buckets.values():
        names.sort()
    return buckets


def random_context(rng):
    return {
        'class': rng.choice(CLASSES),
        'role': rng.choice(['dps', 'healer', 'tank']),
        'combatType': rng.choice(['single', 'aoe', 'mixed']),
        # Restricted to the four legacy buckets: the oracle only understands those, so
        # off-bucket durations have nothing to diff against (plan Part 6 risk 5).
        'duration': rng.choice([0, 10, 30, 60]),
        'location': rng.choice(['generic', 'thay', 'wildspace']),
        'damageType': rng.choice(['magical', 'physical']),
        'magnitude': rng.choice([100, 1000, 4332, 9000]),
        'm32Forte': rng.random() < 0.5,
        'forte': {
            'primary': rng.choice(FORTE_STATS),
            'secondaryA': rng.choice(FORTE_STATS),
            'secondaryB': rng.choice(FORTE_STATS),
        },
        'toggles': {key: rng.random() < 0.65 for key in
                    ('combat', 'party', 'consumables', 'procs', 'artifactCall')},
    }


def random_state(rng, slot_rows, buckets, fill, max_copies):
    """A random but *legal* build.

    `max_copies` is honoured (0 = unlimited). Without it the generator happily slots the same
    artifact call three times, which the sheet itself flags as an error -- and which makes the
    legacy engine silently drop the bonus, because its payload rows only enumerate one piece.
    Comparing engines on builds the sheet considers invalid tells us nothing.
    """
    context = random_context(rng)
    choices = dict(translate.context_to_rows(context))
    used = {}
    for row, filt in slot_rows:
        names = buckets.get(filt)
        if not names or rng.random() > fill:
            continue
        legal = [n for n in names
                 if not max_copies.get(n) or used.get(n, 0) < max_copies[n]]
        if not legal:
            continue
        pick = rng.choice(legal)
        choices[row] = pick
        used[pick] = used.get(pick, 0) + 1
    return {
        'choices': choices,
        'offhandModValue': rng.choice([0, 600, 3589, 5800]),
        'magnitude': context['magnitude'],
        'm32Forte': context['m32Forte'],
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--count', type=int, default=500)
    ap.add_argument('--seed', type=int, default=7)
    ap.add_argument('--fill', type=float, default=0.75,
                    help='probability a given slot is filled')
    args = ap.parse_args()

    rng = random.Random(args.seed)
    db = legacy_engine.LegacyDb.load()
    slot_rows = load_slot_rows()
    corrected_items = {entry['item'] for entry in corrections.CORRECTIONS}
    buckets = items_by_filter(db, exclude=corrected_items)
    row_to_slot = translate.load_row_to_slot()
    max_copies = {
        name: int(legacy_engine.as_number(record.get('max_copies_computed', 0)))
        for name, record in db.items.items()
    }

    cases = []
    for index in range(args.count):
        state = random_state(rng, slot_rows, buckets, args.fill, max_copies)
        result = legacy_engine.evaluate(db, state)
        build, missing = translate.to_build(state, row_to_slot)
        if missing:
            raise SystemExit(f'case {index}: unresolved context {missing}')

        # Bonus ids the sheet computed but had no payload row for -- it silently contributes
        # nothing. The new model's `atLeast` thresholds have no such failure mode, so a
        # divergence explained by one of these is the intended fix, not a regression.
        dropped = sorted({new_model_id(entry['id'])
                          for entry in result['bonuses'] if not entry['found']})

        cases.append({
            'id': index,
            'build': build,
            'oracleDropped': dropped,
            'expected': {
                'capped': {k: v for k, v in result['stages']['capped'].items()
                           if k not in ('dmg_enchant', 'max_copies_computed')},
                'derived': result['derived'],
            },
        })

    target = repo_path('tests', 'differ-cases.json')
    os.makedirs(os.path.dirname(target), exist_ok=True)
    with open(target, 'w', encoding='utf-8', newline='\n') as fh:
        json.dump(cases, fh, indent=2, sort_keys=True)
        fh.write('\n')

    size = os.path.getsize(target) / 1024 / 1024
    print(f'wrote {target}')
    print(f'  {len(cases)} cases, {size:.1f} MB'
          f'  ({len(corrected_items)} corrected items excluded from the pool)')


if __name__ == '__main__':
    main()
