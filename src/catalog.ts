// The item/bonus catalogue as composable layers.
//
// Until now the catalogue was fixed: `db.fromGlobals()` read `NW_ITEMS` / `NW_BONUSES` once and
// nothing could change it. The editor needs to change it, and custom gear saved *with a build*
// will need to change it per build -- so the catalogue is now a base plus an ordered list of
// overlays, folded together on demand.
//
//     effective = base  <-  workspace overlay  <-  (future) build overlay
//
// An overlay is `{ items: { [name]: item|null }, bonusSets: { [id]: set|null } }`, where the
// value replaces whatever the layers below it had and `null` is a tombstone hiding a base
// entry. That single shape covers add, edit and delete, survives JSON, and composes -- which
// is what makes the per-build case a matter of passing one more overlay rather than a redesign.
//
// Nothing here touches the DOM or the engine. `makeDb` hands the composed arrays to the
// existing `db.build`, so the engine cannot tell the difference.

import { NW_ITEMS, NW_BONUSES, NW_SCHEMA, NW_SLOTS } from './data';
import * as db from './db';
import type { Item, BonusSet, Schema, CatalogOverlay, CatalogGroup, ConditionWhen, LintFinding } from './types';

export const emptyOverlay = (): CatalogOverlay => ({ items: {}, bonusSets: {} });

export const isEmpty = (overlay: CatalogOverlay | null | undefined) => !overlay
  || (Object.keys(overlay.items ?? {}).length === 0
    && Object.keys(overlay.bonusSets ?? {}).length === 0);

/** Anything persisted or pasted has to survive being wrong. */
export function normaliseOverlay(raw: unknown): CatalogOverlay {
  const overlay = emptyOverlay();
  if (!raw || typeof raw !== 'object') return overlay;
  for (const group of ['items', 'bonusSets'] as const) {
    const source = (raw as Record<string, unknown>)[group];
    if (!source || typeof source !== 'object') continue;
    for (const [key, value] of Object.entries(source)) {
      if (value === null) overlay[group][key] = null;              // tombstone
      else if (value && typeof value === 'object') overlay[group][key] = value as Item & BonusSet;
    }
  }
  return overlay;
}

export const base = (): { items: Item[]; bonusSets: BonusSet[] } => ({
  items: NW_ITEMS ?? [],
  bonusSets: NW_BONUSES ?? [],
});

/**
 * Fold overlays over the base, later layers winning. Output is sorted by name/id so the
 * export is stable and diffs against the generated files stay readable.
 */
export function compose(overlays: (CatalogOverlay | null | undefined)[] = []) {
  const { items: baseItems, bonusSets: baseSets } = base();

  const items = new Map(baseItems.map((item) => [item.name, item]));
  const bonusSets = new Map(baseSets.map((set) => [set.id, set]));

  for (const overlay of overlays) {
    if (!overlay) continue;
    for (const [name, item] of Object.entries(overlay.items ?? {})) {
      if (item === null) items.delete(name);
      else items.set(name, item);
    }
    for (const [id, set] of Object.entries(overlay.bonusSets ?? {})) {
      if (set === null) bonusSets.delete(id);
      else bonusSets.set(id, set);
    }
  }

  return {
    items: [...items.values()].sort((a, b) => a.name.localeCompare(b.name)),
    bonusSets: [...bonusSets.values()].sort((a, b) => a.id.localeCompare(b.id)),
  };
}

/** A db the engine accepts, built from the composed catalogue. */
export function makeDb(overlays: (CatalogOverlay | null | undefined)[] = []) {
  const { items, bonusSets } = compose(overlays);
  return db.build(items, bonusSets, NW_SCHEMA, NW_SLOTS);
}

// --- editing (pure: every helper returns a new overlay) ---------------------------------

const clone = (overlay: CatalogOverlay): CatalogOverlay => ({
  items: { ...overlay.items },
  bonusSets: { ...overlay.bonusSets },
});

const inBase = (group: CatalogGroup, key: string) => (group === 'items'
  ? base().items.some((item) => item.name === key)
  : base().bonusSets.some((set) => set.id === key));

/** Save an entry. `previousKey` set and different means a rename. */
export function upsert(
  overlay: CatalogOverlay, group: CatalogGroup, key: string, value: Item | BonusSet, previousKey?: string,
) {
  const next = clone(overlay);
  if (previousKey && previousKey !== key) {
    // A renamed base entry still has to be hidden, or both names would resolve.
    if (inBase(group, previousKey)) next[group][previousKey] = null;
    else delete next[group][previousKey];
  }
  (next[group] as Record<string, Item | BonusSet | null>)[key] = value;
  return next;
}

/** Hide a base entry, or drop an added one outright. */
export function remove(overlay: CatalogOverlay, group: CatalogGroup, key: string) {
  const next = clone(overlay);
  if (inBase(group, key)) next[group][key] = null;
  else delete next[group][key];
  return next;
}

