// Editing form for one bonus set, browsed and edited on its own -- not from inside the item
// that happens to grant it. Same effect editor as `BonusGroups`'s per-card view (`BonusRows`),
// but full-page like `ItemForm` and independent of any item: a bonus set here may be granted by
// zero, one, or many items, and this form does not care which.

window.NW = window.NW ?? {};
window.NW.components = window.NW.components ?? {};

window.NW.components.BonusSetForm = (() => {
  'use strict';

  const draft = () => window.NW.bonusDraft;

  const canonical = (value) => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') {
      const out = {};
      for (const key of Object.keys(value).sort()) out[key] = canonical(value[key]);
      return out;
    }
    return value;
  };

  const sameSet = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

  const slugify = (text) => String(text).toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

  return {
    name: 'BonusSetForm',

    components: {
      BonusRows: window.NW.components.BonusRows,
      IconButton: window.NW.components.IconButton,
      ComboBox: window.NW.components.ComboBox,
      TokenInput: window.NW.components.TokenInput,
    },

    props: {
      /** The bonus set being edited, or null for a brand-new one. */
      source: { type: Object, default: null },
      status: { type: String, default: 'base' },
      db: { type: Object, required: true },
      /** Every bonus set id -- both for the "tiered by set pieces" combo and the id-collision check. */
      setIds: { type: Array, default: () => [] },
      tags: { type: Array, default: () => [] },
      bonusIds: { type: Array, default: () => [] },
    },

    emits: ['save', 'delete', 'revert', 'dirty'],

    data() {
      return { draft: this.buildDraft(this.source), error: '' };
    },

    computed: {
      members() {
        if (!this.source) return [];
        return this.db.setMembers.get(this.source.id) ?? [];
      },

      stackingOptions: () => ([
        { value: '', label: 'once, however many sources' },
        { value: 'perSource', label: 'once per contributing slot' },
      ]),

      /** Best-effort conversion for the dirty check -- a row mid-edit as invalid JSON just
       * reads as "changed" rather than throwing here too. */
      asSet() {
        try {
          return draft().toSet(this.draft);
        } catch {
          return null;
        }
      },

      dirty() {
        if (!this.source) {
          return Boolean(this.draft.name || this.draft.id || this.draft.grants.length);
        }
        const set = this.asSet;
        return !set || !sameSet(set, this.source);
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
      buildDraft(set) {
        const source = set ?? {};
        return {
          id: source.id ?? '',
          name: source.name ?? '',
          grants: (source.grants ?? []).map((grant) => draft().toDraft(grant)),
          stacking: source.stacking ?? '',
          maxStacks: source.maxStacks ?? null,
          excludes: [...(source.excludes ?? [])],
        };
      },

      /** Same convention as the item form and the per-card group editor: fill the id from the
       * current name. */
      generateId() { this.draft.id = slugify(this.draft.name) || this.draft.id; },

      addGrant() {
        this.draft.grants.push(draft().toDraft({ when: {}, stats: {} }));
      },

      save() {
        this.error = '';
        const id = this.draft.id.trim();
        if (!id) { this.error = 'The bonus set needs an id.'; return; }
        if (id !== this.source?.id && this.setIds.includes(id)) {
          this.error = `“${id}” is already used by another bonus set.`;
          return;
        }
        let set;
        try {
          set = draft().toSet(this.draft);
        } catch (error) {
          this.error = `A grant has invalid JSON: ${error.message}`;
          return;
        }
        this.$emit('save', { id, previousId: this.source?.id ?? null, set });
      },
    },

    template: `
      <div class="form">
        <div class="form-bar">
          <strong>{{ draft.name || draft.id || 'New bonus set' }}</strong>
          <span v-if="status !== 'base'" class="badge" :class="'badge--' + status">{{ status }}</span>
          <span v-if="dirty" class="badge badge--near">unsaved</span>
          <span class="spacer"></span>
          <button type="button" class="btn btn--primary" :disabled="!dirty" @click="save">Save bonus set</button>
          <button v-if="status === 'edited'" type="button" class="btn"
                  @click="$emit('revert')">Revert to shipped</button>
          <button v-if="source" type="button" class="btn" @click="$emit('delete')">Delete</button>
        </div>

        <p v-if="error" class="drawer-error">{{ error }}</p>

        <div class="form-grid">
          <label class="field"><span class="field-label">Group name</span>
            <input type="text" v-model="draft.name"></label>
          <label class="field"><span class="field-label">Group id</span>
            <span class="setcard-id-row">
              <input class="setcard-id" type="text" v-model="draft.id">
              <IconButton icon="wand-sparkles" title="Generate id from name" @click="generateId" />
            </span>
          </label>
        </div>

        <p class="hint">
          <template v-if="members.length">
            Granted by <strong>{{ members.length }}</strong> item(s) — {{ members.join(', ') }}.
          </template>
          <template v-else>
            Not granted by any item yet -- attach this id from an item's Bonuses section.
          </template>
        </p>

        <div class="sub-section">Stacking</div>
        <div class="cond-row">
          <ComboBox class="combo--stacking" :model-value="draft.stacking" :options="stackingOptions"
                    @update:model-value="v => draft.stacking = v" />
          <template v-if="draft.stacking === 'perSource'">
            <label class="field"><span class="field-label">Max stacks</span>
              <input type="number" min="0" class="tier-pieces" v-model.number="draft.maxStacks"></label>
            <span class="hint">maximum stacks (blank = no limit)</span>
          </template>
        </div>

        <div class="sub-section">Suppresses these bonuses</div>
        <TokenInput v-model="draft.excludes" :options="bonusIds"
                    placeholder="bonus id to suppress…" />

        <div class="form-section">
          Grants
          <IconButton icon="circle-plus" title="Add grant" @click="addGrant" />
          <span v-if="!draft.grants.length" class="hint">none yet</span>
        </div>

        <BonusRows
          :rows="draft.grants"
          :set-ids="setIds"
          :tags="tags"
          @error="error = $event" />
      </div>
    `,
  };
})();
