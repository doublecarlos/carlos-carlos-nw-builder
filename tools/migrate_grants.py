"""Collapse each bonus set's named `effects[]` into an anonymous `grants[]` list.

Reads and writes `data/db-bonuses.json` in place (unlike `migrate_bonuses.py`, which read the
now-retired raw sheet dump -- hand-editing the emitted JSON directly is the current workflow, so
this script's input is the committed file itself). Writes a review report, same "deliverable,
not a log" spirit as `migrate_bonuses.py`'s.

What it does, per bonus set:
  1. Each effect becomes a grant carrying only `when`/`stats`/`variants`/`tiers` -- `id`/`name`
     are dropped, since a grant no longer needs to be independently addressable (a set now
     resolves as one unit; the set's own `id`/`name` is the only identity that matters).
  2. `excludes`/`stacking`/`maxStacks` -- authored per-effect today -- are hoisted to the set
     level. Every set using any of these three fields has exactly one effect today, so this is
     a pure rename; if a future edit ever puts conflicting values on two effects of the same
     set, that's reported as a conflict rather than silently picking one.
  3. Dedup pass, per grant with `variants`/`tiers`: any stat key with the *same* value in every
     branch is hoisted into its own sibling flat grant. This is only done when the branch list
     is provably exhaustive (`variants`: some branch has no `when`; `tiers`: some tier matches
     at piece count 1) -- otherwise hoisting could make the bonus active in cases where today
     *no* branch matches and it stays fully inactive, which is a real behaviour change, not a
     no-op simplification. If hoisting leaves exactly one branch with anything left, *and* that
     branch is the first in the list (so first-match-wins can't have picked something else
     ahead of it), the whole variants/tiers wrapper collapses into one flat grant using that
     branch's own `when`. Any other shape (more than one branch left, or the lone survivor not
     first) is left as a smaller variants/tiers grant -- correct, just not maximally simplified.

Usage:
    ./venv/Scripts/python.exe tools/migrate_grants.py [--report PATH]
"""

import argparse
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from nwtools import repo_path      # noqa: E402
from nwtools import jsonemit       # noqa: E402
import json                        # noqa: E402

HOISTABLE_FIELDS = ('excludes', 'stacking', 'maxStacks')


def close(a, b):
    return math.isclose(a, b, rel_tol=1e-9, abs_tol=1e-12)


def combine_when(outer, inner):
    outer = outer or None
    inner = inner or None
    if not outer:
        return inner
    if not inner:
        return outer
    return {'all': [outer, inner]}


def variants_exhaustive(branches):
    return any(not b.get('when') for b in branches)


def tiers_exhaustive(branches):
    return any((b.get('pieces') or {}).get('atLeast', 1) <= 1 for b in branches)


def dedup_branches(branches):
    """Returns (hoisted_stats, new_branches) -- `new_branches` is the same length/order as
    `branches`, with any hoisted key removed from each branch's own `stats`."""
    keysets = [set(b.get('stats', {}).keys()) for b in branches]
    common = set.intersection(*keysets) if keysets else set()
    hoisted = {}
    for key in common:
        values = [b['stats'][key] for b in branches]
        if all(close(v, values[0]) for v in values):
            hoisted[key] = values[0]
    if not hoisted:
        return {}, branches

    new_branches = []
    for b in branches:
        stats = {k: v for k, v in b.get('stats', {}).items() if k not in hoisted}
        nb = dict(b)
        if stats:
            nb['stats'] = stats
        else:
            nb.pop('stats', None)
        new_branches.append(nb)
    return hoisted, new_branches


def collapse_grant(grant, report_entry):
    """A single effect (already stripped of id/name) -> a list of one or more grants."""
    kind = 'variants' if 'variants' in grant else ('tiers' if 'tiers' in grant else None)
    if kind is None:
        return [grant]

    branches = grant[kind]
    exhaustive = variants_exhaustive(branches) if kind == 'variants' else tiers_exhaustive(branches)
    if not exhaustive:
        report_entry['skipped'] = f'{kind} not provably exhaustive'
        return [grant]

    hoisted, new_branches = dedup_branches(branches)
    if not hoisted:
        return [grant]

    report_entry['hoisted'] = hoisted
    result = [{**({'when': grant['when']} if grant.get('when') else {}), 'stats': hoisted}]

    non_empty = [(i, b) for i, b in enumerate(new_branches) if b.get('stats')]
    if not non_empty:
        report_entry['collapsedTo'] = 'hoisted grant only'
        return result

    if len(non_empty) == 1 and non_empty[0][0] == 0:
        branch = non_empty[0][1]
        combined = combine_when(grant.get('when'), branch.get('when'))
        flat = {}
        if combined:
            flat['when'] = combined
        flat['stats'] = branch['stats']
        result.append(flat)
        report_entry['collapsedTo'] = 'single flat grant (branch 0)'
        return result

    remainder = dict(grant)
    remainder[kind] = new_branches
    result.append(remainder)
    report_entry['collapsedTo'] = f'{len(new_branches)}-branch {kind} grant (not fully collapsible)'
    return result


