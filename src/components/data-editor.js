// The data editor: browse/add/edit/remove items and shared bonus sets, lint the result, and
// export it back to the `data/*.json` files.
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

  const UNDO_LIMIT = 50;

  return {
    name: 'DataEditor',

    components: {
      ItemForm: window.NW.components.ItemForm,
      BonusSetForm: window.NW.components.BonusSetForm,
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
      section: 'items',         // items | bonusSets
      selectedName: null,
      selectedSetId: null,
      showExport: false,
      exportTab: 'items',       // items | bonuses | overlay
      formDirty: false,
      notice: '',
      confirmReset: false,
      confirmResetTimer: null,
      // JSON snapshots of `overlay` (this component's prop), taken right before each committed
      // change (save/delete/revert/restore/reset/import) -- the same "snapshot before, restore
      // by re-emitting the JSON" shape as app.js's build undo, just one stream instead of one
      // per build, since there is only ever one overlay. Strings, not objects, so undoing a
      // hundred-item overlay a dozen times doesn't keep a dozen live deep copies around.
      history: { past: [], future: [] },
      // itemName/setId -> that form's in-progress `draft`, stashed just before switching away
      // from it while dirty (see `stashCurrentDraft`) so picking a different row doesn't
      // silently throw the edit away -- restored via `initialDraft` if the same row is
      // reselected. Only ever keyed by a *real* name/id, never the new-item/-set placeholder:
      // "+ New item" is a deliberate "start fresh" action, not a navigation to preserve.
      itemDrafts: {},
      setDrafts: {},
    }),

    computed: {
      // Removed entries are gone from `db`, so the list is built from the composed catalogue
      // plus the overlay's tombstones -- otherwise a deletion would vanish with no way back.
      itemRows() {
        const rows = this.db.items.map((item) => ({
          key: item.name,
          name: item.name,
          filter: item.filter,
          item,
          status: catalog().statusOf(this.overlay, 'items', item.name),
          kind: 'item',
        }));
        for (const [name, value] of Object.entries(this.overlay.items ?? {})) {
          if (value === null) {
            rows.push({ key: name, name, filter: '—', item: null, status: 'removed', kind: 'item' });
          }
        }
        return rows.sort((a, b) => a.name.localeCompare(b.name));
      },

      /** Same shape as `itemRows`, one row per bonus set rather than per item -- so the same
       * list/search/keyboard-nav code serves both without knowing which it's showing. */
      bonusSetRows() {
        const rows = this.db.bonusSets.map((set) => ({
          key: set.id,
          name: set.name || set.id,
          filter: `${(set.grants ?? []).length} grant(s)`,
          set,
          status: catalog().statusOf(this.overlay, 'bonusSets', set.id),
          kind: 'bonusSet',
        }));
        for (const [id, value] of Object.entries(this.overlay.bonusSets ?? {})) {
          if (value === null) {
            rows.push({ key: id, name: id, filter: '—', set: null, status: 'removed', kind: 'bonusSet' });
          }
        }
        return rows.sort((a, b) => a.name.localeCompare(b.name));
      },

      rows() {
        return this.section === 'bonusSets' ? this.bonusSetRows : this.itemRows;
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

      selectedSet() {
        if (this.selectedSetId == null) return null;
        return this.db.bonusSetById.get(this.selectedSetId) ?? null;
      },

      selectedSetStatus() {
        return this.selectedSetId == null
          ? 'base'
          : catalog().statusOf(this.overlay, 'bonusSets', this.selectedSetId);
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

      /** The vocabulary for `excludes`. A set now resolves as one unit, so only sets (not
       * individual grants) are addressable -- same list as `setIds`, kept as its own computed
       * since the two are used for unrelated purposes at the call sites. */
      bonusIds() {
        return this.setIds;
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
        if (this.exportTab === 'items') return 'db-items.json';
        if (this.exportTab === 'bonuses') return 'db-bonuses.json';
        return 'catalog-overlay.json';
      },

      canUndo() { return this.history.past.length > 0; },
      canRedo() { return this.history.future.length > 0; },
      undoLabel() {
        const past = this.history.past;
        return past.length ? past[past.length - 1].label : '';
      },
      redoLabel() {
        const future = this.history.future;
        return future.length ? future[future.length - 1].label : '';
      },
    },

    mounted() {
      const routed = window.NW.router.parse();
      if (routed.section === 'bonusSets') {
        this.section = 'bonusSets';
        if (routed.set && this.db.bonusSetById.get(routed.set)) this.selectedSetId = routed.set;
      } else if (routed.item && this.db.get(routed.item)) {
        this.selectedName = routed.item;
      }
      if (this.isValidStatusFilter(routed.status)) this.statusFilter = routed.status;
      if (routed.q) this.query = routed.q;
      window.addEventListener('popstate', this.onPopState);
      window.addEventListener('keydown', this.onKeydown);
    },

    unmounted() {
      window.removeEventListener('popstate', this.onPopState);
      window.removeEventListener('keydown', this.onKeydown);
    },

    watch: {
      // Lighter switches than picking a row -- don't deserve their own back/forward stop, same
      // as app.js's `tab` watcher.
      statusFilter(value) {
        window.NW.router.apply({ status: value === 'all' ? null : value }, { push: false });
      },
      query(value) {
        window.NW.router.apply({ q: value || null }, { push: false });
      },
    },

    methods: {
      // --- undo -----------------------------------------------------------------------------
      // The *editor's* undo, over committed overlay changes (save/delete/revert/restore/reset/
      // import) -- one stream, not one per build the way app.js keys its own history, since
      // there is only ever one overlay. Ordinary in-progress editing (typing, checking a class
      // box) has its own separate, lower-level undo scoped to whichever form is open --
      // item-form.js's/bonus-set-form.js's own `draftHistory` -- that `onKeydown` below tries
      // first; this one only ever sees a fresh snapshot right before a commit lands.

      snapshot(label) {
        this.history.past.push({ json: JSON.stringify(this.overlay), label });
        if (this.history.past.length > UNDO_LIMIT) this.history.past.shift();
        this.history.future.length = 0;
      },

      undo() {
        if (!this.canUndo) return;
        const entry = this.history.past.pop();
        this.history.future.push({ json: JSON.stringify(this.overlay), label: entry.label });
        this.$emit('update-overlay', JSON.parse(entry.json));
      },

      redo() {
        if (!this.canRedo) return;
        const entry = this.history.future.pop();
        this.history.past.push({ json: JSON.stringify(this.overlay), label: entry.label });
        this.$emit('update-overlay', JSON.parse(entry.json));
      },

      /**
       * Same Ctrl+Z/Ctrl+Shift+Z/Ctrl+Y convention as app.js's builder undo, including which
       * fields it defers to native undo for -- only `<textarea>` (the export/import JSON boxes),
       * not every `<input>`. app.js hijacks Ctrl+Z inside ordinary fields on purpose, and the
       * open item/bonus-set form's own draft-level undo (item-form.js/bonus-set-form.js) is
       * exactly that same convention one level down, so this defers to it first: only once the
       * open form has nothing left to undo does this fall through to the editor's own undo over
       * *committed* changes (save/delete/revert/…).
       */
      onKeydown(event) {
        if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
        const key = event.key.toLowerCase();
        if (key !== 'z' && key !== 'y') return;
        if (event.target?.tagName === 'TEXTAREA') return;
        event.preventDefault();
        const form = this.section === 'bonusSets' ? this.$refs.setForm : this.$refs.form;
        if (key === 'y' || event.shiftKey) {
          if (form?.redoDraft?.()) return;
          this.redo();
        } else {
          if (form?.undoDraft?.()) return;
          this.undo();
        }
      },

      // --- unsaved form drafts ----------------------------------------------------------------
      // Switching rows used to remount the form fresh (`:key="selectedName ?? '__new__'"`) and
      // silently drop whatever was mid-edit. Stashing here, right before the key changes, means
      // the draft survives the trip and comes back via `initialDraft` if the same row is
      // reselected -- see `itemDrafts`/`setDrafts` in `data()`.

      stashItemDraft() {
        if (this.selectedName == null) return;
        const form = this.$refs.form;
        if (form?.dirty) this.itemDrafts[this.selectedName] = form.draft;
        else delete this.itemDrafts[this.selectedName];
      },

      stashSetDraft() {
        if (this.selectedSetId == null) return;
        const form = this.$refs.setForm;
        if (form?.dirty) this.setDrafts[this.selectedSetId] = form.draft;
        else delete this.setDrafts[this.selectedSetId];
      },

      /** Whichever form is actually on screen right now matches `section`, not the row's own
       * kind -- `select()` never changes `section` itself, so at the moment this runs the two
       * always agree. */
      stashCurrentDraft() {
        if (this.section === 'bonusSets') this.stashSetDraft();
        else this.stashItemDraft();
      },

      /** The list row's own red "unsaved" badge: true for the open form's live dirty state, or
       * for any other row still holding a stashed draft from an earlier visit. */
      hasUnsavedDraft(row) {
        if (row.kind === 'bonusSet') {
          if (row.key === this.selectedSetId) return this.formDirty;
          return Boolean(this.setDrafts[row.key]);
        }
        if (row.key === this.selectedName) return this.formDirty;
        return Boolean(this.itemDrafts[row.key]);
      },

      // --- filters ---------------------------------------------------------------------------

      clearFilters() {
        this.query = '';
        this.statusFilter = 'all';
      },

      // --- routing --------------------------------------------------------------------------
      // `item`/`set`/`section`/`status`/`q` are this component's own corner of the URL --
      // app.js owns view/build/tab and knows nothing about what's selected in here. `select`'s
      // `push` flag is what keeps arrow-key browsing from filling the back/forward stack with
      // one stop per keystroke: a click is a real "go to this row" navigation, an arrow key is
      // just skimming.

      isValidStatusFilter(value) {
        return this.statusFilterOptions.some((option) => option.value === value);
      },

      /** Back/forward landed on this component while it was already mounted (still in the
       * editor, just a different item/set/section/status filter/query). A fresh mount reads the
       * same params in `mounted()`. */
      onPopState() {
        const route = window.NW.router.parse();
        if (route.section === 'bonusSets') {
          this.section = 'bonusSets';
          this.selectedSetId = (route.set && this.db.bonusSetById.get(route.set)) ? route.set : null;
        } else {
          this.section = 'items';
          this.selectedName = (route.item && this.db.get(route.item)) ? route.item : null;
        }
        this.statusFilter = this.isValidStatusFilter(route.status) ? route.status : 'all';
        this.query = route.q ?? '';
      },

      switchSection(target) {
        if (this.section === target) return;
        this.stashCurrentDraft();
        this.section = target;
        window.NW.router.apply(target === 'bonusSets'
          ? { section: 'bonusSets', item: null, set: this.selectedSetId }
          : { section: null, set: null, item: this.selectedName });
      },

      select(row, { push = true } = {}) {
        if (row.status === 'removed') return;
        this.stashCurrentDraft();
        if (row.kind === 'bonusSet') {
          this.selectedSetId = row.key;
          window.NW.router.apply({ set: row.key, item: null }, { push });
        } else {
          this.selectedName = row.key;
          window.NW.router.apply({ item: row.key, set: null }, { push });
        }
      },

      /**
       * ArrowUp/Down drive the list from either the search box (kept focused, command-palette
       * style -- typing still filters normally) or a focused row. The current section's selected
       * key doubles as the keyboard cursor: the existing click UX has no separate "highlighted
       * but not open" state, so keyboard nav matches it exactly rather than inventing one.
       * Guarded to the search input or an `.editor-row` so the status ComboBox's own dropdown
       * keeps its arrows.
       */
      onListKeydown(event) {
        const isSearch = event.target.matches?.('input[type="search"]');
        const isRow = event.target.closest?.('.editor-row');
        if (!isSearch && !isRow) return;
        if (!['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) return;
        const rows = this.filtered;
        if (!rows.length) return;
        event.preventDefault();
        const currentKey = this.section === 'bonusSets' ? this.selectedSetId : this.selectedName;
        const idx = rows.findIndex((row) => row.key === currentKey);
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
        this.stashItemDraft();
        this.selectedName = null;
        window.NW.router.apply({ item: null });
        // Remounts ItemForm with an empty draft even if it was already showing a new item.
        this.$refs.form?.$forceUpdate?.();
      },

      newSet() {
        this.stashSetDraft();
        this.selectedSetId = null;
        window.NW.router.apply({ set: null });
        this.$refs.setForm?.$forceUpdate?.();
      },

      onSave({ item, previousName }) {
        this.snapshot(`Save item “${item.name}”`);
        const next = catalog().upsert(this.overlay, 'items', item.name, item, previousName);
        this.$emit('update-overlay', next);
        delete this.itemDrafts[item.name];
        if (previousName && previousName !== item.name) delete this.itemDrafts[previousName];
        this.selectedName = item.name;
        window.NW.router.apply({ item: item.name });
        this.notice = `Saved “${item.name}”`;
      },

      onDelete() {
        const name = this.selectedName;
        this.snapshot(`Delete item “${name}”`);
        this.$emit('update-overlay', catalog().remove(this.overlay, 'items', name));
        delete this.itemDrafts[name];
        this.selectedName = null;
        window.NW.router.apply({ item: null });
        this.notice = `Removed “${name}”`;
      },

      onRevert() {
        const name = this.selectedName;
        this.snapshot(`Revert item “${name}”`);
        this.$emit('update-overlay', catalog().revert(this.overlay, 'items', name));
        delete this.itemDrafts[name];
        this.notice = `Reverted “${name}” to the shipped version`;
      },

      restore(row) {
        const group = row.kind === 'bonusSet' ? 'bonusSets' : 'items';
        this.snapshot(`Restore “${row.name}”`);
        this.$emit('update-overlay', catalog().revert(this.overlay, group, row.key));
        if (row.kind === 'bonusSet') delete this.setDrafts[row.key];
        else delete this.itemDrafts[row.key];
        this.notice = `Restored “${row.name}”`;
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
        this.snapshot('Discard all changes');
        this.$emit('update-overlay', catalog().emptyOverlay());
        this.selectedName = null;
        this.selectedSetId = null;
        this.itemDrafts = {};
        this.setDrafts = {};
        window.NW.router.apply({ item: null, set: null });
        this.notice = 'Discarded every change — back to the shipped data';
      },

      /** Jump to whatever a validation finding points at, switching section if needed --
       * findings carry `kind` precisely so this doesn't have to guess from the id/name shape. */
      selectFinding(finding) {
        if (!finding.name) return;
        if (finding.kind === 'bonusSet') {
          this.section = 'bonusSets';
          this.selectedSetId = finding.name;
          window.NW.router.apply({ section: 'bonusSets', set: finding.name, item: null });
        } else {
          this.section = 'items';
          this.selectedName = finding.name;
          window.NW.router.apply({ section: null, item: finding.name, set: null });
        }
      },

      // --- bonus sets -----------------------------------------------------------------------
      // `onSaveSet`/`onDeleteSet` are the sub-editor inside the item form (a bonus this item
      // attaches or detaches); `onSaveSetTop`/`onDeleteSetTop`/`onRevertSetTop` are this
      // component's own "Bonus sets" section, browsing and editing a set on its own.

      /**
       * Renaming a shared bonus set's *id* (not its display name -- items never reference that)
       * would otherwise only ever patch the array of whichever item's form happened to be open;
       * every other item that also lists the old id is left pointing at a dead one, and just
       * silently stops granting it. Every item currently granting `oldId` gets its own overlay
       * entry rewritten to `newId`, folded into the same overlay update as the rename itself --
       * including the item whose form triggered the rename, so the fix holds even if that item
       * is never explicitly re-saved.
       */
      cascadeSetRename(overlay, oldId, newId) {
        const affected = (this.db.setMembers.get(oldId) ?? [])
          .map((name) => this.db.get(name))
          .filter((item) => item?.bonuses?.includes(oldId));
        let next = overlay;
        for (const item of affected) {
          const updated = { ...item, bonuses: item.bonuses.map((bid) => (bid === oldId ? newId : bid)) };
          next = catalog().upsert(next, 'items', item.name, updated, item.name);
        }
        return { overlay: next, count: affected.length };
      },

      onSaveSet({ id, set, previousId }) {
        this.snapshot(`Save bonus “${set.name || id}”`);
        let next = catalog().upsert(this.overlay, 'bonusSets', id, set, previousId ?? id);
        let extra = '';
        if (previousId && previousId !== id) {
          const cascade = this.cascadeSetRename(next, previousId, id);
          next = cascade.overlay;
          if (cascade.count) extra = ` — updated ${cascade.count} other item(s) that referenced the old id`;
        }
        this.$emit('update-overlay', next);
        delete this.setDrafts[id];
        if (previousId && previousId !== id) delete this.setDrafts[previousId];
        this.notice = `Saved set “${set.name || id}”${extra}`;
      },

      onDeleteSet(id) {
        this.snapshot(`Delete bonus “${id}”`);
        this.$emit('update-overlay', catalog().remove(this.overlay, 'bonusSets', id));
        delete this.setDrafts[id];
        this.notice = `Removed set “${id}”`;
      },

      onSaveSetTop({ id, set, previousId }) {
        this.snapshot(`Save bonus set “${set.name || id}”`);
        let next = catalog().upsert(this.overlay, 'bonusSets', id, set, previousId);
        let extra = '';
        if (previousId && previousId !== id) {
          const cascade = this.cascadeSetRename(next, previousId, id);
          next = cascade.overlay;
          if (cascade.count) extra = ` — updated ${cascade.count} item(s) that referenced the old id`;
        }
        this.$emit('update-overlay', next);
        delete this.setDrafts[id];
        if (previousId && previousId !== id) delete this.setDrafts[previousId];
        this.selectedSetId = id;
        window.NW.router.apply({ set: id });
        this.notice = `Saved bonus set “${set.name || id}”${extra}`;
      },

      onDeleteSetTop() {
        const id = this.selectedSetId;
        this.snapshot(`Delete bonus set “${id}”`);
        this.$emit('update-overlay', catalog().remove(this.overlay, 'bonusSets', id));
        delete this.setDrafts[id];
        this.selectedSetId = null;
        window.NW.router.apply({ set: null });
        this.notice = `Removed bonus set “${id}”`;
      },

      onRevertSetTop() {
        const id = this.selectedSetId;
        this.snapshot(`Revert bonus set “${id}”`);
        this.$emit('update-overlay', catalog().revert(this.overlay, 'bonusSets', id));
        delete this.setDrafts[id];
        this.notice = `Reverted bonus set “${id}” to the shipped version`;
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
          this.snapshot('Import overlay');
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
          <div class="tabs">
            <button type="button" class="tab" :class="{ 'is-on': section === 'items' }"
                    @click="switchSection('items')">Items <span class="tab-count">{{ db.items.length }}</span></button>
            <button type="button" class="tab" :class="{ 'is-on': section === 'bonusSets' }"
                    @click="switchSection('bonusSets')">Bonus sets <span class="tab-count">{{ db.bonusSets.length }}</span></button>
          </div>

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

          <span class="sep"></span>

          <button type="button" class="btn btn--history" :disabled="!canUndo"
                  :title="canUndo ? 'Undo: ' + undoLabel + ' (Ctrl+Z)' : 'Nothing to undo'" @click="undo">
            ↶ Undo<span v-if="canUndo" class="btn-detail">{{ undoLabel }}</span>
          </button>
          <button type="button" class="btn btn--history" :disabled="!canRedo"
                  :title="canRedo ? 'Redo: ' + redoLabel + ' (Ctrl+Shift+Z)' : 'Nothing to redo'" @click="redo">
            ↷ Redo<span v-if="canRedo" class="btn-detail">{{ redoLabel }}</span>
          </button>

          <button type="button" class="btn" @click="$emit('close')">← Back to builder</button>
        </div>

        <p v-if="notice" class="notice" @click="notice = ''">{{ notice }}</p>

        <div v-if="showExport" class="drawer">
          <div class="drawer-row">
            <div class="tabs">
              <button type="button" class="tab" :class="{ 'is-on': exportTab === 'items' }"
                      @click="exportTab = 'items'">db-items.json</button>
              <button type="button" class="tab" :class="{ 'is-on': exportTab === 'bonuses' }"
                      @click="exportTab = 'bonuses'">db-bonuses.json</button>
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
                      @click="selectFinding(finding)">{{ finding.name }}</button>
              <span>{{ finding.message }}</span>
            </li>
          </ul>
          <p v-if="findings.length > 40" class="hint">…and {{ findings.length - 40 }} more.</p>
        </div>

        <div class="editor-body">
          <div class="editor-list" @keydown="onListKeydown">
            <div class="editor-list-head">
              <input type="search" class="editor-search" v-model="query"
                     :placeholder="section === 'bonusSets' ? 'Filter bonus sets…' : 'Filter items…'">
              <ComboBox class="combo--status" :model-value="statusFilter" :options="statusFilterOptions"
                        @update:model-value="v => statusFilter = v" />
              <button v-if="query || statusFilter !== 'all'" type="button" class="link"
                      @click="clearFilters">clear filters</button>
              <button v-if="section === 'bonusSets'" type="button" class="btn btn--primary"
                      @click="newSet">+ New bonus set</button>
              <button v-else type="button" class="btn btn--primary" @click="newItem">+ New item</button>
            </div>
            <div class="editor-list-body">
              <div v-for="row in filtered" :key="row.key" class="editor-row" tabindex="0"
                   :class="{ 'is-on': row.key === (section === 'bonusSets' ? selectedSetId : selectedName) }"
                   @click="select(row)">
                <span class="editor-row-name">{{ row.name }}</span>
                <span v-if="row.status !== 'base'" class="badge" :class="'badge--' + row.status">
                  {{ row.status }}
                </span>
                <span v-if="hasUnsavedDraft(row)" class="badge badge--unsaved"
                      title="Unsaved edits in the form">unsaved</span>
                <button v-if="row.status === 'removed'" type="button" class="link"
                        @click.stop="restore(row)">restore</button>
                <span v-else class="editor-row-filter">{{ row.filter }}</span>
              </div>
              <p v-if="!filtered.length" class="dim" style="padding:8px">Nothing matches.</p>
            </div>
          </div>

          <div class="editor-form">
            <ItemForm
              v-if="section === 'items'"
              ref="form"
              :key="selectedName ?? '__new__'"
              :source="selected"
              :status="selectedStatus"
              :initial-draft="selectedName != null ? (itemDrafts[selectedName] ?? null) : null"
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
            <BonusSetForm
              v-else
              ref="setForm"
              :key="selectedSetId ?? '__new__'"
              :source="selectedSet"
              :status="selectedSetStatus"
              :initial-draft="selectedSetId != null ? (setDrafts[selectedSetId] ?? null) : null"
              :db="db"
              :set-ids="setIds"
              :tags="tagList"
              :bonus-ids="bonusIds"
              @save="onSaveSetTop"
              @delete="onDeleteSetTop"
              @revert="onRevertSetTop"
              @dirty="formDirty = $event" />
          </div>
        </div>
      </div>
    `,
  };
})();
