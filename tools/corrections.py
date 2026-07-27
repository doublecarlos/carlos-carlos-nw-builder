"""Deliberate corrections applied to the raw sheet data during migration.

Each entry is a data bug in the source spreadsheet that we have decided to fix rather than
carry forward. They live here -- not buried in the migrator, not silently baked into
`data/raw/db-items.json` -- so that:

  * the raw dump stays a faithful record of what the sheet actually says,
  * `tools/legacy_engine.py` keeps reproducing the sheet's *current* behaviour, so the
    differential test surfaces each correction as an explainable divergence rather than
    hiding it,
  * re-running `tools/sync_sheet.py` never loses them,
  * and each one can be deleted the moment it is fixed upstream in the sheet.

Every entry carries a `reason` and is echoed into `docs/migration-report.md`.

Supported operations per entry:
    partOf   -- extra bonus ids to append to `bonus_part_of`
    clear    -- stat columns to zero out on the item row
"""

CORRECTIONS = [
    {
        'item': 'M33 Wintermarked Frostlute',
        'partOf': [
            'M33 Chilling Flow (Mythic):_Bonus_-combat-combat_medium_plus-healer-',
            'M33 Chilling Flow (Mythic):_Bonus_-combat-combat_medium_plus-tank-',
        ],
        'reason': (
            'Chilling Flow defines base / dps / healer / tank payloads, but the weapon listed '
            'only base and dps, so healers and tanks silently got nothing. M28 Voidtouched '
            'wires all three roles; this was an omission. Confirmed by the author 2026-07-26.'
        ),
    },
    {
        'item': 'M33 Wintermarked Skaldblade',
        'partOf': [
            'M33 Chilling Flow (Mythic):_Bonus_-combat-combat_medium_plus-healer-',
            'M33 Chilling Flow (Mythic):_Bonus_-combat-combat_medium_plus-tank-',
        ],
        'reason': 'Same omission as M33 Wintermarked Frostlute.',
    },
    {
        'item': 'Sambocade (Movement)',
        'partOf': ['Sambocade (Movement):_Bonus_-consumables-'],
        'reason': (
            'The payload row `Sambocade (Movement):_Bonus_-consumables-::1:1` '
            '(hit_points +20000, movement +5%) existed but the food never declared membership, '
            'so eating it did nothing. Confirmed by the author 2026-07-26.'
        ),
    },
    {
        'item': "Executioner's Covenant",
        'clear': ['defense', 'awareness', 'crit_avoid', 'deflect'],
        'reason': (
            'The -1500 defensive penalty was on the item row *and* repeated on the 1-piece '
            'bonus payload, so a single copy applied -3000. The sibling insignia bonuses '
            "(Gladiator's Guile, Mender's Covenant) carry no stats on the item row at all -- "
            'all of the effect lives in the tiers. Confirmed as a bug by the author 2026-07-26.'
        ),
    },
]


def apply(records, report=None):
    """Apply corrections in place to `{name: raw_record}`. Returns a log of what changed."""
    log = []
    for entry in CORRECTIONS:
        name = entry['item']
        record = records.get(name)
        if record is None:
            log.append({'item': name, 'status': 'MISSING',
                        'detail': 'item not found in the raw dump -- correction skipped',
                        'reason': entry['reason']})
            continue

        changes = []

        for bonus_id in entry.get('partOf', []):
            existing = str(record.get('bonus_part_of', '') or '')
            if f'|{bonus_id}|' in existing:
                changes.append(f'already a member of {bonus_id}')
                continue
            record['bonus_part_of'] = existing + f'|{bonus_id}|'
            changes.append(f'+ member of {bonus_id}')

        for stat in entry.get('clear', []):
            if record.get(stat):
                changes.append(f'{stat}: {record[stat]} -> 0')
                record.pop(stat, None)
            else:
                changes.append(f'{stat} already absent')

        log.append({'item': name, 'status': 'applied', 'changes': changes,
                    'reason': entry['reason']})

    if report is not None:
        report['corrections'] = log
    return log
