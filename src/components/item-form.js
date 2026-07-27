// Editing form for one item, including its inline bonuses.
//
// Works on a *draft* and saves explicitly. Live-editing the overlay would mean a rename fires
// once per keystroke, each one creating and tombstoning entries -- and the whole point of the
// overlay is that it is a clean record of what the user changed.
//
// Conditions get a structured editor for the leaf predicates, which is what essentially all of
// the data uses, plus a per-bonus JSON escape hatch for the rest (`tiers`, `variants`, `any`,
// `all`, `not`). Bonuses that already use those open in JSON mode automatically, so the editor
// can never silently flatten a structure it does not have a widget for.

window.NW = window.NW ?? {};
window.NW.components = window.NW.components ?? {};

window.NW.components.ItemForm = (() => {
  'use strict';

  // Leaf predicates the structured editor understands. Anything else forces JSON mode.
  const SIMPLE_CONDITIONS = ['toggle', 'role', 'class', 'combatType', 'location', 'damageType',
    'duration', 'pieces', 'equipped'];

  const csv = (list) => (list ?? []).join(', ');
  const fromCsv = (text) => String(text ?? '').split(',').map((s) => s.trim()).filter(Boolean);

  /**
   * Key-order-insensitive comparison. `toItem` rebuilds the object in the exporter's key
   * order, which almost never matches the order the source happens to have, so a plain
   * `JSON.stringify` comparison reports every untouched item as modified.
   */
  const canonical = (value) => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') {
      const out = {};
      for (const key of Object.keys(value).sort()) out[key] = canonical(value[key]);
      return out;
    }
    return value;
  };

  const sameItem = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

  const needsJson = (bonus) => Boolean(bonus.tiers || bonus.variants || bonus.stacking
    || bonus.maxStacks || bonus.excludes
    || Object.keys(bonus.when ?? {}).some((key) => !SIMPLE_CONDITIONS.includes(key)));

  /** `when` object -> editable rows. Only called when every key is a simple leaf. */
  function conditionRows(when) {
    return Object.entries(when ?? {}).map(([type, spec]) => {
      if (type === 'duration') {
        const range = typeof spec === 'number' ? { atLeast: spec } : (spec ?? {});
        return { type, atLeast: range.atLeast ?? null, below: range.below ?? null };
      }
      if (type === 'pieces') return { type, set: spec?.set ?? '', atLeast: spec?.atLeast ?? 1 };
      if (type === 'equipped') {
        return { type, tag: spec?.tag ?? '', item: spec?.item ?? '', atLeast: spec?.atLeast ?? 1 };
      }
      return { type, value: Array.isArray(spec) ? spec.join(', ') : String(spec ?? '') };
    });
  }

  function rowsToWhen(rows) {
    const when = {};
    for (const row of rows) {
      if (row.type === 'duration') {
        const range = {};
        if (row.atLeast != null && row.atLeast !== '') range.atLeast = Number(row.atLeast);
        if (row.below != null && row.below !== '') range.below = Number(row.below);
        if (Object.keys(range).length) when.duration = range;
      } else if (row.type === 'pieces') {
        if (row.set) when.pieces = { set: row.set, atLeast: Number(row.atLeast) || 1 };
      } else if (row.type === 'equipped') {
        if (row.tag) when.equipped = { tag: row.tag, atLeast: Number(row.atLeast) || 1 };
        else if (row.item) when.equipped = { item: row.item, atLeast: Number(row.atLeast) || 1 };
      } else {
        const values = fromCsv(row.value);
        if (values.length === 1) when[row.type] = values[0];
        else if (values.length > 1) when[row.type] = values;
      }
    }
    return when;
  }

  function bonusToDraft(bonus) {
    const json = needsJson(bonus);
    return {
      uid: `b${Math.random().toString(36).slice(2, 8)}`,
      id: bonus.id ?? '',
      mode: json ? 'json' : 'simple',
      json: JSON.stringify(bonus, null, 2),
      conditions: json ? [] : conditionRows(bonus.when),
      stats: json ? [] : Object.entries(bonus.stats ?? {}).map(([key, value]) => ({ key, value })),
    };
  }

  return {
    name: 'ItemForm',

    props: {
      /** The item being edited, or null for a brand-new one. */
      source: { type: Object, default: null },
      status: { type: String, default: 'base' },
      filters: { type: Array, default: () => [] },
      setIds: { type: Array, default: () => [] },
      tags: { type: Array, default: () => [] },
    },

    emits: ['save', 'delete', 'revert', 'dirty'],

    data() {
      return { draft: this.buildDraft(this.source), error: '', simpleConditions: SIMPLE_CONDITIONS };
    },

    computed: {
      schema: () => window.NW_SCHEMA,
      statOptions: () => window.NW_SCHEMA.stats,
      classes: () => window.NW_SCHEMA.context.classes,
      toggles: () => window.NW_SCHEMA.context.toggles,

      dirty() {
        let item;
        try {
          item = this.toItem();
        } catch {
          return true;      // a bonus has unparseable JSON: definitely not saved
        }
        // An untouched blank form is not a pending change.
        if (!this.source) return Boolean(item.name || item.filter || this.draft.stats.length
          || this.draft.bonuses.length);
        return !sameItem(item, this.source);
      },

      /**
       * Bonuses reached through a set live on the set, not the item. Without saying so, an
       * item like the Hunter Hood looks like it has no bonuses at all.
       */
      inheritedSets() {
        return fromCsv(this.draft.sets);
      },
    },

    watch: {
      source: {
        handler(value) {
          this.draft = this.buildDraft(value);
          this.error = '';
        },
      },
      dirty: {
        immediate: true,
        handler(value) { this.$emit('dirty', value); },
      },
    },

    methods: {
      statKind: (key) => window.NW.format.kindOf(key),
      isPercent(key) { return window.NW.format.isPercentKind(this.statKind(key)); },

      buildDraft(item) {
        const source = item ?? {};
        const statKeys = new Set(window.NW_SCHEMA.statKeys);
        return {
          name: source.name ?? '',
          filter: source.filter ?? '',
          maxCopies: source.maxCopies ?? null,
          allowedClass: [...(source.allowedClass ?? [])],
          tags: csv(source.tags),
          sets: csv(source.sets),
          dynamicStat: source.dynamicStat ?? '',
          dynamicMin: source.dynamicMin ?? null,
          dynamicMax: source.dynamicMax ?? null,
          stats: Object.keys(source)
            .filter((key) => statKeys.has(key))
            .map((key) => ({ key, value: source[key] })),
          bonuses: (source.bonuses ?? []).map(bonusToDraft),
        };
      },

      /** Draft -> the sparse item object the engine and the exporter expect. */
      toItem() {
        const draft = this.draft;
        const item = { name: draft.name.trim(), filter: draft.filter.trim() };

        for (const { key, value } of draft.stats) {
          if (!key) continue;
          const number = Number(value);
          if (value === '' || value == null || !Number.isFinite(number)) continue;
          item[key] = number;
        }

        const tags = fromCsv(draft.tags);
        const sets = fromCsv(draft.sets);
        if (tags.length) item.tags = tags;
        if (sets.length) item.sets = sets;
        if (draft.maxCopies) item.maxCopies = Number(draft.maxCopies);
        if (draft.allowedClass.length) item.allowedClass = [...draft.allowedClass];

        if (draft.dynamicStat) {
          item.dynamicStat = draft.dynamicStat;
          if (draft.dynamicMin != null && draft.dynamicMin !== '') {
            item.dynamicMin = Number(draft.dynamicMin);
          }
          if (draft.dynamicMax != null && draft.dynamicMax !== '') {
            item.dynamicMax = Number(draft.dynamicMax);
          }
        }

        const bonuses = [];
        for (const bonus of draft.bonuses) {
          if (bonus.mode === 'json') {
            // Invalid JSON is reported on save rather than silently dropping the bonus.
            const parsed = JSON.parse(bonus.json);
            bonuses.push(parsed);
            continue;
          }
          const out = { id: bonus.id.trim() };
          const when = rowsToWhen(bonus.conditions);
          if (Object.keys(when).length) out.when = when;
          const stats = {};
          for (const { key, value } of bonus.stats) {
            const number = Number(value);
            if (!key || value === '' || !Number.isFinite(number)) continue;
            stats[key] = number;
          }
          out.stats = stats;
          bonuses.push(out);
        }
        if (bonuses.length) item.bonuses = bonuses;

        return item;
      },

      save() {
        this.error = '';
        let item;
        try {
          item = this.toItem();
        } catch (error) {
          this.error = `A bonus has invalid JSON: ${error.message}`;
          return;
        }
        if (!item.name) { this.error = 'The item needs a name.'; return; }
        if (!item.filter) { this.error = 'The item needs a filter, or no slot can hold it.'; return; }
        this.$emit('save', { item, previousName: this.source?.name ?? null });
      },

      addStat() { this.draft.stats.push({ key: '', value: 0 }); },
      removeStat(index) { this.draft.stats.splice(index, 1); },

      addBonus() {
        this.draft.bonuses.push(bonusToDraft({ id: '', when: {}, stats: {} }));
      },
      removeBonus(index) { this.draft.bonuses.splice(index, 1); },

      toggleJson(bonus) {
        if (bonus.mode === 'simple') {
          const out = { id: bonus.id };
          const when = rowsToWhen(bonus.conditions);
          if (Object.keys(when).length) out.when = when;
          out.stats = Object.fromEntries(bonus.stats
            .filter((s) => s.key).map((s) => [s.key, Number(s.value) || 0]));
          bonus.json = JSON.stringify(out, null, 2);
          bonus.mode = 'json';
          return;
        }
        try {
          const parsed = JSON.parse(bonus.json);
          if (needsJson(parsed)) {
            this.error = 'That bonus uses tiers, variants or a nested condition, which the '
              + 'simple editor cannot represent. Keeping it as JSON.';
            return;
          }
          bonus.id = parsed.id ?? '';
          bonus.conditions = conditionRows(parsed.when);
          bonus.stats = Object.entries(parsed.stats ?? {}).map(([key, value]) => ({ key, value }));
          bonus.mode = 'simple';
          this.error = '';
        } catch (error) {
          this.error = `Cannot switch to the simple editor: ${error.message}`;
        }
      },

      addCondition(bonus) { bonus.conditions.push({ type: 'toggle', value: '' }); },
      removeCondition(bonus, index) { bonus.conditions.splice(index, 1); },

      changeConditionType(row) {
        // Each predicate carries different fields; reset to the new shape's defaults.
        const type = row.type;
        Object.keys(row).forEach((key) => { if (key !== 'type') delete row[key]; });
        if (type === 'duration') { row.atLeast = null; row.below = null; } else if (type === 'pieces') { row.set = ''; row.atLeast = 1; } else if (type === 'equipped') { row.tag = ''; row.item = ''; row.atLeast = 1; } else row.value = '';
      },

      addBonusStat(bonus) { bonus.stats.push({ key: '', value: 0 }); },
      removeBonusStat(bonus, index) { bonus.stats.splice(index, 1); },

      optionsFor(type) {
        const context = window.NW_SCHEMA.context;
        if (type === 'toggle') return context.toggles;
        if (type === 'role') return context.roles;
        if (type === 'class') return context.classes;
        if (type === 'combatType') return context.combatTypes;
        if (type === 'location') return context.locations;
        if (type === 'damageType') return context.damageTypes;
        return [];
      },
    },

    template: `
      <div class="form">
        <div class="form-bar">
          <strong>{{ draft.name || 'New item' }}</strong>
          <span v-if="status !== 'base'" class="badge" :class="'badge--' + status">{{ status }}</span>
          <span v-if="dirty" class="badge badge--near">unsaved</span>
          <span class="spacer"></span>
          <button type="button" class="btn btn--primary" :disabled="!dirty" @click="save">Save</button>
          <button v-if="status === 'edited'" type="button" class="btn"
                  @click="$emit('revert')">Revert to shipped</button>
          <button v-if="source" type="button" class="btn" @click="$emit('delete')">Delete</button>
        </div>

        <p v-if="error" class="drawer-error">{{ error }}</p>

        <div class="form-grid">
          <label class="field"><span class="field-label">Name</span>
            <input type="text" v-model="draft.name"></label>
          <label class="field"><span class="field-label">Filter (slot category)</span>
            <input type="text" v-model="draft.filter" list="nw-filters"></label>
          <label class="field"><span class="field-label">Max copies (0 = unlimited)</span>
            <input type="number" min="0" v-model.number="draft.maxCopies"></label>
        </div>

        <datalist id="nw-filters">
          <option v-for="f in filters" :key="f" :value="f"></option>
        </datalist>

        <div class="form-grid">
          <label class="field"><span class="field-label">Tags (comma separated)</span>
            <input type="text" v-model="draft.tags"></label>
          <label class="field"><span class="field-label">Sets (comma separated)</span>
            <input type="text" v-model="draft.sets" list="nw-sets"></label>
        </div>
        <datalist id="nw-sets">
          <option v-for="s in setIds" :key="s" :value="s"></option>
        </datalist>

        <div class="form-section">Restricted to classes</div>
        <div class="drawer-grid">
          <label v-for="cls in classes" :key="cls" class="check">
            <input type="checkbox" :value="cls" v-model="draft.allowedClass">
            <span>{{ cls }}</span>
          </label>
        </div>

        <div class="form-section">
          Stats
          <button type="button" class="link" @click="addStat">+ add</button>
        </div>
        <div v-for="(stat, index) in draft.stats" :key="index" class="stat-row">
          <select v-model="stat.key">
            <option value="">— pick a stat —</option>
            <option v-for="s in statOptions" :key="s.key" :value="s.key">
              {{ s.label }} ({{ s.key }})
            </option>
          </select>
          <input type="number" step="any" v-model.number="stat.value">
          <span class="hint">{{ stat.key && isPercent(stat.key) ? '0.09 = 9%' : '' }}</span>
          <button type="button" class="link" @click="removeStat(index)">remove</button>
        </div>

        <div class="form-section">Dynamic modification (user types the value)</div>
        <div class="form-grid">
          <label class="field"><span class="field-label">Stat</span>
            <select v-model="draft.dynamicStat">
              <option value="">— none —</option>
              <option v-for="s in statOptions" :key="s.key" :value="s.key">{{ s.label }}</option>
            </select></label>
          <label class="field"><span class="field-label">Min</span>
            <input type="number" v-model.number="draft.dynamicMin" :disabled="!draft.dynamicStat"></label>
          <label class="field"><span class="field-label">Max</span>
            <input type="number" v-model.number="draft.dynamicMax" :disabled="!draft.dynamicStat"></label>
        </div>

        <div class="form-section">
          Bonuses on this item
          <button type="button" class="link" @click="addBonus">+ add</button>
        </div>

        <p v-if="inheritedSets.length" class="hint">
          This item also inherits the bonuses of
          <strong>{{ inheritedSets.join(', ') }}</strong> — those live on the set, and are
          edited under <em>Bonus sets</em>.
        </p>
        <p v-else-if="!draft.bonuses.length" class="hint">None. This item contributes only the
          stats above.</p>

        <div v-for="(bonus, bIndex) in draft.bonuses" :key="bonus.uid" class="bonus-edit">
          <div class="bonus-edit-head">
            <input class="bonus-id" type="text" v-model="bonus.id" placeholder="bonus id">
            <button type="button" class="link" @click="toggleJson(bonus)">
              {{ bonus.mode === 'json' ? 'simple editor' : 'edit as JSON' }}
            </button>
            <button type="button" class="link" @click="removeBonus(bIndex)">remove</button>
          </div>

          <textarea v-if="bonus.mode === 'json'" class="code" rows="8" v-model="bonus.json"></textarea>

          <template v-else>
            <div class="sub-section">
              Conditions
              <button type="button" class="link" @click="addCondition(bonus)">+ add</button>
              <span v-if="!bonus.conditions.length" class="hint">always active</span>
            </div>
            <div v-for="(row, cIndex) in bonus.conditions" :key="cIndex" class="cond-row">
              <select v-model="row.type" @change="changeConditionType(row)">
                <option v-for="t in simpleConditions" :key="t" :value="t">{{ t }}</option>
              </select>

              <template v-if="row.type === 'duration'">
                <input type="number" v-model.number="row.atLeast" placeholder="at least (s)">
                <input type="number" v-model.number="row.below" placeholder="below (s)">
              </template>
              <template v-else-if="row.type === 'pieces'">
                <input type="text" v-model="row.set" placeholder="set id" list="nw-sets">
                <input type="number" v-model.number="row.atLeast" placeholder="pieces">
              </template>
              <template v-else-if="row.type === 'equipped'">
                <input type="text" v-model="row.tag" placeholder="tag" list="nw-tags">
                <input type="text" v-model="row.item" placeholder="or exact item name">
                <input type="number" v-model.number="row.atLeast" placeholder="count">
              </template>
              <template v-else>
                <select v-if="optionsFor(row.type).length" v-model="row.value">
                  <option v-for="o in optionsFor(row.type)" :key="o" :value="o">{{ o }}</option>
                </select>
                <input v-else type="text" v-model="row.value">
              </template>

              <button type="button" class="link" @click="removeCondition(bonus, cIndex)">remove</button>
            </div>

            <div class="sub-section">
              Grants
              <button type="button" class="link" @click="addBonusStat(bonus)">+ add</button>
            </div>
            <div v-for="(stat, sIndex) in bonus.stats" :key="sIndex" class="stat-row">
              <select v-model="stat.key">
                <option value="">— pick a stat —</option>
                <option v-for="s in statOptions" :key="s.key" :value="s.key">
                  {{ s.label }} ({{ s.key }})
                </option>
              </select>
              <input type="number" step="any" v-model.number="stat.value">
              <span class="hint">{{ stat.key && isPercent(stat.key) ? '0.09 = 9%' : '' }}</span>
              <button type="button" class="link" @click="removeBonusStat(bonus, sIndex)">remove</button>
            </div>
          </template>
        </div>

        <datalist id="nw-tags">
          <option v-for="t in tags" :key="t" :value="t"></option>
        </datalist>
      </div>
    `,
  };
})();
