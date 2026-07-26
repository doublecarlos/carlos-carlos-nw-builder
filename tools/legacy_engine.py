"""THROWAWAY reference implementation of the *legacy* spreadsheet semantics.

This is a test oracle, not shipped code. Its only job is to answer one question:

    did the migration to the new bonus model change any build's numbers,
    and if so, exactly which ones and by how much?

It therefore implements the sheet literally -- the `|pipe|` string matching, the exact
`<id>::<parts>:<quals>` payload lookup, the staged pipeline of rows 236-253 -- rather than the
cleaned-up model in plan Part 2. **Delete this file once migration is signed off** (plan §5.2).

Reads only `data/raw/db-items.json`, so it runs offline.

Usage:
    ./venv/Scripts/python.exe tools/legacy_engine.py --state data/raw/slots.json
    ./venv/Scripts/python.exe tools/legacy_engine.py --state <fixture.json> --json out.json
"""

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from nwtools import repo_path      # noqa: E402

# --- legacy layout constants ---------------------------------------------------------------

FIRST_SLOT_ROW = 13
LAST_SLOT_ROW = 234

ROW_CLASS, ROW_FORTE1, ROW_FORTE2A, ROW_FORTE2B, ROW_ROLE = 14, 15, 16, 17, 18
ROW_DAMAGE_TYPE, ROW_MAGNITUDE = 19, 20
ROW_M32_FORTE = 30
ROW_OFFHAND_MOD2 = 40

BLANK_CHOICES = ("", "-", True, None)

# `test-dev` row 11, columns Z..CR -- the stat vector the build sheet actually reads.
# `dmg_enchant` matches no db-items column and always resolves to 0 (plan §3 fix #4);
# `control_resist_p` / `control_resist` likewise have no source column (fix #3). Both are kept
# here because the oracle must reproduce the legacy behaviour, including the dead entries.
LEGACY_STATS = [
    'il', 'combined_rating',
    'power_p', 'acc_p', 'ca_p', 'strike_p', 'sev_p', 'forte_p',
    'power', 'acc', 'ca', 'strike', 'severity', 'forte',
    'flat_damage', 'outgoing_damage', 'dmg_enchant', 'mult_damage', 'overall_damage',
    'magical_damage_boost', 'physical_damage_boost', 'incoming_damage',
    'hit_points_p', 'hit_points',
    'defense_p', 'awareness_p', 'crit_avoid_p', 'deflect_p', 'deflect_sev_p',
    'inc_healing_p', 'out_healing_p',
    'defense', 'awareness', 'crit_avoid', 'deflect', 'deflect_sev',
    'inc_healing', 'out_healing', 'overall_healing',
    'ap_gain', 'recharge', 'movement', 'mana_regen', 'stamina_regen',
    'control_bonus_p', 'control_bonus', 'control_resist_p', 'control_resist',
    'str', 'con', 'dex', 'int', 'wis', 'cha',
    'enemy_accuracy', 'enemy_ca', 'enemy_strike', 'enemy_severity', 'enemy_incoming_damage',
    'enemy_defense', 'enemy_awareness', 'enemy_crit_avoid', 'enemy_deflect',
    'enemy_deflect_sev', 'enemy_incoming_damage_magical', 'enemy_incoming_damage_physical',
    'max_copies_computed', 'gold', 'glory', 'enemy_outgoing_damage', 'mult_hit_points',
]

# Row 236: these combine as prod(1+v)-1 instead of summing.
MULTIPLICATIVE = ('mult_damage', 'incoming_damage', 'mult_hit_points')

# Row 239: `combined_rating` is added to every one of these.
RATING_STATS = [
    'power', 'acc', 'ca', 'strike', 'severity', 'forte',
    'defense', 'awareness', 'crit_avoid', 'deflect', 'deflect_sev',
    'inc_healing', 'out_healing', 'control_bonus', 'control_resist',
]

