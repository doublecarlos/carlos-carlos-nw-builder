"""Translate legacy sheet build state (row numbers, option pseudo-items) into the new format.

Shared by `gen_fixture_js.py` and `gen_differ_cases.py` so there is exactly one definition of
"what does `Duration: > 30s` mean in the new model". Stdlib only.
"""

import json
import re

from . import repo_path

# Legacy duration buckets -> seconds on the numeric axis (plan §2.1).
#
# Verified equivalent to the legacy qualifier regexes. At 60s the legacy option qualified
# `-combat_long-`, `-combat_long_plus-`, `-combat_medium_plus-`, `-combat_short_plus-` and
# `-combat_insta_plus-`; the numeric predicates `{atLeast:60}` / `{atLeast:30}` /
# `{atLeast:10}` / `{}` reproduce exactly that set, and the same holds at 0, 10 and 30.
DURATIONS = {
    'Duration: > 0s': 0,
    'Duration: > 10s': 10,
    'Duration: > 30s': 30,
    'Duration: > 60s': 60,
}
DURATION_LABELS = {v: k for k, v in DURATIONS.items()}

COMBAT_TYPES = {
    'Type: Single Target': 'single',
    'Type: AoE': 'aoe',
    'Type: Mixed Boss': 'mixed',
}
COMBAT_TYPE_LABELS = {v: k for k, v in COMBAT_TYPES.items()}

LOCATIONS = {
    'Location: Generic': 'generic',
    'Location: Thay': 'thay',
    'Location: Wildspace': 'wildspace',
}
LOCATION_LABELS = {v: k for k, v in LOCATIONS.items()}

ROLES = {'Role: DPS': 'dps', 'Role: Healer': 'healer', 'Role: Tank': 'tank'}
ROLE_LABELS = {v: k for k, v in ROLES.items()}

# Sheet row -> context field.
ROW_CLASS, ROW_ROLE, ROW_DAMAGE_TYPE, ROW_MAGNITUDE = 14, 18, 19, 20
ROW_COMBAT_TYPE, ROW_DURATION, ROW_LOCATION, ROW_M32_FORTE = 22, 23, 24, 30
ROW_OFFHAND_MOD2 = 40
FORTE_ROWS = {15: 'primary', 16: 'secondaryA', 17: 'secondaryB'}
TOGGLE_ROWS = {25: 'consumables', 26: 'party', 27: 'combat', 28: 'procs', 29: 'artifactCall'}
TOGGLE_LABELS = {
    25: 'Consumables', 26: 'Party', 27: 'Combat', 28: 'Other Procs', 29: 'Artifact Call',
}


def strip_prefix(value, prefix):
    text = str(value or '')
    return text[len(prefix):].strip() if text.startswith(prefix) else text.strip()


def load_row_to_slot():
    """Row number -> slot id, read back out of the generated data/slots.js."""
    source = open(repo_path('data', 'slots.js'), encoding='utf-8').read()
    return {
        int(match.group(2)): match.group(1)
        for match in re.finditer(r'\{id:"([^"]+)".*?row:(\d+)\}', source)
    }


def build_context(choices):
    """Turn the sheet's option pseudo-items into a build context object."""
    context = {
        'class': strip_prefix(choices.get(ROW_CLASS), 'Class: ').lower() or None,
        'role': ROLES.get(str(choices.get(ROW_ROLE, '')).strip()),
        'combatType': COMBAT_TYPES.get(str(choices.get(ROW_COMBAT_TYPE, '')).strip()),
        'duration': DURATIONS.get(str(choices.get(ROW_DURATION, '')).strip()),
        'location': LOCATIONS.get(str(choices.get(ROW_LOCATION, '')).strip()),
        'damageType': str(choices.get(ROW_DAMAGE_TYPE, 'Magical')).strip().lower(),
        'magnitude': choices.get(ROW_MAGNITUDE, 0),
        'm32Forte': bool(choices.get(ROW_M32_FORTE, False)),
        'forte': {},
        'toggles': {},
    }
    for row, key in FORTE_ROWS.items():
        stat = strip_prefix(choices.get(row), 'Forte: ')
        if stat:
            context['forte'][key] = stat
    for row, key in TOGGLE_ROWS.items():
        # The sheet writes "<label>: Enabled" / "<label>: Disabled".
        context['toggles'][key] = str(choices.get(row, '')).strip().endswith(': Enabled')

    missing = [k for k in ('class', 'role', 'combatType', 'duration', 'location')
               if context.get(k) is None]
    return context, missing


def to_build(state, row_to_slot):
    """Legacy `{choices: {row: value}, offhandModValue}` -> new `{choices, values, context}`."""
    choices_by_row = {int(k): v for k, v in state['choices'].items()}
    context, missing = build_context(choices_by_row)

    choices = {}
    for row, value in sorted(choices_by_row.items()):
        slot_id = row_to_slot.get(row)
        if slot_id is None or value in ('', '-', True, None):
            continue
        choices[slot_id] = value

    values = {}
    mod_slot = row_to_slot.get(ROW_OFFHAND_MOD2)
    if mod_slot and state.get('offhandModValue'):
        values[mod_slot] = state['offhandModValue']

    return {'choices': choices, 'values': values, 'context': context}, missing


def context_to_rows(context):
    """Inverse of `build_context`: write a context back into the sheet's pseudo-item rows.

    Needed by the differ, which invents random contexts and must feed them to the legacy
    oracle in the form it understands.
    """
    rows = {
        ROW_CLASS: 'Class: ' + context['class'].capitalize(),
        ROW_ROLE: ROLE_LABELS[context['role']],
        ROW_COMBAT_TYPE: COMBAT_TYPE_LABELS[context['combatType']],
        ROW_DURATION: DURATION_LABELS[context['duration']],
        ROW_LOCATION: LOCATION_LABELS[context['location']],
        ROW_DAMAGE_TYPE: context['damageType'].capitalize(),
        ROW_MAGNITUDE: context['magnitude'],
        ROW_M32_FORTE: context['m32Forte'],
    }
    for row, key in FORTE_ROWS.items():
        stat = context['forte'].get(key)
        if stat:
            rows[row] = 'Forte: ' + stat
    for row, key in TOGGLE_ROWS.items():
        state = 'Enabled' if context['toggles'].get(key) else 'Disabled'
        rows[row] = f'{TOGGLE_LABELS[row]}: {state}'
    return rows
