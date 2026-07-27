"""Convert the legacy bonus encoding into the new declarative model (plan §2.6).

Reads `data/raw/db-items.json`; writes `data/db-items.js`, `data/db-bonuses.js` and a review
report. The report is a deliverable, not a warning log: it lists the decisions a human must
confirm before the migration is signed off.

What it collapses:
  * `<id>::<parts>:<quals>` payload rows      -> `{ when, stats }` effects with `atLeast`
    thresholds, so a new qualifier can never silently break an existing bonus.
  * `-tag-` suffixes                          -> `when` predicates (see TAG_PREDICATES).
  * duplicate rows differing only in `quals`  -> one effect gated on `equipped: {tag}`.
  * ids differing only in a role tag          -> one effect with `variants`.

Usage:
    ./venv/Scripts/python.exe tools/migrate_bonuses.py [--report PATH]
"""

import argparse
import json
import os
import re
import sys
from collections import defaultdict, OrderedDict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from nwtools import repo_path      # noqa: E402
from nwtools import jsemit         # noqa: E402
import corrections                 # noqa: E402

PAYLOAD_RE = re.compile(r'^(?P<id>.*)::(?P<parts>\d+):(?P<quals>\d+)$')
BONUS_MARKER = ':_Bonus_'

# Columns that are not stats.
NON_STAT_COLUMNS = {
    'name', 'filter', 'max_copies', 'max_copies_computed', 'flags', 'visible',
    'bonus_part_of', 'bonus_part_of_without_contrib', 'bonus_max_parts',
    'bonus_max_instances', 'bonus_overrides', 'bonus_qualifier_of',
    'bonus_qualifier_regex', 'bonus_qualified',
}

# Filters whose rows exist only to drive the legacy string engine. They carry no stats and
# become build context in the new model, so they are not emitted as items at all.
CONTEXT_FILTERS = {
    'option_class', 'option_role', 'option_forte', 'option_checkbox',
    'option_combat_type', 'option_combat_duration', 'option_location',
}

# Legacy `-tag-` -> `when` predicate. Anything not in here fails loudly into the report
# rather than defaulting to "always true" (plan Part 6 risk 2).
TAG_PREDICATES = {
    'combat':        {'toggle': 'combat'},
    'party':         {'toggle': 'party'},
    'consumables':   {'toggle': 'consumables'},
    'proc':          {'toggle': 'procs'},
    'artifact_call': {'toggle': 'artifactCall'},

    'dps':    {'role': 'dps'},
    'healer': {'role': 'healer'},
    'tank':   {'role': 'tank'},

    'single': {'combatType': 'single'},
    'aoe':    {'combatType': 'aoe'},
    'mixed':  {'combatType': 'mixed'},

    'location_thay':      {'location': 'thay'},
    'location_wildspace': {'location': 'wildspace'},

    # Duration buckets become a numeric axis (plan §2.1 / §2.6). `_plus` meant "this bucket or
    # longer"; a bare bucket meant "this bucket only".
    'combat_insta':        {'duration': {'below': 10}},
    'combat_insta_plus':   {},                                   # always true: 0s and up
    'combat_short':        {'duration': {'atLeast': 10, 'below': 30}},
    'combat_short_plus':   {'duration': {'atLeast': 10}},
    'combat_medium':       {'duration': {'atLeast': 30, 'below': 60}},
    'combat_medium_plus':  {'duration': {'atLeast': 30}},
    'combat_long':         {'duration': {'atLeast': 60}},
    'combat_long_plus':    {'duration': {'atLeast': 60}},
}

ROLE_TAGS = ('dps', 'healer', 'tank')

CLASS_PREFIX = 'allowed_class=Class: '


# --- helpers ---------------------------------------------------------------------------------

def split_ids(text):
    return [part for part in str(text or '').split('|') if part]


def slug(text):
    text = re.sub(r"[^A-Za-z0-9]+", '-', str(text)).strip('-').lower()
    return re.sub(r'-{2,}', '-', text) or 'bonus'