# Rows 241 / 242 / 251: (percent stat, rating stat, cap%, rating allowed over IL, percent cap)
RATING_CONVERSION = [
    ('power_p',          'power',          0.60, 10000, 1.20),
    ('acc_p',            'acc',            0.50, 0,     0.90),
    ('ca_p',             'ca',             0.60, 10000, 1.20),
    ('strike_p',         'strike',         0.50, 0,     0.90),
    ('sev_p',            'severity',       0.60, 10000, 1.20),
    ('forte_p',          'forte',          0.60, 10000, 1.20),
    ('defense_p',        'defense',        0.60, 10000, 1.20),
    ('awareness_p',      'awareness',      0.50, 0,     0.90),
    ('crit_avoid_p',     'crit_avoid',     0.50, 0,     0.90),
    ('deflect_p',        'deflect',        0.50, 0,     0.90),
    ('deflect_sev_p',    'deflect_sev',    0.60, 10000, 1.20),
    ('inc_healing_p',    'inc_healing',    0.60, 10000, 1.20),
    ('out_healing_p',    'out_healing',    0.60, 10000, 1.20),
    ('control_bonus_p',  'control_bonus',  0.50, 0,     0.90),
    ('control_resist_p', 'control_resist', 0.50, 0,     0.90),
]

# Row 245: (ability, target stat, divisor)
ABILITY_CONTRIBUTIONS = [
    ('dex', 'sev_p', 200), ('cha', 'forte_p', 200),
    ('int', 'magical_damage_boost', 400), ('str', 'physical_damage_boost', 400),
    ('wis', 'out_healing_p', 400), ('con', 'ap_gain', 400),
    ('cha', 'recharge', 400), ('dex', 'movement', 400),
    ('str', 'stamina_regen', 200), ('int', 'control_bonus_p', 200),
    ('wis', 'control_resist_p', 200),
]

ROLE_HP_BONUS = {'Role: DPS': 1.0, 'Role: Healer': 1.1}          # default (Tank) 1.2
ROLE_DAMAGE_BONUS = {'Role: DPS': 1.2, 'Role: Healer': 1.1}      # default 1.0


# --- database -------------------------------------------------------------------------------

def split_ids(text):
    """'|a||b|' -> ['a', 'b']. Mirrors the sheet's SPLIT(x, '|') semantics."""
    if not text:
        return []
    return [part for part in str(text).split('|') if part]


def as_number(value):
    if value is True or value is False or value is None:
        return 0.0
    if isinstance(value, (int, float)):
        return float(value)
    return 0.0


class LegacyDb:
    def __init__(self, raw):
        self.items = {}
        for record in raw['items']:
            self.items[str(record['name'])] = record

    def get(self, name):
        return self.items.get(name)

    def stats(self, record):
        """The stat vector the build sheet reads out of a db-items row."""
        return {key: as_number(record.get(key, 0)) for key in LEGACY_STATS}

    @classmethod
    def load(cls, path=None):
        path = path or repo_path('data', 'raw', 'db-items.json')
        with open(path, encoding='utf-8') as fh:
            return cls(json.load(fh))


# --- bonus resolution (plan §1.2) -----------------------------------------------------------

def resolve_rows(db, choices):
    """Replicate test-dev columns P / Q / DD / DJ / DK for rows 13..234.

    `choices` maps row number -> the K-column value.

    Known sheet anomalies, deliberately NOT replicated: rows 29, 77-80 and 170 use instance /
    dedupe windows that were shifted by row insertions (row 77's dedupe window even extends
    *below* itself, to row 82). This implements the evident intent -- "all rows strictly above"
    -- which is what the new engine does too. If a fixture ever disagrees, look here first.
    """
    rows = []
    for row in range(FIRST_SLOT_ROW, LAST_SLOT_ROW + 1):
        choice = choices.get(row, '')
        record = None if choice in BLANK_CHOICES else db.get(choice)
        rows.append({
            'row': row,
            'choice': choice,
            'item': record,
            'partOf': split_ids(record.get('bonus_part_of')) if record else [],
            'withoutContrib': split_ids(record.get('bonus_part_of_without_contrib')) if record else [],
            'overrides': split_ids(record.get('bonus_overrides')) if record else [],
            'qualifiedRaw': split_ids(record.get('bonus_qualified')) if record else [],
            'maxParts': int(as_number(record.get('bonus_max_parts', 0))) if record else 0,
            'maxInstances': int(as_number(record.get('bonus_max_instances', 0))) if record else 0,
        })

    # Overrides are checked against every selected row (sheet: $DG$13:$DG$234).
    overridden = set()
    for entry in rows:
        overridden.update(entry['overrides'])

    # Top-to-bottom: dedupe qualifiers by choice string, and cap instances by earlier count.
    seen_choices = set()
    instance_counts = {}
    for entry in rows:
        entry['qualified'] = []
        if entry['item'] and entry['choice'] not in seen_choices:
            entry['qualified'] = list(entry['qualifiedRaw'])
        if entry['item']:
            seen_choices.add(entry['choice'])

        instanced = []
        limit = entry['maxInstances'] if entry['maxInstances'] != 0 else 1
        for bonus_id in dict.fromkeys(entry['partOf'] + entry['withoutContrib']):
            if bonus_id in overridden:
                continue
            if instance_counts.get(bonus_id, 0) < limit:
                instanced.append(bonus_id)
        entry['instanced'] = instanced
        for bonus_id in instanced:
            instance_counts[bonus_id] = instance_counts.get(bonus_id, 0) + 1

    # Global tallies.
    part_count, qualifier_count = {}, {}
    for entry in rows:
        for bonus_id in entry['partOf']:
            part_count[bonus_id] = part_count.get(bonus_id, 0) + 1
        for bonus_id in entry['qualified']:
            qualifier_count[bonus_id] = qualifier_count.get(bonus_id, 0) + 1

    # Payload lookup and per-row stat vector.
    bonus_log = []
    for entry in rows:
        stats = db.stats(entry['item']) if entry['item'] else {k: 0.0 for k in LEGACY_STATS}
        entry['matched'] = []
        for bonus_id in entry['instanced']:
            parts = part_count.get(bonus_id, 0)
            if entry['maxParts']:
                parts = min(parts, entry['maxParts'])
            quals = qualifier_count.get(bonus_id, 0)
            key = f'{bonus_id}::{parts}:{quals}'
            payload = db.get(key)
            entry['matched'].append({'id': bonus_id, 'key': key, 'found': payload is not None})
            bonus_log.append({
                'row': entry['row'], 'id': bonus_id, 'parts': parts, 'qualifiers': quals,
                'key': key, 'found': payload is not None,
            })
            if payload:
                for stat, value in db.stats(payload).items():
                    stats[stat] += value
        entry['stats'] = stats

    return rows, bonus_log