/** Forget an override so the base entry shows through again. */
export function revert(overlay: CatalogOverlay, group: CatalogGroup, key: string) {
  const next = clone(overlay);
  delete next[group][key];
  return next;
}

/** How an entry differs from what shipped -- drives the badges in the editor list. */
export function statusOf(overlay: CatalogOverlay | null | undefined, group: CatalogGroup, key: string) {
  const override = overlay?.[group]?.[key];
  const shipped = inBase(group, key);
  if (override === null) return 'removed';
  if (override === undefined) return shipped ? 'base' : 'base';
  return shipped ? 'edited' : 'added';
}

export { inBase };

// --- validation --------------------------------------------------------------------------

const CONDITION_KEYS = new Set(['toggle', 'role', 'class', 'combatType', 'location',
  'damageType', 'duration', 'pieces', 'equipped', 'all', 'any', 'not']);

// Every non-stat key an item may legitimately carry. Anything else is a typo, and a
// misspelled stat (`sevrity: 5000`) is invisible otherwise -- it simply never applies.
const ITEM_FIELDS = new Set(['name', 'filter', 'tags', 'maxCopies', 'allowedClass',
  'dynamicStat', 'dynamicMin', 'dynamicMax', 'bonuses', 'excludes']);

function checkConditions(
  when: ConditionWhen | undefined, path: string, report: (level: 'error' | 'warn', message: string) => void,
) {
  if (!when || typeof when !== 'object') return;
  for (const [key, spec] of Object.entries(when)) {
    if (!CONDITION_KEYS.has(key)) {
      // conditions.ts fails closed on an unknown key, so this would silently never apply.
      report('error', `${path}: unknown condition "${key}" — the bonus can never be active`);
      continue;
    }
    if (key === 'all' || key === 'any') {
      if (Array.isArray(spec)) spec.forEach((sub) => checkConditions(sub, path, report));
      else report('error', `${path}: "${key}" must be a list`);
    } else if (key === 'not') {
      checkConditions(spec as ConditionWhen, path, report);
    }
  }
}

/**
 * Lint the composed catalogue. Warnings are things that are probably a mistake; errors are
 * things the engine will misread or silently drop.
 */
export function validate(items: Item[], bonusSets: BonusSet[], schema: Schema = NW_SCHEMA): LintFinding[] {
  const findings: LintFinding[] = [];
  const report = (level: 'error' | 'warn', message: string, name?: string, kind: 'item' | 'bonusSet' = 'item') =>
    findings.push({ level, message, name, kind });

  const statKeys = new Set(schema.statKeys);
  const percentKinds = new Set(['percent', 'mult']);
  const allSlots = NW_SLOTS?.slots ?? [];
  const slotFilters = new Set(
    allSlots.filter((slot) => slot.type === 'item_picker').map((slot) => slot.filter),
  );
  const classSlot = allSlots.find((slot) => slot.type === 'build_parameter' && slot.path === 'context.class');
  const classes = new Set((classSlot?.type === 'build_parameter' ? classSlot.options : undefined)?.map((o) => o.value) ?? []);
  const setIds = new Set(bonusSets.map((set) => set.id));
  const seenNames = new Set();

  const checkStats = (
    stats: Record<string, unknown> | undefined, label: string, name?: string, kind: 'item' | 'bonusSet' = 'item',
  ) => {
    for (const [key, value] of Object.entries(stats ?? {})) {
      if (!statKeys.has(key)) {
        report('error', `${label}: "${key}" is not a stat in the schema`, name, kind);
        continue;
      }
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        report('error', `${label}: ${key} is not a finite number`, name, kind);
        continue;
      }
      // Percentages are decimals: 0.09 is 9%. Typing 9 means 900%, which is the single
      // easiest mistake to make in this data and impossible to spot in the totals.
      if (percentKinds.has(schema.statByKey[key]?.kind) && Math.abs(value) > 1.5) {
        report('warn', `${label}: ${key} = ${value} means ${value * 100}% — decimals here `
          + '(0.09 is 9%)', name, kind);
      }
    }
  };

  for (const item of items) {
    if (!item.name) { report('error', 'an item has no name'); continue; }
    if (seenNames.has(item.name)) report('error', 'duplicate item name', item.name);
    seenNames.add(item.name);

    if (!item.filter) report('error', 'no filter — the item appears in no slot', item.name);
    else if (!slotFilters.has(item.filter)) {
      report('warn', `filter "${item.filter}" matches no slot, so nothing can equip it`,
        item.name);
    }

    const stats: Record<string, unknown> = {};
    for (const key of Object.keys(item)) {
      if (statKeys.has(key)) stats[key] = item[key];
      else if (!ITEM_FIELDS.has(key)) {
        report('error', `"${key}" is neither a stat nor an item field — it is ignored `
          + 'entirely, so a misspelled stat name silently does nothing', item.name);
      }
    }
    checkStats(stats, 'stat', item.name);

    for (const cls of item.allowedClass ?? []) {
      if (!classes.has(cls)) report('error', `allowedClass "${cls}" is not a class`, item.name);
    }
    for (const setId of item.bonuses ?? []) {
      if (!setIds.has(setId)) {
        report('warn', `bonus "${setId}" has no definition`, item.name);
      }
    }
    if (item.dynamicStat && !statKeys.has(item.dynamicStat)) {
      report('error', `dynamicStat "${item.dynamicStat}" is not a stat`, item.name);
    }
  }

  for (const set of bonusSets) {
    if (!set.id) { report('error', 'a bonus set has no id'); continue; }
    set.grants?.forEach((grant, index) => {
      const label = `grant ${index + 1}`;
      checkConditions(grant.when, label, (level, message) =>
        report(level, message, set.id, 'bonusSet'));
      checkStats(grant.stats, label, set.id, 'bonusSet');
      for (const tier of grant.tiers ?? []) {
        checkStats(tier.stats, `${label} tier`, set.id, 'bonusSet');
      }
    });
  }

  return findings;
}