def migrate_set(bonus_set, report):
    effects = bonus_set.get('effects', [])
    hoisted_fields = {}
    conflicts = []
    grants = []

    for effect in effects:
        for field in HOISTABLE_FIELDS:
            if field not in effect:
                continue
            if field in hoisted_fields and hoisted_fields[field] != effect[field]:
                conflicts.append({'field': field, 'a': hoisted_fields[field], 'b': effect[field],
                                   'effect': effect.get('id')})
                continue
            hoisted_fields[field] = effect[field]

        grant = {}
        if effect.get('when'):
            grant['when'] = effect['when']
        if 'stats' in effect:
            grant['stats'] = effect['stats']
        if 'variants' in effect:
            grant['variants'] = effect['variants']
        if 'tiers' in effect:
            grant['tiers'] = effect['tiers']

        entry = {'set': bonus_set['id'], 'effect': effect.get('id')}
        collapsed = collapse_grant(grant, entry)
        grants.extend(collapsed)
        if 'hoisted' in entry or 'skipped' in entry:
            report['dedup'].append(entry)

    if conflicts:
        report['conflicts'].extend(conflicts)

    out = {'id': bonus_set['id'], 'name': bonus_set.get('name', bonus_set['id']), 'grants': grants}
    for field in HOISTABLE_FIELDS:
        if field in hoisted_fields:
            out[field] = hoisted_fields[field]
    return out


def write_report(path, report, bonus_sets):
    lines = ['# Grants migration review report', '']
    lines.append(f'{len(bonus_sets)} bonus sets processed.')
    lines.append('')

    lines.append(f'## Conflicts -- MUST be resolved ({len(report["conflicts"])})')
    lines.append('')
    if report['conflicts']:
        for c in report['conflicts']:
            lines.append(f"- `{c['field']}` on set `{c['set'] if 'set' in c else c.get('effect')}`: "
                          f"`{c['a']}` vs `{c['b']}` (effect `{c['effect']}`)")
    else:
        lines.append('none')
    lines.append('')

    fired = [d for d in report['dedup'] if 'hoisted' in d]
    lines.append(f'## Dedup fired ({len(fired)})')
    lines.append('')
    for d in fired:
        lines.append(f"- `{d['set']}` / `{d['effect']}`: hoisted `{d['hoisted']}` -> {d['collapsedTo']}")
    lines.append('')

    skipped = [d for d in report['dedup'] if 'skipped' in d]
    lines.append(f'## Dedup skipped, not provably exhaustive ({len(skipped)})')
    lines.append('')
    lines.append('These have a repeated stat value across branches that *could* be hoisted, but '
                  'the branch list has no explicit catch-all (`variants`) or piece-1 tier '
                  '(`tiers`), so hoisting could change behaviour when no branch matches today. '
                  'Left as-is; safe to simplify by hand if the omission is intentional.')
    lines.append('')
    for d in skipped:
        lines.append(f"- `{d['set']}` / `{d['effect']}`: {d['skipped']}")
    lines.append('')

    with open(path, 'w', encoding='utf-8', newline='\n') as fh:
        fh.write('\n'.join(lines) + '\n')


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--bonuses', default=repo_path('data', 'db-bonuses.json'))
    ap.add_argument('--report', default=repo_path('llm', 'docs', 'grants-migration-report.md'))
    args = ap.parse_args()

    with open(args.bonuses, encoding='utf-8') as fh:
        bonus_sets = json.load(fh)

    report = {'conflicts': [], 'dedup': []}
    out_sets = [migrate_set(s, report) for s in bonus_sets]

    jsonemit.write_rows(args.bonuses, out_sets)
    os.makedirs(os.path.dirname(args.report), exist_ok=True)
    write_report(args.report, report, bonus_sets)

    fired = sum(1 for d in report['dedup'] if 'hoisted' in d)
    skipped = sum(1 for d in report['dedup'] if 'skipped' in d)
    print(f'wrote {args.bonuses}')
    print(f'wrote {args.report}')
    print(f'  sets processed  {len(bonus_sets)}')
    print(f'  dedup fired     {fired}')
    print(f'  dedup skipped   {skipped}')
    print(f'  conflicts       {len(report["conflicts"])}')
    if report['conflicts']:
        print('\nconflicts found -- see the report')
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