# --- pipeline (plan §1.3) --------------------------------------------------------------------

def zeros():
    return {key: 0.0 for key in LEGACY_STATS}


def run_pipeline(rows, state, db):
    """Rows 236-253 of the build sheet, in order."""
    # 236 -- initial sums (three stats combine multiplicatively).
    sums = zeros()
    products = {key: 1.0 for key in MULTIPLICATIVE}
    for entry in rows:
        for key, value in entry['stats'].items():
            if key in products:
                products[key] *= (1.0 + value)
            else:
                sums[key] += value
    for key, product in products.items():
        sums[key] = product - 1.0

    # 237 -- dynamic offhand modification: the item name encodes which stat it feeds.
    weapon_mods = zeros()
    mod_choice = state.get('choices', {}).get(ROW_OFFHAND_MOD2, '')
    mod_value = as_number(state.get('offhandModValue', 0))
    if mod_choice not in BLANK_CHOICES and mod_value:
        for key in LEGACY_STATS:
            if f'{key} ' in str(mod_choice).lower():
                weapon_mods[key] = mod_value

    after_mods = {k: sums[k] + weapon_mods[k] for k in LEGACY_STATS}          # 238

    # 239 -- combined rating feeds every rating stat. The sheet reads row 236, not 238.
    after_cr = dict(after_mods)                                              # 240
    for key in RATING_STATS:
        after_cr[key] += sums['combined_rating']

    # 241-243 -- rating to percent.
    item_level = after_cr['il']
    rating_pct = zeros()
    for percent, rating, cap_pct, allowed_over, _ in RATING_CONVERSION:
        shortfall = max(item_level + allowed_over - after_cr[rating], 0.0)
        rating_pct[percent] = cap_pct - shortfall / 100000.0
    after_pct = {k: after_cr[k] + rating_pct[k] for k in LEGACY_STATS}       # 244

    # 245 -- ability scores.
    ability = zeros()
    for stat_from, stat_to, divisor in ABILITY_CONTRIBUTIONS:
        ability[stat_to] += after_pct[stat_from] / divisor
    after_abilities = {k: after_pct[k] + ability[k] for k in LEGACY_STATS}   # 246
    # mult_hit_points is multiplicative, so con/200 is folded in as another factor.
    con_mult = after_pct['con'] / 200.0
    current = after_pct['mult_hit_points']
    after_abilities['mult_hit_points'] = (1 + current) * (1 + con_mult) - 1

    # 247-249 -- forte redistribution.
    forte = zeros()
    forte_pool = after_abilities['forte_p']
    choices = state.get('choices', {})
    targets = [
        (choices.get(ROW_FORTE1, ''), 2.0),
        (choices.get(ROW_FORTE2A, ''), 4.0),
        (choices.get(ROW_FORTE2B, ''), 4.0),
    ]
    for label, divisor in targets:
        if not isinstance(label, str) or not label.startswith('Forte: '):
            continue
        stat = label[len('Forte: '):]
        if stat in forte:
            forte[stat] += forte_pool / divisor
    if state.get('m32Forte'):
        forte = {k: round(v, 2) for k, v in forte.items()}

    totals = {k: after_abilities[k] + forte[k] for k in LEGACY_STATS}        # 250

    # 251-253 -- caps.
    caps = zeros()
    for percent, rating, _, allowed_over, pct_cap in RATING_CONVERSION:
        caps[rating] = totals['il'] + allowed_over
        caps[percent] = pct_cap
    capped, overcap = zeros(), zeros()
    for key in LEGACY_STATS:
        cap = caps[key]
        capped[key] = min(totals[key], cap) if cap > 0 else totals[key]
        overcap[key] = totals[key] - cap if cap > 0 else 0.0

    return {
        'sums': sums, 'afterWeaponMods': after_mods, 'afterCombinedRating': after_cr,
        'afterRatingPct': after_pct, 'afterAbilityScores': after_abilities,
        'afterForte': totals, 'totals': totals, 'caps': caps,
        'capped': capped, 'overcap': overcap,
    }


