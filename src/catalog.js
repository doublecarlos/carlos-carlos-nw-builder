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
// existing `NW.db.build`, so the engine cannot tell the difference.

window.NW = window.NW ?? {};
window.NW.catalog = (() => {
  'use strict';

  const emptyOverlay = () => ({ items: {}, bonusSets: {} });

  const isEmpty = (overlay) => !overlay
    || (Object.keys(overlay.items ?? {}).length === 0
      && Object.keys(overlay.bonusSets ?? {}).length === 0);

  /** Anything persisted or pasted has to survive being wrong. */
  function normaliseOverlay(raw) {
    const overlay = emptyOverlay();
    if (!raw || typeof raw !== 'object') return overlay;
    for (const group of ['items', 'bonusSets']) {
      const source = raw[group];
      if (!source || typeof source !== 'object') continue;
      for (const [key, value] of Object.entries(source)) {
        if (value === null) overlay[group][key] = null;              // tombstone
        else if (value && typeof value === 'object') overlay[group][key] = value;
      }
    }
    return overlay;
  }

  const base = () => ({
    items: window.NW_ITEMS ?? [],
    bonusSets: window.NW_BONUSES ?? [],
  });

  /**
   * Fold overlays over the base, later layers winning. Output is sorted by name/id so the
   * export is stable and diffs against the generated files stay readable.
   */
  function compose(overlays = []) {
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
  function makeDb(overlays = []) {
    const { items, bonusSets } = compose(overlays);
    return window.NW.db.build(items, bonusSets, window.NW_SCHEMA, window.NW_SLOTS);
  }

  // --- editing (pure: every helper returns a new overlay) ---------------------------------

  const clone = (overlay) => ({
    items: { ...overlay.items },
    bonusSets: { ...overlay.bonusSets },
  });

  const inBase = (group, key) => (group === 'items'
    ? base().items.some((item) => item.name === key)
    : base().bonusSets.some((set) => set.id === key));

  /** Save an entry. `previousKey` set and different means a rename. */
  function upsert(overlay, group, key, value, previousKey) {
    const next = clone(overlay);
    if (previousKey && previousKey !== key) {
      // A renamed base entry still has to be hidden, or both names would resolve.
      if (inBase(group, previousKey)) next[group][previousKey] = null;
      else delete next[group][previousKey];
    }
    next[group][key] = value;
    return next;
  }

  /** Hide a base entry, or drop an added one outright. */
  function remove(overlay, group, key) {
    const next = clone(overlay);
    if (inBase(group, key)) next[group][key] = null;
    else delete next[group][key];
    return next;
  }

  /** Forget an override so the base entry shows through again. */
  function revert(overlay, group, key) {
    const next = clone(overlay);
    delete next[group][key];
    return next;
  }

  /** How an entry differs from what shipped -- drives the badges in the editor list. */
  function statusOf(overlay, group, key) {
    const override = overlay?.[group]?.[key];
    const shipped = inBase(group, key);
    if (override === null) return 'removed';
    if (override === undefined) return shipped ? 'base' : 'base';
    return shipped ? 'edited' : 'added';
  }

  // --- validation --------------------------------------------------------------------------

  const CONDITION_KEYS = new Set(['toggle', 'role', 'class', 'combatType', 'location',
    'damageType', 'duration', 'pieces', 'equipped', 'all', 'any', 'not']);

  // Every non-stat key an item may legitimately carry. Anything else is a typo, and a
  // misspelled stat (`sevrity: 5000`) is invisible otherwise -- it simply never applies.
  const ITEM_FIELDS = new Set(['name', 'filter', 'tags', 'maxCopies', 'allowedClass',
    'dynamicStat', 'dynamicMin', 'dynamicMax', 'bonuses', 'excludes']);

  function checkConditions(when, path, report) {
    if (!when || typeof when !== 'object') return;
    for (const [key, spec] of Object.entries(when)) {
      if (!CONDITION_KEYS.has(key)) {
        // conditions.js fails closed on an unknown key, so this would silently never apply.
        report('error', `${path}: unknown condition "${key}" — the bonus can never be active`);
        continue;
      }
      if (key === 'all' || key === 'any') {
        if (Array.isArray(spec)) spec.forEach((sub) => checkConditions(sub, path, report));
        else report('error', `${path}: "${key}" must be a list`);
      } else if (key === 'not') {
        checkConditions(spec, path, report);
      }
    }
  }

  /**
   * Lint the composed catalogue. Warnings are things that are probably a mistake; errors are
   * things the engine will misread or silently drop.
   */
  function validate(items, bonusSets, schema = window.NW_SCHEMA) {
    const findings = [];
    const report = (level, message, name) => findings.push({ level, message, name });

    const statKeys = new Set(schema.statKeys);
    const percentKinds = new Set(['percent', 'mult']);
    const slotFilters = new Set((window.NW_SLOTS?.slots ?? []).map((slot) => slot.filter));
    const classes = new Set(schema.context.classes);
    const setIds = new Set(bonusSets.map((set) => set.id));
    const seenNames = new Set();

    const checkStats = (stats, label, name) => {
      for (const [key, value] of Object.entries(stats ?? {})) {
        if (!statKeys.has(key)) {
          report('error', `${label}: "${key}" is not a stat in the schema`, name);
          continue;
        }
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          report('error', `${label}: ${key} is not a finite number`, name);
          continue;
        }
        // Percentages are decimals: 0.09 is 9%. Typing 9 means 900%, which is the single
        // easiest mistake to make in this data and impossible to spot in the totals.
        if (percentKinds.has(schema.statByKey[key]?.kind) && Math.abs(value) > 1.5) {
          report('warn', `${label}: ${key} = ${value} means ${value * 100}% — decimals here `
            + '(0.09 is 9%)', name);
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

      const stats = {};
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
      for (const effect of set.effects ?? []) {
        if (!effect.id) report('error', 'an effect has no id', set.id);
        if (!effect.name) report('warn', `effect ${effect.id ?? '?'} has no friendly name`, set.id);
        checkConditions(effect.when, `effect ${effect.id ?? '?'}`, (level, message) =>
          report(level, message, set.id));
        checkStats(effect.stats, `effect ${effect.id ?? '?'}`, set.id);
        for (const tier of effect.tiers ?? []) {
          checkStats(tier.stats, `effect ${effect.id} tier`, set.id);
        }
      }
    }

    return findings;
  }

  // --- export ------------------------------------------------------------------------------

  // Mirrors the key order the Python generator emits, so a pasted-back file diffs cleanly
  // against a regenerated one instead of reordering every line.
  const LEADING_KEYS = ['name', 'filter', 'il', 'combined_rating'];
  const TRAILING_KEYS = ['tags', 'bonuses', 'maxCopies', 'allowedClass',
    'dynamicStat', 'dynamicMin', 'dynamicMax', 'excludes'];

  const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
  const key = (name) => (IDENT.test(name) ? name : JSON.stringify(name));

  /** Compact JS-literal serialiser: no quotes on plain keys, matching the generated files. */
  function literal(value) {
    if (value === null) return 'null';
    if (Array.isArray(value)) return `[${value.map(literal).join(', ')}]`;
    if (typeof value === 'object') {
      return `{${Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${key(k)}:${literal(v)}`).join(', ')}}`;
    }
    return JSON.stringify(value);
  }

  function orderedEntries(item, statKeys) {
    const used = new Set([...LEADING_KEYS, ...TRAILING_KEYS]);
    const stats = statKeys.filter((k) => item[k] !== undefined && !used.has(k));
    const rest = Object.keys(item)
      .filter((k) => !used.has(k) && !statKeys.includes(k));
    return [...LEADING_KEYS, ...stats, ...rest, ...TRAILING_KEYS]
      .filter((k) => item[k] !== undefined)
      .map((k) => [k, item[k]]);
  }

  const WRAP_AT = 96;

  function itemLiteral(item, statKeys) {
    const entries = orderedEntries(item, statKeys);
    const oneLine = `{${entries.map(([k, v]) => `${key(k)}:${literal(v)}`).join(', ')}}`;
    if (oneLine.length <= WRAP_AT) return oneLine;
    const body = entries.map(([k, v]) => `  ${key(k)}:${literal(v)}`).join(',\n');
    return `{\n${body}\n}`;
  }

  function toItemsFile(items, statKeys = window.NW_SCHEMA.statKeys) {
    const header = '// Exported from the in-app data editor.\n'
      + '// Same shape and key order as tools/migrate_bonuses.py emits, so this can replace\n'
      + '// data/db-items.js wholesale. Percentages are decimals (0.09 === 9%).\n\n';
    return `${header}window.NW_ITEMS = [\n`
      + `${items.map((item) => itemLiteral(item, statKeys)).join(',\n')}\n];\n`;
  }

  function toBonusesFile(bonusSets) {
    const header = '// Exported from the in-app data editor -- every bonus, one per group.\n'
      + '// A group with one member is private to that item; membership lives on the items\n'
      + '// (`bonuses: [...]`), never here.\n\n';
    const body = bonusSets.map((set) => {
      const effects = (set.effects ?? [])
        .map((effect) => `    ${literal(effect)}`).join(',\n');
      return `{\n  id:${literal(set.id)},\n  name:${literal(set.name ?? set.id)},\n`
        + `  effects:[\n${effects}\n  ]\n}`;
    }).join(',\n');
    return `${header}window.NW_BONUSES = [\n${body}\n];\n`;
  }

  return {
    emptyOverlay, isEmpty, normaliseOverlay, base, compose, makeDb,
    upsert, remove, revert, statusOf, inBase,
    validate,
    toItemsFile, toBonusesFile, literal,
  };
})();
