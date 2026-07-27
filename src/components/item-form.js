// Editing form for one item: its fields, and the bonus groups it belongs to.
//
// Works on a *draft* and saves explicitly. Live-editing the overlay would mean a rename fires
// once per keystroke, each one creating and tombstoning entries -- and the whole point of the
// overlay is that it is a clean record of what the user changed.
//
// Bonus editing itself lives entirely in `BonusGroups` below -- there is no separate "this
// item's own bonuses" concept here any more; a bonus only this item grants is just a group
// with one member.

window.NW = window.NW ?? {};
window.NW.components = window.NW.components ?? {};

window.NW.components.ItemForm = (() => {
  'use strict';

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

  return {
    name: 'ItemForm',

    components: {
      BonusGroups: window.NW.components.BonusGroups,
      TokenInput: window.NW.components.TokenInput,
      PercentInput: window.NW.components.PercentInput,
      ComboBox: window.NW.components.ComboBox,
      IconButton: window.NW.components.IconButton,
    },

    props: {
      /** The item being edited, or null for a brand-new one. */
      source: { type: Object, default: null },
      status: { type: String, default: 'base' },
      db: { type: Object, required: true },
      filters: { type: Array, default: () => [] },
      setIds: { type: Array, default: () => [] },
      tags: { type: Array, default: () => [] },
      bonusIds: { type: Array, default: () => [] },
    },

    emits: ['save', 'delete', 'revert', 'dirty', 'save-set', 'delete-set'],

    data() {
      return { draft: this.buildDraft(this.source), error: '' };
    },

    computed: {
      statOptions: () => window.NW_SCHEMA.stats,
      classes: () => window.NW_SCHEMA.context.classes,

      statComboOptions() {
        return this.statOptions.map((s) => ({ value: s.key, label: `${s.label} (${s.key})` }));
      },

      dynamicStatOptions() {
        return this.statOptions.map((s) => ({ value: s.key, label: s.label }));
      },

      dirty() {
        const item = this.toItem();
        // An untouched blank form is not a pending change.
        if (!this.source) return Boolean(item.name || item.filter || this.draft.stats.length);
        return !sameItem(item, this.source);
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
      isPercent: (key) => window.NW.format.isPercentKind(window.NW.format.kindOf(key)),

      buildDraft(item) {
        const source = item ?? {};
        const statKeys = new Set(window.NW_SCHEMA.statKeys);
        return {
          name: source.name ?? '',
          filter: source.filter ?? '',
          maxCopies: source.maxCopies ?? null,
          allowedClass: [...(source.allowedClass ?? [])],
          tags: [...(source.tags ?? [])],
          bonuses: [...(source.bonuses ?? [])],
          excludes: [...(source.excludes ?? [])],
          dynamicStat: source.dynamicStat ?? '',
          dynamicMin: source.dynamicMin ?? null,
          dynamicMax: source.dynamicMax ?? null,
          stats: Object.keys(source)
            .filter((key) => statKeys.has(key))
            .map((key) => ({ key, value: source[key] })),
        };
      },

      /** Draft -> the sparse item object the engine and the exporter expect. */
      toItem() {
        const local = this.draft;
        const item = { name: local.name.trim(), filter: local.filter.trim() };

        for (const { key, value } of local.stats) {
          if (!key) continue;
          const number = Number(value);
          if (value === '' || value == null || !Number.isFinite(number)) continue;
          item[key] = number;
        }

        if (local.tags.length) item.tags = [...local.tags];
        if (local.bonuses.length) item.bonuses = [...local.bonuses];
        if (local.excludes.length) item.excludes = [...local.excludes];
        if (local.maxCopies) item.maxCopies = Number(local.maxCopies);
        if (local.allowedClass.length) item.allowedClass = [...local.allowedClass];

        if (local.dynamicStat) {
          item.dynamicStat = local.dynamicStat;
          if (local.dynamicMin != null && local.dynamicMin !== '') {
            item.dynamicMin = Number(local.dynamicMin);
          }
          if (local.dynamicMax != null && local.dynamicMax !== '') {
            item.dynamicMax = Number(local.dynamicMax);
          }
        }

        return item;
      },

      save() {
        this.error = '';
        const item = this.toItem();
        if (!item.name) { this.error = 'The item needs a name.'; return; }
        if (!item.filter) { this.error = 'The item needs a filter, or no slot can hold it.'; return; }
        this.$emit('save', { item, previousName: this.source?.name ?? null });
      },

      addStat() { this.draft.stats.push({ key: '', value: 0 }); },
      removeStat(index) { this.draft.stats.splice(index, 1); },

      /**
       * A bonus created or attached from the Bonuses section is attached to this item straight
       * away. Assigns a new array rather than pushing: `BonusGroups` watches `setIds`, and an
       * in-place push keeps the same reference, so the watcher would not fire and the new
       * group would render with no draft behind it.
       */
      attachSet(id) {
        if (this.draft.bonuses.includes(id)) return;
        this.draft.bonuses = [...this.draft.bonuses, id];
      },

      /** A card with no saved definition has nothing in the catalogue to remove -- just drop
       * the id from this item's own list. */
      detachSet(id) {
        this.draft.bonuses = this.draft.bonuses.filter((setId) => setId !== id);
      },

      /** Keep this item pointed at a bonus group that was just renamed (same array-replace
       * trick as `attachSet`, so `BonusGroups`'s `setIds` watcher fires). */
      renameSet({ oldId, newId }) {
        this.draft.bonuses = this.draft.bonuses.map((id) => (id === oldId ? newId : id));
      },
    },

    template: `
      <div class="form">
        <div class="form-bar">
          <strong>{{ draft.name || 'New item' }}</strong>
          <span v-if="status !== 'base'" class="badge" :class="'badge--' + status">{{ status }}</span>
          <span v-if="dirty" class="badge badge--near">unsaved</span>
          <span class="spacer"></span>
          <button type="button" class="btn btn--primary" :disabled="!dirty" @click="save">Save item</button>
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
        <datalist id="nw-tags">
          <option v-for="t in tags" :key="t" :value="t"></option>
        </datalist>

        <div class="form-grid form-grid--tokens">
          <div class="field"><span class="field-label">Tags</span>
            <TokenInput v-model="draft.tags" :options="tags" placeholder="Add a tag…" /></div>
        </div>

        <div class="form-section">Restricted to classes</div>
        <div class="drawer-grid">
          <label v-for="cls in classes" :key="cls" class="check">
            <input type="checkbox" :value="cls" v-model="draft.allowedClass">
            <span>{{ cls }}</span>
          </label>
        </div>

        <div class="form-section">Stats</div>
        <div v-for="(stat, index) in draft.stats" :key="index" class="stat-row">
          <IconButton icon="plus" title="Add stat" @click="addStat" />
          <IconButton icon="trash" title="Remove stat" @click="removeStat(index)" />
          <ComboBox class="combo--stat" :model-value="stat.key" :options="statComboOptions"
                    placeholder="— pick a stat —" @update:model-value="v => stat.key = v" />
          <PercentInput v-if="isPercent(stat.key)" v-model="stat.value" />
          <input v-else type="number" step="any" v-model.number="stat.value">
        </div>
        <div v-if="!draft.stats.length" class="stat-row">
          <IconButton icon="plus" title="Add stat" @click="addStat" />
        </div>

        <div class="form-section">Dynamic modification (user types the value)</div>
        <div class="form-grid">
          <label class="field"><span class="field-label">Stat</span>
            <ComboBox :model-value="draft.dynamicStat" :options="dynamicStatOptions"
                      placeholder="— none —" @update:model-value="v => draft.dynamicStat = v" /></label>
          <label class="field"><span class="field-label">Min</span>
            <input type="number" v-model.number="draft.dynamicMin" :disabled="!draft.dynamicStat"></label>
          <label class="field"><span class="field-label">Max</span>
            <input type="number" v-model.number="draft.dynamicMax" :disabled="!draft.dynamicStat"></label>
        </div>

        <div class="form-section">Equipping this item suppresses</div>
        <TokenInput v-model="draft.excludes" :options="bonusIds"
                    placeholder="bonus id this item overrides…" />
        <p class="hint">Item-level override: those bonuses go inactive whenever this item is
          equipped, whatever grants them.</p>

        <BonusGroups
          :set-ids="draft.bonuses"
          :item-name="draft.name"
          :db="db"
          :all-set-ids="setIds"
          :tags="tags"
          :bonus-ids="bonusIds"
          @save-set="$emit('save-set', $event)"
          @delete-set="$emit('delete-set', $event)"
          @detach-set="detachSet"
          @rename-set="renameSet"
          @attach-set="attachSet" />
      </div>
    `,
  };
})();