# --- derived outputs (plan §1.4) --------------------------------------------------------------

def average_by_chance(multiplier, chance):
    return chance * multiplier + (1.0 - chance)


def derive(stages, state):
    capped, sums = stages['capped'], stages['sums']
    totals = stages['totals']
    choices = state.get('choices', {})
    role = choices.get(ROW_ROLE, '')
    magnitude = as_number(state.get('magnitude', 0))
    magical = str(choices.get(ROW_DAMAGE_TYPE, 'Magical')).lower() == 'magical'

    item_level = totals['il']
    hp = ((item_level * 10 + capped['hit_points'])
          * ROLE_HP_BONUS.get(role, 1.2)
          * (1 + capped['hit_points_p'])
          * (1 + capped['mult_hit_points']))
    # Reads the *initial sums* row, not the capped row -- see plan §3 fix #1.
    base_damage = sums['flat_damage'] + item_level / 10 * ROLE_DAMAGE_BONUS.get(role, 1.0)

    eff_mag_phys = capped['magical_damage_boost'] if magical else capped['physical_damage_boost']
    enemy_eff = (capped['enemy_incoming_damage_magical'] if magical
                 else capped['enemy_incoming_damage_physical'])
    overall_ogh = capped['out_healing_p'] + capped['overall_healing']

    def damage(crit_chance, deflect_chance):
        crit_mult = 1 + capped['sev_p'] - capped['enemy_crit_avoid']
        deflect_mult = 1 / (1 + capped['enemy_deflect_sev'] - capped['acc_p'])
        other = ((1 + eff_mag_phys) * (1 + enemy_eff)
                 * (1 + capped['outgoing_damage'])
                 * (1 + capped['enemy_incoming_damage'])
                 * (1 + capped['mult_damage']))
        value = (base_damage
                 * (magnitude / 100.0)
                 * (1 + capped['power_p'])
                 * average_by_chance(crit_mult, crit_chance)
                 * (1 + capped['ca_p'] - capped['enemy_awareness'])
                 * (1 / (1 + capped['enemy_defense']))
                 * average_by_chance(deflect_mult, deflect_chance)
                 * other)
        return value * (1 / (1 - capped['overall_damage']))

    def healing(crit_chance):
        return (base_damage * (magnitude / 100.0) * (1 + capped['power_p'])
                * average_by_chance(1 + capped['sev_p'] / 2, crit_chance)
                * (1 + overall_ogh))

    def ehp(crit_chance, deflect_chance):
        crit_mult = 1 + capped['enemy_severity'] - capped['crit_avoid_p']
        deflect_mult = 1 / (1 + capped['deflect_sev_p'] - capped['enemy_accuracy'])
        final = ((1 / (1 + capped['defense_p']))
                 * (1 + capped['enemy_ca'] - capped['awareness_p'])
                 * average_by_chance(crit_mult, crit_chance)
                 * average_by_chance(deflect_mult, deflect_chance)
                 * (1 + capped['enemy_outgoing_damage'])
                 * (1 + capped['incoming_damage']))
        return hp / final

    return {
        'itemLevel': item_level,
        'hp': hp,
        'baseDamage': base_damage,
        'damage': {
            'average':      damage(capped['strike_p'], capped['enemy_deflect']),
            'critNoDeflect': damage(1.0, 0.0),
            'critDeflect':   damage(1.0, 1.0),
            'noCritNoDeflect': damage(0.0, 0.0),
            'noCritDeflect':   damage(0.0, 1.0),
        },
        'healing': {
            'average': healing(capped['strike_p']),
            'crit':    healing(1.0),
            'noCrit':  healing(0.0),
        },
        'ehp': {
            'average':       ehp(capped['enemy_strike'], capped['deflect_p']),
            'critNoDeflect': ehp(1.0, 0.0),
        },
    }