def number(value):
    if value is True or value is False or value is None or value == '':
        return 0.0
    return float(value) if isinstance(value, (int, float)) else 0.0


def parse_suffix(bonus_id):
    """'Owner:_Bonus_Main-combat-aoe-' -> ('Owner', 'Main', ['combat', 'aoe'])."""
    owner, _, suffix = bonus_id.partition(BONUS_MARKER)
    parts = suffix.split('-')
    label = parts[0] if parts and parts[0] else ''
    tags = [p for p in parts[1:] if p]
    return owner, label, tags


def merge_predicate(target, addition, conflicts):
    """AND another leaf into a `when` dict, recording contradictions instead of hiding them."""
    for key, value in addition.items():
        if key not in target:
            target[key] = value
            continue
        existing = target[key]
        if key == 'toggle':
            # `toggle` is conjunctive: `-combat-party-` means both must be on.
            merged = existing if isinstance(existing, list) else [existing]
            incoming = value if isinstance(value, list) else [value]
            target[key] = sorted(set(merged) | set(incoming))
        elif key == 'duration' and isinstance(existing, dict) and isinstance(value, dict):
            merged = dict(existing)
            if 'atLeast' in value:
                merged['atLeast'] = max(merged.get('atLeast', 0), value['atLeast'])
            if 'below' in value:
                merged['below'] = min(merged.get('below', 10 ** 9), value['below'])
            target[key] = merged
        elif existing != value:
            # role / combatType / location are single-valued: two different values can never
            # both hold, so this is a genuine contradiction, not a list.
            conflicts.append((key, existing, value))


def tags_to_when(tags, report_row):
    when, conflicts = OrderedDict(), []
    for tag in tags:
        if tag not in TAG_PREDICATES:
            report_row['unknownTags'].append(tag)
            continue
        merge_predicate(when, TAG_PREDICATES[tag], conflicts)
    if conflicts:
        report_row['conflicts'].extend(conflicts)
    return when


def qualifier_tag(names):
    """Derive a stable tag for a group of qualifying items.

    Every current user is an enchantment named like `2) Aquamarine (Crit Avoid/Deflect)`, so
    the gem name is the natural tag. Anything else gets an explicit synthetic tag rather than a
    guess, and is listed in the report.
    """
    gems = set()
    for name in names:
        match = re.match(r'^\d+\)\s*([A-Za-z][A-Za-z ]*?)\s*\(', name)
        if not match:
            return None
        gems.add(match.group(1).strip().lower())
    if len(gems) == 1:
        return 'gem:' + re.sub(r'\s+', '_', gems.pop())
    return None


def stat_dict(record, stat_columns):
    return OrderedDict(
        (key, record[key]) for key in stat_columns
        if key in record and number(record[key]) != 0.0
    )


# --- migration -------------------------------------------------------------------------------