// --- export ------------------------------------------------------------------------------
// Produces valid JSON, so the result can replace data/db-items.json / data/db-bonuses.json
// wholesale with no further editing (JSON has no comment syntax, so unlike the pre-JSON
// export there is no header here -- the provenance note lives in data/db-items.js /
// data/db-bonuses.js, the loaders that fetch these files).

// Mirrors the key order the Python generator emits, so a pasted-back file diffs cleanly
// against a regenerated one instead of reordering every line.
const LEADING_KEYS = ['name', 'filter', 'il', 'combined_rating'];
const TRAILING_KEYS = ['maxCopies', 'dynamicStat', 'dynamicMin', 'dynamicMax',
  'allowedClass', 'tags', 'bonuses', 'excludes'];

const key = (name: string) => JSON.stringify(name);
const WRAP_AT = 96;

/**
 * Compact JSON serialiser: one line where it fits at the given indent, one entry per line
 * (nested one level deeper)
 */
export function literal(value: unknown, indent = 0): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    const parts = value.map((v) => literal(v, indent));
    const oneLine = `[${parts.join(', ')}]`;
    if (oneLine.length + indent <= WRAP_AT) return oneLine;
    const pad = ' '.repeat(indent + 2);
    const inner = value.map((v) => literal(v, indent + 2));
    return `[\n${inner.map((p) => pad + p).join(',\n')}\n${' '.repeat(indent)}]`;
  }
  if (typeof value === 'object') {
    return entriesLiteral(Object.entries(value as object).filter(([, v]) => v !== undefined), indent);
  }
  return JSON.stringify(value);
}

/** Same wrapping rule as `literal`, for an already-ordered `[key, value]` list. */
function entriesLiteral(entries: [string, unknown][], indent: number): string {
  const parts = entries.map(([k, v]) => `${key(k)}: ${literal(v, indent + 2)}`);
  const oneLine = `{${parts.join(', ')}}`;
  if (oneLine.length + indent <= WRAP_AT) return oneLine;
  const pad = ' '.repeat(indent + 2);
  return `{\n${parts.map((p) => pad + p).join(',\n')}\n${' '.repeat(indent)}}`;
}

function orderedEntries(item: Item, statKeys: string[]): [string, unknown][] {
  const used = new Set([...LEADING_KEYS, ...TRAILING_KEYS]);
  const stats = statKeys.filter((k) => item[k] !== undefined && !used.has(k));
  const rest = Object.keys(item)
    .filter((k) => !used.has(k) && !statKeys.includes(k));
  return [...LEADING_KEYS, ...stats, ...rest, ...TRAILING_KEYS]
    .filter((k) => item[k] !== undefined)
    .map((k) => [k, item[k]] as [string, unknown]);
}

// Every row sits at column 2 (one level inside the top-level array)
export function toItemsFile(items: Item[], statKeys: string[] = NW_SCHEMA.statKeys) {
  const body = items
    .map((item) => `  ${entriesLiteral(orderedEntries(item, statKeys), 2)}`)
    .join(',\n');
  return `[\n${body}\n]\n`;
}

export function toBonusesFile(bonusSets: BonusSet[]) {
  const body = bonusSets
    .map((set) => {
      const entries: [string, unknown][] = [['id', set.id], ['name', set.name ?? set.id], ['grants', set.grants ?? []]];
      for (const key of ['excludes', 'stacking', 'maxStacks'] as const) {
        if (set[key] !== undefined) entries.push([key, set[key]]);
      }
      return `  ${entriesLiteral(entries, 2)}`;
    })
    .join(',\n');
  return `[\n${body}\n]\n`;
}