# --- errors (plan §1.6) -----------------------------------------------------------------------

def find_errors(rows, choices):
    errors = []
    chosen_class = choices.get(ROW_CLASS, '')
    counts = {}
    for entry in rows:
        if entry['item']:
            counts[entry['choice']] = counts.get(entry['choice'], 0) + 1

    for entry in rows:
        record = entry['item']
        if not record:
            continue
        flags = str(record.get('flags', '') or '')
        if 'allowed_class=' in flags and f'allowed_class={chosen_class}' not in flags:
            errors.append({'row': entry['row'], 'kind': 'class', 'choice': entry['choice']})
        max_copies = int(as_number(record.get('max_copies_computed', 0)))
        if max_copies and counts.get(entry['choice'], 0) > max_copies:
            errors.append({'row': entry['row'], 'kind': 'maxCopies', 'choice': entry['choice']})
    return errors


def evaluate(db, state):
    choices = {int(k): v for k, v in state.get('choices', {}).items()}
    state = dict(state, choices=choices)
    rows, bonus_log = resolve_rows(db, choices)
    stages = run_pipeline(rows, state, db)
    return {
        'stages': stages,
        'derived': derive(stages, state),
        'bonuses': bonus_log,
        'errors': find_errors(rows, choices),
    }


# --- entry point ------------------------------------------------------------------------------

def state_from_slots_dump(path):
    """Build an oracle input from `data/raw/slots.json` (the sheet's live state)."""
    raw = json.load(open(path, encoding='utf-8'))
    choices = {}
    for entry in raw['slots']:
        if 'current' in entry and entry['kind'] in ('item', 'derived', 'enum'):
            choices[entry['row']] = entry['current']
    return {
        'choices': choices,
        'magnitude': choices.get(ROW_MAGNITUDE, 0),
        'm32Forte': bool(raw['slots'] and any(
            e['row'] == ROW_M32_FORTE and e.get('current') for e in raw['slots'])),
        # N40 is not captured by the slot dump; make_fixture.py supplies it.
        'offhandModValue': raw.get('offhandModValue', 0),
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--state', default=repo_path('data', 'raw', 'slots.json'))
    ap.add_argument('--db', default=None)
    ap.add_argument('--json', default=None, help='write the full result here')
    args = ap.parse_args()

    db = LegacyDb.load(args.db)
    if os.path.basename(args.state) == 'slots.json':
        state = state_from_slots_dump(args.state)
    else:
        state = json.load(open(args.state, encoding='utf-8'))
        if 'state' in state:
            state = state['state']

    result = evaluate(db, state)

    derived = result['derived']
    print(f"item level      {derived['itemLevel']:>14,.0f}")
    print(f"hp              {derived['hp']:>14,.0f}")
    print(f"base damage     {derived['baseDamage']:>14,.0f}")
    print(f"damage average  {derived['damage']['average']:>14,.0f}")
    print(f"healing average {derived['healing']['average']:>14,.0f}")
    print(f"ehp average     {derived['ehp']['average']:>14,.0f}")

    missing = [b for b in result['bonuses'] if not b['found']]
    print(f"\nbonuses matched {len(result['bonuses']) - len(missing)}"
          f" / {len(result['bonuses'])}")
    for entry in missing:
        print(f"  NO PAYLOAD  row {entry['row']:>4}  {entry['key']}")
    if result['errors']:
        print(f"\n{len(result['errors'])} validation errors")
        for err in result['errors']:
            print(f"  {err['kind']:<10} row {err['row']:>4}  {err['choice']}")

    if args.json:
        with open(args.json, 'w', encoding='utf-8', newline='\n') as fh:
            json.dump(result, fh, indent=1)
        print(f"\nwrote {args.json}")


if __name__ == '__main__':
    main()