class Migration:
    def __init__(self, raw):
        self.columns = raw['columns']
        self.stat_columns = [c for c in self.columns if c and c not in NON_STAT_COLUMNS]
        self.records = {str(r['name']): r for r in raw['items']}
        self.report = {
            'unknownTags': [], 'conflicts': [], 'orphanIds': [], 'unusedPayloads': [],
            'qualifierGroups': [], 'stacking': [], 'excludes': [], 'maxParts': [],
            'inconsistentQualCount': [], 'notes': [], 'corrections': [],
        }
        # Deliberate fixes to source-data bugs, applied before anything is derived.
        # The raw dump and the legacy oracle stay untouched, so the differential test reports
        # each of these as an explainable divergence instead of hiding it.
        corrections.apply(self.records, self.report)

    # -- pass 1: split payload rows from real items ------------------------------------------
    def partition(self):
        self.payloads = defaultdict(list)     # bonus id -> [(parts, quals, record)]
        self.items = OrderedDict()
        for name, record in self.records.items():
            match = PAYLOAD_RE.match(name)
            if match:
                self.payloads[match.group('id')].append(
                    (int(match.group('parts')), int(match.group('quals')), record)
                )
                continue
            if BONUS_MARKER in name:
                # A `:_Bonus_` row that is not a payload row: nothing references it usefully.
                self.report['notes'].append(f'ignored non-payload bonus row: {name}')
                continue
            self.items[name] = record

        # membership and qualifier back-references
        self.members = defaultdict(list)
        self.qualifiers = defaultdict(list)
        for name, record in self.items.items():
            for bonus_id in split_ids(record.get('bonus_part_of')):
                self.members[bonus_id].append(name)
            for bonus_id in split_ids(record.get('bonus_part_of_without_contrib')):
                self.members[bonus_id].append(name)
            for bonus_id in split_ids(record.get('bonus_qualifier_of')):
                self.qualifiers[bonus_id].append(name)

        referenced = set(self.members) | set(self.qualifiers)
        for bonus_id in sorted(referenced - set(self.payloads)):
            self.report['orphanIds'].append({
                'id': bonus_id, 'members': self.members.get(bonus_id, []),
            })
        for bonus_id in sorted(set(self.payloads) - set(self.members)):
            self.report['unusedPayloads'].append(bonus_id)

    # -- pass 2: one bonus per legacy id -------------------------------------------------------
    def build_bonuses(self):
        self.bonuses = []
        self.item_tags = defaultdict(set)

        for bonus_id in sorted(self.payloads):
            members = self.members.get(bonus_id, [])
            if not members:
                continue        # unused payload: already reported

            owner, label, tags = parse_suffix(bonus_id)
            row = {'id': bonus_id, 'unknownTags': [], 'conflicts': []}
            when = tags_to_when(tags, row)
            self.report['unknownTags'].extend(
                {'id': bonus_id, 'tag': t} for t in row['unknownTags'])
            self.report['conflicts'].extend(
                {'id': bonus_id, 'key': k, 'a': a, 'b': b} for k, a, b in row['conflicts'])

            qual_names = self.qualifiers.get(bonus_id, [])
            if qual_names:
                tag = qualifier_tag(qual_names)
                if tag is None:
                    tag = 'qual:' + slug(bonus_id)
                    self.report['qualifierGroups'].append({
                        'id': bonus_id, 'tag': tag, 'items': qual_names,
                        'note': 'synthetic tag -- names did not share a gem prefix',
                    })
                else:
                    self.report['qualifierGroups'].append({
                        'id': bonus_id, 'tag': tag, 'items': qual_names,
                    })
                for name in qual_names:
                    self.item_tags[name].add(tag)
                when['equipped'] = {'tag': tag, 'atLeast': 1}

            variants = self.payloads[bonus_id]
            expected_quals = len(tags) + (1 if qual_names else 0)

            # Distinct `parts` counts are genuine piece-count tiers (1 insignia vs 2), and the
            # payloads are absolute rather than cumulative -- the legacy exact-match made them
            # mutually exclusive. Distinct `quals` counts within one `parts` level are the
            # enumeration tax (`::1:1` and `::1:2` with identical stats) and collapse away.
            by_parts = defaultdict(list)
            for parts, quals, record in variants:
                by_parts[parts].append((quals, record))

            tiers = []
            for parts in sorted(by_parts):
                group = by_parts[parts]
                distinct = {json.dumps(stat_dict(rec, self.stat_columns), sort_keys=True)
                            for _, rec in group}
                if len(distinct) > 1:
                    self.report['inconsistentQualCount'].append({
                        'id': bonus_id, 'parts': parts,
                        'note': 'payload rows at the same piece count disagree on stats',
                        'variants': [{'quals': q, 'stats': stat_dict(rec, self.stat_columns)}
                                     for q, rec in group],
                    })
                for quals, _ in group:
                    if not qual_names and quals != expected_quals:
                        self.report['inconsistentQualCount'].append({
                            'id': bonus_id, 'parts': parts, 'quals': quals,
                            'expected': expected_quals,
                            'note': 'qualifier count does not match the tag count',
                        })
                _, best_record = max(group, key=lambda g: g[0])
                tiers.append({'pieces': parts,
                              'stats': stat_dict(best_record, self.stat_columns)})

            parts_needed = min(by_parts)
            stats = tiers[0]['stats']

            member_records = [self.items[m] for m in members]
            max_parts = max((int(number(r.get('bonus_max_parts', 0))) for r in member_records),
                            default=0)
            if max_parts:
                self.report['maxParts'].append({
                    'id': bonus_id, 'maxParts': max_parts, 'members': members,
                    'note': 'legacy clamp; unnecessary with `atLeast` thresholds',
                })
            max_instances = max(
                (int(number(r.get('bonus_max_instances', 0))) for r in member_records), default=0)

            self.bonuses.append({
                'id': bonus_id, 'owner': owner, 'label': label, 'tags': tags,
                'members': members, 'when': when, 'stats': stats, 'tiers': tiers,
                'parts': parts_needed, 'maxInstances': max_instances,
            })

    # -- pass 3: collapse role-only variants ---------------------------------------------------
    def collapse_roles(self):
        groups = defaultdict(list)
        for bonus in self.bonuses:
            non_role = tuple(t for t in bonus['tags'] if t not in ROLE_TAGS)
            key = (bonus['owner'], bonus['label'], non_role, tuple(sorted(bonus['members'])))
            groups[key].append(bonus)

        collapsed = []
        for group in groups.values():
            # A group can mix a role-agnostic base effect with per-role effects sharing the
            # same other conditions (M33 Chilling Flow does exactly this). Only the role-tagged
            # subset collapses; the base stays an independent effect.
            role_members = [b for b in group if b['when'].get('role')]
            others = [b for b in group if not b['when'].get('role')]
            collapsed.extend(others)

            if len(role_members) < 2:
                collapsed.extend(role_members)
                continue
            # Tiers are per-piece-count and cannot be folded into role variants.
            if any(len(b.get('tiers') or []) > 1 for b in role_members):
                collapsed.extend(role_members)
                self.report['notes'].append(
                    f'not collapsing role variants of {role_members[0]["id"]}: has piece tiers')
                continue

            base = dict(role_members[0])
            base['when'] = OrderedDict(
                (k, v) for k, v in base['when'].items() if k != 'role')
            base['variants'] = [
                {'when': {'role': bonus['when']['role']}, 'stats': bonus['stats']}
                for bonus in sorted(role_members, key=lambda b: b['when']['role'])
            ]
            base.pop('stats', None)
            base.pop('tiers', None)
            base['collapsedFrom'] = [b['id'] for b in role_members]
            collapsed.append(base)
            self.report['notes'].append(
                f'collapsed {len(role_members)} role variants into {base["id"]}')

        self.bonuses = collapsed

    # -- pass 4: emit --------------------------------------------------------------------------
    def emit(self):
        shared = []

        for bonus in self.bonuses:
            tiers = bonus.get('tiers') or []
            set_id = slug(bonus['owner'])
            # Every bonus lives in a named set now, whether or not anything else shares it --
            # a single-item, single-tier bonus becomes a private set with one member. The only
            # thing that ever made a set structurally necessary is a `pieces` condition needing
            # something to count against; that still works exactly the same way, it just no
            # longer decides whether a set exists at all.
            needs_pieces_condition = len(tiers) > 1 or bonus['parts'] > 1

            payload = OrderedDict()
            payload['id'] = slug(bonus['owner'] + '-' + (bonus['label'] or 'bonus')
                                 + '-' + '-'.join(bonus['tags']))
            # A friendly name, next to the slug id -- the base/only effect for an owner is just
            # called after it; a second effect on the same owner (an alternate condition, e.g.
            # M31 Thayan Predator's location:thay variant) appends what distinguishes it. Not
            # polished English, but distinct and always populated; a human can hand-edit any of
            # these afterwards through the data editor's Name field.
            qualifier_parts = [p for p in ([bonus['label']] + bonus['tags']) if p]
            payload['name'] = (bonus['owner'] if not qualifier_parts
                                else f"{bonus['owner']} "
                                     f"({', '.join(p.replace('_', ' ') for p in qualifier_parts)})")
            if bonus['when']:
                payload['when'] = dict(bonus['when'])

            if bonus.get('variants'):
                payload['variants'] = bonus['variants']
            elif len(tiers) > 1:
                # Highest matching tier wins; payloads are absolute, not cumulative.
                payload['tiers'] = [
                    {'pieces': {'set': set_id, 'atLeast': tier['pieces']},
                     'stats': tier['stats']}
                    for tier in tiers
                ]
            else:
                payload['stats'] = bonus['stats']

            if needs_pieces_condition and not payload.get('tiers') and bonus['parts'] > 1:
                when = dict(payload.get('when') or {})
                when['pieces'] = {'set': set_id, 'atLeast': bonus['parts']}
                payload['when'] = when

            if bonus['maxInstances'] and bonus['maxInstances'] > 1:
                payload['stacking'] = 'perSource'
                self.report['stacking'].append({
                    'id': payload['id'], 'members': bonus['members'],
                    'legacyMaxInstances': bonus['maxInstances'],
                })

            shared.append({'bonus': payload, 'members': bonus['members'],
                           'owner': bonus['owner'], 'setId': set_id})

        # group bonuses by set (a set of size 1 is a bonus that is nobody else's business)
        sets = OrderedDict()
        item_sets = defaultdict(set)
        owner_by_set = {}
        for entry in shared:
            record = sets.setdefault(entry['setId'], {
                'id': entry['setId'], 'name': entry['owner'], 'effects': [],
            })
            # Two different owners should never collapse to the same set id -- that would
            # silently merge two unrelated items' bonuses into one set.
            prior_owner = owner_by_set.setdefault(entry['setId'], entry['owner'])
            assert prior_owner == entry['owner'], (
                f'set id {entry["setId"]!r} claimed by both {prior_owner!r} and '
                f'{entry["owner"]!r} -- slug collision, needs a disambiguation rule'
            )
            effect = dict(entry['bonus'])
            effect.pop('setId', None)
            record['effects'].append(effect)
            for member in entry['members']:
                item_sets[member].add(entry['setId'])

        items = []
        for name, record in self.items.items():
            if record.get('filter') in CONTEXT_FILTERS:
                continue
            out = OrderedDict()
            out['name'] = name
            out['filter'] = record.get('filter', '')
            for key, value in stat_dict(record, self.stat_columns).items():
                out[key] = value

            max_copies = int(number(record.get('max_copies_computed', 0)))
            if max_copies:
                out['maxCopies'] = max_copies

            # FIX #6: dynamic offhand modifications declare their target stat and range instead
            # of the sheet's `SEARCH(statName & " ", itemName)` on the display name.
            if record.get('filter') == 'modification_offhand_dynamic':
                match = re.match(r'^([A-Za-z_]+)\s*\(.*?(\d+)\s*to\s*(\d+)', name)
                stat = match.group(1).strip().lower() if match else None
                if stat in self.stat_columns:
                    out['dynamicStat'] = stat
                    out['dynamicMin'] = int(match.group(2))
                    out['dynamicMax'] = int(match.group(3))
                else:
                    self.report['notes'].append(
                        f'dynamic modification {name!r}: could not derive a target stat '
                        f'(parsed {stat!r}) -- it will contribute nothing')

            flags = str(record.get('flags', '') or '')
            classes = [m.lower() for m in re.findall(
                re.escape(CLASS_PREFIX) + r'([A-Za-z]+)', flags)]
            if classes:
                out['allowedClass'] = sorted(set(classes))

            if name in self.item_tags:
                out['tags'] = sorted(self.item_tags[name])
            if name in item_sets:
                out['bonuses'] = sorted(item_sets[name])

            excludes = split_ids(record.get('bonus_overrides'))
            if excludes:
                out['excludes'] = [slug(parse_suffix(e)[0] + '-'
                                        + (parse_suffix(e)[1] or 'bonus') + '-'
                                        + '-'.join(parse_suffix(e)[2]))
                                   for e in excludes]
                self.report['excludes'].append({'item': name, 'legacy': excludes,
                                                'excludes': out['excludes']})
            items.append(out)

        return items, list(sets.values())


