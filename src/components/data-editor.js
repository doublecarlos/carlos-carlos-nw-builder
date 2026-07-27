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

    components: {
      ItemForm: window.NW.components.ItemForm,
      ComboBox: window.NW.components.ComboBox,
    },

    props: {
      db: { type: Object, required: true },
      overlay: { type: Object, required: true },
    },

    emits: ['update-overlay', 'close'],

    data: () => ({
      query: '',
      statusFilter: 'all',      // all | changed | added | edited | removed
      selectedName: null,
      showExport: false,
      exportTab: 'items',       // items | bonuses | overlay
      formDirty: false,
      notice: '',
      confirmReset: false,
      confirmResetTimer: null,
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

      statusFilterOptions: () => ([
        { value: 'all', label: 'all' },
        { value: 'changed', label: 'changed only' },
        { value: 'added', label: 'added' },
        { value: 'edited', label: 'edited' },
        { value: 'removed', label: 'removed' },
      ]),

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

      /** Every bonus id in the catalogue — the vocabulary for `excludes`. */
      bonusIds() {
        const ids = new Set();
        for (const set of this.db.bonusSets) {
          for (const effect of set.effects ?? []) if (effect.id) ids.add(effect.id);
        }
        return [...ids].sort();
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

    mounted() {
      const routed = window.NW.router.parse().item;
      if (routed && this.db.get(routed)) this.selectedName = routed;
      window.addEventListener('popstate', this.onPopState);
    },

    unmounted() {
      window.removeEventListener('popstate', this.onPopState);
    },

    methods: {
      // --- routing --------------------------------------------------------------------------
      // `item` is this component's own corner of the URL -- app.js owns view/build/tab and
      // knows nothing about what's selected in here. `select`'s `push` flag is what keeps
      // arrow-key browsing from filling the back/forward stack with one stop per keystroke:
      // a click is a real "go to this item" navigation, an arrow key is just skimming.

      /** Back/forward landed on this component while it was already mounted (still in the
       * editor, just a different item). A fresh mount reads the same param in `mounted()`. */
      onPopState() {
        const name = window.NW.router.parse().item ?? null;
        this.selectedName = (name && this.db.get(name)) ? name : null;
      },

      select(row, { push = true } = {}) {
        if (row.status === 'removed') return;
        this.selectedName = row.name;
        window.NW.router.apply({ item: row.name }, { push });
      },

      /**
       * ArrowUp/Down drive the list from either the search box (kept focused, command-palette
       * style -- typing still filters normally) or a focused row. `selectedName` doubles as the
       * keyboard cursor: the existing click UX has no separate "highlighted but not open" state,
       * so keyboard nav matches it exactly rather than inventing one. Guarded to the search
       * input or an `.editor-row` so the status ComboBox's own dropdown keeps its arrows.
       */
      onListKeydown(event) {
        const isSearch = event.target.matches?.('input[type="search"]');
        const isRow = event.target.closest?.('.editor-row');
        if (!isSearch && !isRow) return;
        if (!['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) return;
        const rows = this.filtered;
        if (!rows.length) return;
        event.preventDefault();
        const idx = rows.findIndex((row) => row.name === this.selectedName);
        if (event.key === 'Enter') {
          if (idx !== -1) this.select(rows[idx]);
          return;
        }
        const dir = event.key === 'ArrowDown' ? 1 : -1;
        const next = idx === -1
          ? (dir === 1 ? 0 : rows.length - 1)
          : Math.min(Math.max(idx + dir, 0), rows.length - 1);
        this.select(rows[next], { push: false });
      },

      newItem() {
        this.selectedName = null;
        window.NW.router.apply({ item: null });
        // Remounts ItemForm with an empty draft even if it was already showing a new item.
        this.$refs.form?.$forceUpdate?.();
      },

      onSave({ item, previousName }) {
        const next = catalog().upsert(this.overlay, 'items', item.name, item, previousName);
        this.$emit('update-overlay', next);
        this.selectedName = item.name;
        window.NW.router.apply({ item: item.name });
        this.notice = `Saved “${item.name}”`;
      },

      onDelete() {
        const name = this.selectedName;
        this.$emit('update-overlay', catalog().remove(this.overlay, 'items', name));
        this.selectedName = null;
        window.NW.router.apply({ item: null });
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

      /** Two-step, not a `confirm()` dialog -- same pattern as build-bar.js's delete: this
       *  wipes every change in the overlay, and a blocking modal would stall anything driving
       *  the editor programmatically. */
      resetAll() {
        if (!this.confirmReset) {
          this.confirmReset = true;
          this.confirmResetTimer = window.setTimeout(() => { this.confirmReset = false; }, 4000);
          return;
        }
        window.clearTimeout(this.confirmResetTimer);
        this.confirmReset = false;
        this.$emit('update-overlay', catalog().emptyOverlay());
        this.selectedName = null;
        window.NW.router.apply({ item: null });
        this.notice = 'Discarded every change — back to the shipped data';
      },

      // --- bonus sets -----------------------------------------------------------------------
      // Edited from inside the item form now, next to the item that grants them.

      onSaveSet({ id, set }) {
        this.$emit('update-overlay', catalog().upsert(this.overlay, 'bonusSets', id, set, id));
        this.notice = `Saved set “${set.name || id}”`;
      },

      onDeleteSet(id) {
        this.$emit('update-overlay', catalog().remove(this.overlay, 'bonusSets', id));
        this.notice = `Removed set “${id}”`;
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
          <strong>Data editor</strong>
          <span class="hint">{{ db.items.length }} items · {{ db.bonusSets.length }} bonus sets</span>

          <span class="spacer"></span>

          <span v-if="changedCount" class="badge badge--edited">{{ changedCount }} changed</span>
          <span v-if="errorCount" class="badge badge--error">{{ errorCount }} error(s)</span>
          <span v-if="warnCount" class="badge badge--warn">{{ warnCount }} warning(s)</span>

          <button type="button" class="btn" :class="{ 'is-on': showExport }"
                  @click="showExport = !showExport">Export…</button>
          <label class="btn">Import overlay
            <input type="file" accept=".json" hidden @change="importOverlay"></label>
          <button type="button" class="btn" :class="{ 'is-danger': confirmReset }"
                  :disabled="!changedCount" @click="resetAll">
            {{ confirmReset ? 'Really discard?' : 'Discard changes' }}
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
                      @click="selectedName = finding.name">{{ finding.name }}</button>
              <span>{{ finding.message }}</span>
            </li>
          </ul>
          <p v-if="findings.length > 40" class="hint">…and {{ findings.length - 40 }} more.</p>
        </div>

        <div class="editor-body">
          <div class="editor-list" @keydown="onListKeydown">
            <div class="editor-list-head">
              <input type="search" v-model="query" placeholder="Filter items…">
              <ComboBox class="combo--status" :model-value="statusFilter" :options="statusFilterOptions"
                        @update:model-value="v => statusFilter = v" />
              <button type="button" class="btn btn--primary" @click="newItem">+ New item</button>
            </div>
            <div class="editor-list-body">
              <div v-for="row in filtered" :key="row.name" class="editor-row" tabindex="0"
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
              :db="db"
              :filters="filters"
              :set-ids="setIds"
              :tags="tagList"
              :bonus-ids="bonusIds"
              @save="onSave"
              @delete="onDelete"
              @revert="onRevert"
              @save-set="onSaveSet"
              @delete-set="onDeleteSet"
              @dirty="formDirty = $event" />
          </div>
        </div>
      </div>
    `,
  };
})();
