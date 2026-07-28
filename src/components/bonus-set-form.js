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

  // Same draft-level undo as item-form.js -- see its own comment for why a debounced deep watch
  // instead of a snapshot-per-field-method the way the build form does it.
  const SNAPSHOT_DEBOUNCE_MS = 700;
  const UNDO_LIMIT = 50;

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
      /** Same stash/restore as item-form.js's own `initialDraft` -- see there for why. */
      initialDraft: { type: Object, default: null },
    },

    emits: ['save', 'delete', 'revert', 'dirty'],

    data() {
      const draft = this.initialDraft
        ? JSON.parse(JSON.stringify(this.initialDraft))
        : this.buildDraft(this.source);
      return {
        draft,
        error: '',
        draftHistory: { past: [], future: [] },
        lastSnapshotJson: JSON.stringify(draft),
        snapshotTimer: null,
        confirmRevert: false,
        confirmRevertTimer: null,
      };
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

      canUndoDraft() { return this.draftHistory.past.length > 0; },
      canRedoDraft() { return this.draftHistory.future.length > 0; },
    },

    watch: {
      source: {
        handler(value) {
          this.draft = this.buildDraft(value);
          this.error = '';
          this.resetDraftHistory();
        },
      },
      dirty: {
        immediate: true,
        handler(value) { this.$emit('dirty', value); },
      },
      draft: {
        deep: true,
        handler() { this.scheduleSnapshot(); },
      },
    },

    unmounted() {
      window.clearTimeout(this.snapshotTimer);
      window.clearTimeout(this.confirmRevertTimer);
    },

    methods: {
      // --- draft undo -------------------------------------------------------------------------

      resetDraftHistory() {
        window.clearTimeout(this.snapshotTimer);
        this.draftHistory = { past: [], future: [] };
        this.lastSnapshotJson = JSON.stringify(this.draft);
      },

      scheduleSnapshot() {
        window.clearTimeout(this.snapshotTimer);
        this.snapshotTimer = window.setTimeout(() => this.commitSnapshot(), SNAPSHOT_DEBOUNCE_MS);
      },

      commitSnapshot() {
        window.clearTimeout(this.snapshotTimer);
        const current = JSON.stringify(this.draft);
        if (current === this.lastSnapshotJson) return;
        this.draftHistory.past.push(this.lastSnapshotJson);
        if (this.draftHistory.past.length > UNDO_LIMIT) this.draftHistory.past.shift();
        this.draftHistory.future.length = 0;
        this.lastSnapshotJson = current;
      },

      undoDraft() {
        this.commitSnapshot();
        if (!this.draftHistory.past.length) return false;
        this.draftHistory.future.push(this.lastSnapshotJson);
        this.lastSnapshotJson = this.draftHistory.past.pop();
        this.draft = JSON.parse(this.lastSnapshotJson);
        return true;
      },

      redoDraft() {
        if (!this.draftHistory.future.length) return false;
        this.draftHistory.past.push(this.lastSnapshotJson);
        this.lastSnapshotJson = this.draftHistory.future.pop();
        this.draft = JSON.parse(this.lastSnapshotJson);
        return true;
      },

      /** Same "discard the unsaved draft" as item-form.js's own `revertDraft` -- see there. */
      revertDraft() {
        if (!this.confirmRevert) {
          this.confirmRevert = true;
          this.confirmRevertTimer = window.setTimeout(() => { this.confirmRevert = false; }, 4000);
          return;
        }
        window.clearTimeout(this.confirmRevertTimer);
        this.confirmRevert = false;
        this.draft = this.buildDraft(this.source);
        this.error = '';
        this.resetDraftHistory();
      },

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
          <button type="button" class="btn btn--history" :disabled="!canUndoDraft"
                  title="Undo edit (Ctrl+Z)" @click="undoDraft">↶ Undo</button>
          <button type="button" class="btn btn--history" :disabled="!canRedoDraft"
                  title="Redo edit (Ctrl+Shift+Z)" @click="redoDraft">↷ Redo</button>
          <button type="button" class="btn btn--primary" :disabled="!dirty" @click="save">Save bonus set</button>
          <button type="button" class="btn" :class="{ 'is-danger': confirmRevert }"
                  :disabled="!dirty" @click="revertDraft">
            {{ confirmRevert ? 'Really revert?' : 'Revert' }}
          </button>
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