# --- report -----------------------------------------------------------------------------------

def write_report(path, migration, items, bonus_sets):
    report = migration.report
    effect_count = sum(len(s['effects']) for s in bonus_sets)
    payload_rows = sum(len(v) for v in migration.payloads.values())

    lines = [
        '# Bonus migration review report',
        '',
        'Generated by `tools/migrate_bonuses.py`. Read the two **MUST** sections first; the',
        'rest is context for the sign-off described in plan §5.2.',
        '',
        '## Summary',
        '',
        f'- **{payload_rows} legacy payload rows -> {effect_count} effects** '
        f'({len(migration.payloads)} distinct bonus ids)',
        f'- {len(items)} items emitted ({len(migration.records)} raw rows in, '
        f'{payload_rows} of them payload rows, '
        f'{len(migration.records) - payload_rows - len(items)} option pseudo-items dropped)',
        f'- {len(bonus_sets)} bonus sets holding {effect_count} effects '
        f'(every bonus lives in a named set; a set with one member is private to that item)',
        '',
        '## Decisions — all resolved (2026-07-26)',
        '',
        '1. **Chilling Flow healer/tank payloads were unwired.** `M33 Wintermarked Frostlute` '
        'and `M33 Wintermarked Skaldblade` listed only the base and `-dps-` variants, so a '
        'healer or tank using those weapons got nothing. Confirmed an omission → wired, see '
        'Corrections below.',
        '2. **`Sambocade (Movement)` had a payload row but no membership,** so the food granted '
        'nothing. Confirmed a bug → wired.',
        '3. **Insignia covenant penalty was counted twice at one piece.** '
        "`Executioner's Covenant` carried the -1500 defensive penalty on the item row *and* on "
        'its 1-piece payload. Confirmed a bug → removed from the item row.',
        '4. **`M33 Critical Breaker` is a single-item bonus.** Legacy enumerated only `::1:2`, '
        'so wearing both member pieces (Hunter Hood + Marcher Poleyns) computed `::2:2`, found '
        'no payload row and silently granted nothing. Confirmed: it applies **once at one or '
        'more copies**. No correction is needed -- the new model already does this (no `pieces` '
        'threshold, `stacking: unique`). The sheet-side cause was a missing `bonus_max_parts: '
        '1`; that mechanism does not exist in the new model, so the bug cannot recur. Locked in '
        'by a unit test in `tests/unit.js`.',
        '',
    ]

    def section(title, rows, render):
        lines.append(f'## {title} ({len(rows)})')
        lines.append('')
        if not rows:
            lines.append('_none_')
        else:
            for row in rows:
                lines.append('- ' + render(row))
        lines.append('')

    lines.append(f'## Corrections applied to source data ({len(report["corrections"])})')
    lines.append('')
    lines.append('Defined in `tools/corrections.py`. The raw dump and the legacy oracle are')
    lines.append('left untouched, so each of these shows up in the differential test as an')
    lines.append('intentional divergence. Delete an entry once it is fixed in the sheet.')
    lines.append('')
    for entry in report['corrections']:
        lines.append(f'- **{entry["item"]}** — {entry["status"]}')
        for change in entry.get('changes', []):
            lines.append(f'  - `{change}`')
        lines.append(f'  - _{entry["reason"]}_')
    if not report['corrections']:
        lines.append('_none_')
    lines.append('')

    section('Unknown tags -- MUST be resolved', report['unknownTags'],
            lambda r: f'`{r["tag"]}` in `{r["id"]}`')
    section('Contradictory predicates -- MUST be resolved', report['conflicts'],
            lambda r: f'`{r["id"]}`: {r["key"]} = {r["a"]!r} vs {r["b"]!r}')
    section('Dangling bonus ids (referenced, no payload row)', report['orphanIds'],
            lambda r: f'`{r["id"]}` referenced by {r["members"]}')
    section('Payload rows nothing references', report['unusedPayloads'],
            lambda r: f'`{r}`')
    section('Item-qualifier groups (legacy `bonus_qualifier_of`)', report['qualifierGroups'],
            lambda r: f'`{r["id"]}` -> tag `{r["tag"]}` from {r["items"]}'
                      + (f' -- {r["note"]}' if 'note' in r else ''))
    section('Stacking (legacy `bonus_max_instances` > 1)', report['stacking'],
            lambda r: f'`{r["id"]}` members={r["members"]} legacy={r["legacyMaxInstances"]}')
    section('Exclusions (legacy `bonus_overrides`)', report['excludes'],
            lambda r: f'`{r["item"]}` excludes {r["excludes"]}')
    section('Legacy `bonus_max_parts` clamps (now redundant)', report['maxParts'],
            lambda r: f'`{r["id"]}` maxParts={r["maxParts"]} members={r["members"]}')
    section('Qualifier-count anomalies', report['inconsistentQualCount'],
            lambda r: f'`{r["id"]}` -- {r["note"]}'
                      + (f' (parts={r.get("parts")}, quals={r.get("quals")},'
                         f' expected={r.get("expected")})' if 'expected' in r else ''))
    section('Notes', report['notes'], lambda r: r)

    with open(path, 'w', encoding='utf-8', newline='\n') as fh:
        fh.write('\n'.join(lines) + '\n')


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--raw', default=repo_path('data', 'raw', 'db-items.json'))
    ap.add_argument('--report', default=repo_path('llm', 'docs', 'migration-report.md'))
    args = ap.parse_args()

    raw = json.load(open(args.raw, encoding='utf-8'))
    migration = Migration(raw)
    migration.partition()
    migration.build_bonuses()
    migration.collapse_roles()
    items, bonus_sets = migration.emit()

    jsemit.write_file(
        repo_path('data', 'db-items.js'), 'NW_ITEMS', items,
        header_comment=(
            'GENERATED by tools/migrate_bonuses.py from data/raw/db-items.json.\n'
            'Safe to hand-edit once migration is signed off -- adding an item is one line.\n'
            'Percentages are decimals (0.09 === 9%). See plan §4.3.'
        ))
    jsemit.write_file(
        repo_path('data', 'db-bonuses.js'), 'NW_BONUSES', bonus_sets,
        header_comment=(
            'GENERATED by tools/migrate_bonuses.py -- every bonus, one per set.\n'
            'A set with one member is private to that item; membership lives on the items\n'
            '(`sets: [...]`), never here. See plan §2.3.'
        ))

    os.makedirs(os.path.dirname(args.report), exist_ok=True)
    write_report(args.report, migration, items, bonus_sets)

    print(f'wrote data/db-items.js   ({len(items)} items)')
    print(f'wrote data/db-bonuses.js ({len(bonus_sets)} sets)')
    print(f'wrote {args.report}')

    must_fix = len(migration.report['unknownTags']) + len(migration.report['conflicts'])
    print()
    print(f'  unknown tags        {len(migration.report["unknownTags"])}')
    print(f'  predicate conflicts {len(migration.report["conflicts"])}')
    print(f'  dangling ids        {len(migration.report["orphanIds"])}')
    print(f'  unused payloads     {len(migration.report["unusedPayloads"])}')
    print(f'  qualifier groups    {len(migration.report["qualifierGroups"])}')
    print(f'  qual-count anomalies {len(migration.report["inconsistentQualCount"])}')
    if must_fix:
        print(f'\n{must_fix} blocking issue(s) -- see the report')
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
