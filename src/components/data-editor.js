// The data editor: browse/add/edit/remove items and shared bonus sets, lint the result, and
// export it back to the `data/*.js` files.
//
// The editor never writes to disk -- it cannot, this is a static client app. It edits the
// workspace *overlay* (see src/catalog.js) and hands you the file contents to paste back.
// The same overlay shape is what per-build custom gear will use later, so nothing here is
// throwaway: only the layer the overlay lives in changes.

window.NW = window.NW ?? {};
window.NW.components = window.NW.components ?? {};

window.NW.components.DataEditor = (() => {
  'use strict';

  const catalog = () => window.NW.catalog;

  return {
    name: 'DataEditor',

    components: { ItemForm: window.NW.components.ItemForm },

    props: {
      db: { type: Object, required: true },
      overlay: { type: Object, required: true },
    },

    emits: ['update-overlay', 'close'],

    data: () => ({
      mode: 'items',            // 'items' | 'sets'
      query: '',
      statusFilter: 'all',      // all | changed | added | edited | removed
      selectedName: null,
      selectedSetId: null,
      setJson: '',
      setError: '',
      showExport: false,
      exportTab: 'items',       // items | bonuses | overlay
      formDirty: false,
      notice: '',
    }),

    computed: {
      // Removed entries are gone from `db`, so the list is built from the composed catalogue
      // plus the overlay's tombstones -- otherwise a deletion would vanish with no way back.
      rows() {
        const rows = this.db.items.map((item) => ({
          name: item.name,
          filter: item.filter,
          item,
          status: catalog().statusOf(this.overlay, 'items', item.name),
        }));
        for (const [name, value] of Object.entries(this.overlay.items ?? {})) {
          if (value === null) rows.push({ name, filter: '—', item: null, status: 'removed' });
        }
        return rows.sort((a, b) => a.name.localeCompare(b.name));
      },

      filtered() {
        const query = this.query.trim().toLowerCase();
        return this.rows.filter((row) => {
          if (this.statusFilter === 'changed' && row.status === 'base') return false;
          if (['added', 'edited', 'removed'].includes(this.statusFilter)
            && row.status !== this.statusFilter) return false;
          if (!query) return true;
          return row.name.toLowerCase().includes(query)
            || (row.filter ?? '').toLowerCase().includes(query);
        });
      },

      selected() {
        if (this.selectedName == null) return null;
        return this.db.get(this.selectedName);
      },

      selectedStatus() {
        return this.selectedName == null
          ? 'base'
          : catalog().statusOf(this.overlay, 'items', this.selectedName);
      },

      filters() {
        return [...new Set(this.db.items.map((item) => item.filter).filter(Boolean))].sort();
      },

      setIds() {
        return [...new Set(this.db.bonusSets.map((set) => set.id))].sort();
      },

      tagList() {
        return [...this.db.itemsByTag.keys()].sort();
      },

      changedCount() {
        return Object.keys(this.overlay.items ?? {}).length
          + Object.keys(this.overlay.bonusSets ?? {}).length;
      },

      findings() {
        return catalog().validate(this.db.items, this.db.bonusSets);
      },

      errorCount() { return this.findings.filter((f) => f.level === 'error').length; },
      warnCount() { return this.findings.filter((f) => f.level === 'warn').length; },

      exportText() {
        if (this.exportTab === 'items') return catalog().toItemsFile(this.db.items);
        if (this.exportTab === 'bonuses') return catalog().toBonusesFile(this.db.bonusSets);
        return JSON.stringify(this.overlay, null, 2);
      },

      exportName() {
        if (this.exportTab === 'items') return 'db-items.js';
        if (this.exportTab === 'bonuses') return 'db-bonuses.js';
        return 'catalog-overlay.json';
      },
    },

    methods: {
      select(row) {
        if (row.status === 'removed') return;
        this.selectedName = row.name;
      },

      newItem() {
        this.selectedName = null;
        // Remounts ItemForm with an empty draft even if it was already showing a new item.
        this.$refs.form?.$forceUpdate?.();
      },

      onSave({ item, previousName }) {
        const next = catalog().upsert(this.overlay, 'items', item.name, item, previousName);
        this.$emit('update-overlay', next);
        this.selectedName = item.name;
        this.notice = `Saved “${item.name}”`;
      },

      onDelete() {
        const name = this.selectedName;
        this.$emit('update-overlay', catalog().remove(this.overlay, 'items', name));
        this.selectedName = null;
        this.notice = `Removed “${name}”`;
      },

      onRevert() {
        const name = this.selectedName;
        this.$emit('update-overlay', catalog().revert(this.overlay, 'items', name));
        this.notice = `Reverted “${name}” to the shipped version`;
      },

      restore(name) {
        this.$emit('update-overlay', catalog().revert(this.overlay, 'items', name));
        this.notice = `Restored “${name}”`;
      },

      resetAll() {
        this.$emit('update-overlay', catalog().emptyOverlay());
        this.selectedName = null;
        this.notice = 'Discarded every change — back to the shipped data';
      },

      // --- bonus sets -----------------------------------------------------------------------

      selectSet(set) {
        this.selectedSetId = set.id;
        this.setJson = JSON.stringify(set, null, 2);
        this.setError = '';
      },

      newSet() {
        this.selectedSetId = null;
        this.setJson = JSON.stringify(
          { id: 'my-set', name: 'My Set', effects: [{ id: 'my-set-bonus', tiers: [] }] }, null, 2,
        );
        this.setError = '';
      },

      saveSet() {
        this.setError = '';
        let parsed;
        try {
          parsed = JSON.parse(this.setJson);
        } catch (error) {
          this.setError = `Invalid JSON: ${error.message}`;
          return;
        }
        if (!parsed.id) { this.setError = 'A bonus set needs an id.'; return; }
        this.$emit('update-overlay',
          catalog().upsert(this.overlay, 'bonusSets', parsed.id, parsed, this.selectedSetId));
        this.selectedSetId = parsed.id;
        this.notice = `Saved set “${parsed.id}”`;
      },

      deleteSet() {
        if (!this.selectedSetId) return;
        this.$emit('update-overlay',
          catalog().remove(this.overlay, 'bonusSets', this.selectedSetId));
        this.notice = `Removed set “${this.selectedSetId}”`;
        this.selectedSetId = null;
        this.setJson = '';
      },

      // --- export ---------------------------------------------------------------------------

      async copyExport() {
        try {
          await navigator.clipboard.writeText(this.exportText);
          this.notice = `Copied ${this.exportName} to the clipboard`;
        } catch {
          this.notice = 'Clipboard blocked — select the text and copy it manually';
        }
      },

      downloadExport() {
        const blob = new Blob([this.exportText], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = this.exportName;
        link.click();
        URL.revokeObjectURL(url);
      },

      async importOverlay(event) {
        const file = event.target.files?.[0];
        if (!file) return;
        try {
          const parsed = JSON.parse(await file.text());
          this.$emit('update-overlay', catalog().normaliseOverlay(parsed));
          this.notice = 'Overlay imported';
        } catch (error) {
          this.notice = `Could not read that overlay: ${error.message}`;
        }
        event.target.value = '';
      },

      selectAllText(event) { event.target.select(); },
    },

    template: `
      <div class="editor">
        <div class="editor-bar">
          <div class="tabs">
            <button type="button" class="tab" :class="{ 'is-on': mode === 'items' }"
                    @click="mode = 'items'">Items <span class="tab-count">{{ db.items.length }}</span></button>
            <button type="button" class="tab" :class="{ 'is-on': mode === 'sets' }"
                    @click="mode = 'sets'">Bonus sets <span class="tab-count">{{ db.bonusSets.length }}</span></button>
          </div>

          <span class="spacer"></span>

          <span v-if="changedCount" class="badge badge--edited">{{ changedCount }} changed</span>
          <span v-if="errorCount" class="badge badge--error">{{ errorCount }} error(s)</span>
          <span v-if="warnCount" class="badge badge--warn">{{ warnCount }} warning(s)</span>

          <button type="button" class="btn" :class="{ 'is-on': showExport }"
                  @click="showExport = !showExport">Export…</button>
          <label class="btn">Import overlay
            <input type="file" accept=".json" hidden @change="importOverlay"></label>
          <button type="button" class="btn" :disabled="!changedCount" @click="resetAll">
            Discard changes
          </button>
          <button type="button" class="btn" @click="$emit('close')">← Back to builder</button>
        </div>

        <p v-if="notice" class="notice" @click="notice = ''">{{ notice }}</p>

        <div v-if="showExport" class="drawer">
          <div class="drawer-row">
            <div class="tabs">
              <button type="button" class="tab" :class="{ 'is-on': exportTab === 'items' }"
                      @click="exportTab = 'items'">db-items.js</button>
              <button type="button" class="tab" :class="{ 'is-on': exportTab === 'bonuses' }"
                      @click="exportTab = 'bonuses'">db-bonuses.js</button>
              <button type="button" class="tab" :class="{ 'is-on': exportTab === 'overlay' }"
                      @click="exportTab = 'overlay'">overlay only</button>
            </div>
            <span class="spacer"></span>
            <button type="button" class="btn" @click="copyExport">Copy</button>
            <button type="button" class="btn" @click="downloadExport">Download {{ exportName }}</button>
          </div>
          <textarea class="code" rows="12" readonly :value="exportText" @focus="selectAllText"></textarea>
          <p class="hint">
            <template v-if="exportTab === 'overlay'">
              Just your changes. Small, reviewable, and the same shape custom gear will use when
              it is stored with a build.
            </template>
            <template v-else>
              The whole file, in the key order tools/migrate_bonuses.py emits — replace
              data/{{ exportName }} with this.
            </template>
          </p>
        </div>

        <div v-if="findings.length" class="drawer drawer--findings">
          <div class="drawer-head">Validation</div>
          <ul class="findings">
            <li v-for="(finding, i) in findings.slice(0, 40)" :key="i" :class="finding.level">
              <span class="finding-level">{{ finding.level }}</span>
              <button v-if="finding.name" type="button" class="link"
                      @click="mode = 'items'; selectedName = finding.name">{{ finding.name }}</button>
              <span>{{ finding.message }}</span>
            </li>
          </ul>
          <p v-if="findings.length > 40" class="hint">…and {{ findings.length - 40 }} more.</p>
        </div>

        <!-- items -->
        <div v-if="mode === 'items'" class="editor-body">
          <div class="editor-list">
            <div class="editor-list-head">
              <input type="search" v-model="query" placeholder="Filter items…">
              <select v-model="statusFilter">
                <option value="all">all</option>
                <option value="changed">changed only</option>
                <option value="added">added</option>
                <option value="edited">edited</option>
                <option value="removed">removed</option>
              </select>
              <button type="button" class="btn btn--primary" @click="newItem">+ New item</button>
            </div>
            <div class="editor-list-body">
              <div v-for="row in filtered" :key="row.name" class="editor-row"
                   :class="{ 'is-on': row.name === selectedName }" @click="select(row)">
                <span class="editor-row-name">{{ row.name }}</span>
                <span v-if="row.status !== 'base'" class="badge" :class="'badge--' + row.status">
                  {{ row.status }}
                </span>
                <button v-if="row.status === 'removed'" type="button" class="link"
                        @click.stop="restore(row.name)">restore</button>
                <span v-else class="editor-row-filter">{{ row.filter }}</span>
              </div>
              <p v-if="!filtered.length" class="dim" style="padding:8px">Nothing matches.</p>
            </div>
          </div>

          <div class="editor-form">
            <ItemForm
              ref="form"
              :key="selectedName ?? '__new__'"
              :source="selected"
              :status="selectedStatus"
              :filters="filters"
              :set-ids="setIds"
              :tags="tagList"
              @save="onSave"
              @delete="onDelete"
              @revert="onRevert"
              @dirty="formDirty = $event" />
          </div>
        </div>

        <!-- bonus sets -->
        <div v-else class="editor-body">
          <div class="editor-list">
            <div class="editor-list-head">
              <button type="button" class="btn btn--primary" @click="newSet">+ New set</button>
            </div>
            <div class="editor-list-body">
              <div v-for="set in db.bonusSets" :key="set.id" class="editor-row"
                   :class="{ 'is-on': set.id === selectedSetId }" @click="selectSet(set)">
                <span class="editor-row-name">{{ set.name ?? set.id }}</span>
                <span class="editor-row-filter">{{ (set.effects ?? []).length }} effect(s)</span>
              </div>
            </div>
          </div>

          <div class="editor-form">
            <div class="form-bar">
              <strong>{{ selectedSetId ?? 'New bonus set' }}</strong>
              <span class="spacer"></span>
              <button type="button" class="btn btn--primary" :disabled="!setJson"
                      @click="saveSet">Save</button>
              <button v-if="selectedSetId" type="button" class="btn" @click="deleteSet">Delete</button>
            </div>
            <p v-if="setError" class="drawer-error">{{ setError }}</p>
            <p class="hint">Set effects use tiers, variants and nested conditions, so they are
              edited as JSON rather than through a form that could not represent them.</p>
            <textarea class="code" rows="22" v-model="setJson"
                      placeholder="Pick a set on the left, or create a new one."></textarea>
          </div>
        </div>
      </div>
    `,
  };
})();
